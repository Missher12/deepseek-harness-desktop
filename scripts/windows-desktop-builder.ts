/** Run the public Windows builder CLI without changing relative PATH identities across cwd changes. */
import { spawn } from 'node:child_process'
import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSON_SCHEMA, load } from 'js-yaml'

/** Cwd and environment prepared before loading any builder or package-manager resolver. */
export interface WindowsBuilderContext { cwd: string; env: NodeJS.ProcessEnv }
/** Public builder executable and argv with physical project and derived config paths. */
export interface WindowsBuilderInvocation extends WindowsBuilderContext { cli: string; argv: string[] }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function patterns(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

async function deriveWindowsConfiguration(stage: string, source: string): Promise<string> {
  if (!(await lstat(source)).isFile() || dirname(await realpath(source)) !== stage) {
    throw new Error('Windows builder configuration must be a regular file in its stage.')
  }
  const config: unknown = load(await readFile(source, 'utf8'), { schema: JSON_SCHEMA })
  if (!record(config) || !record(config.win)
    || !patterns(config.files) || !config.files.includes('node_modules/**') || !config.files.includes('official-runtime/**')
    || !patterns(config.win.files) || !config.win.files.every(item => item.startsWith('!'))) {
    throw new Error('Expected the staged global file patterns and Windows exclusion patterns.')
  }
  // The loader normalizes global files but not win.files; separate matchers can refill excluded files.
  const derivedName = 'electron-builder.windows-derived.json'
  const { files: windowsFiles, ...windowsOptions } = config.win
  // The main matcher inserts its node_modules exclusion before the root include.
  // Reinclude the already-selected official modules there, before all safety exclusions.
  const globalFiles = config.files.flatMap(pattern => pattern === 'node_modules/**'
    ? [pattern, 'official-runtime/node_modules/**'] : [pattern])
  // A linked node-pty can have its physical files under the runtime's pnpm store.
  const windowsPatterns = windowsFiles.flatMap(pattern => pattern.startsWith('!official-runtime/node_modules/node-pty/')
    ? [pattern, pattern.replace('!official-runtime/node_modules/node-pty/', '!official-runtime/node_modules/**/node-pty/')]
    : [pattern])
  const derived = { ...config, files: [{ from: '.', to: '.',
    filter: [...globalFiles, ...windowsPatterns, '!' + derivedName] }], win: windowsOptions }
  const path = join(stage, derivedName)
  // Retain this excluded receipt beside the original config; never overwrite a prior invocation.
  await writeFile(path, JSON.stringify(derived, null, 2) + '\n', { flag: 'wx' })
  return path
}

/**
 * @param stage Prepared stage directory.
 * @param enteringCwd Real cwd of the filtered pnpm parent before changing directories.
 * @param env Parent environment; only PATH entries are changed in the returned copy.
 * @returns Physical stage cwd and PATH entries anchored to their original directory.
 */
export async function prepareWindowsBuilderContext(
  stage: string, enteringCwd = process.cwd(), env: NodeJS.ProcessEnv = process.env,
): Promise<WindowsBuilderContext> {
  const origin = await realpath(enteringCwd)
  const cwd = await realpath(stage)
  if (!(await stat(cwd)).isDirectory()) throw new Error('Builder stage is not a directory.')
  const keys = Object.keys(env).filter(key => key.toLowerCase() === 'path')
  const [key] = keys
  if (keys.length !== 1 || key === undefined) throw new Error('Builder requires one unambiguous PATH variable.')
  const value = env[key]
  if (value === undefined) throw new Error('Builder PATH is missing.')
  const normalized = value.split(delimiter).map((entry) => {
    const quoted = entry.startsWith('"') && entry.endsWith('"')
    const path = quoted ? entry.slice(1, -1) : entry
    const absolute = isAbsolute(path) ? path : resolve(origin, path)
    return quoted ? '"' + absolute + '"' : absolute
  }).join(delimiter)
  return { cwd, env: { ...env, [key]: normalized } }
}

/**
 * @param argv Windows builder argv; projectDir is relative to enteringCwd and config is relative to projectDir.
 * @param enteringCwd Filtered pnpm parent's cwd containing the installed builder dependency.
 * @param env Original pnpm context; credentials and other values are never logged here.
 * @returns Public CLI invocation using physical projectDir and a retained, package-excluded config; all other argv are preserved.
 */
export async function prepareWindowsBuilderInvocation(
  argv: readonly string[], enteringCwd = process.cwd(), env: NodeJS.ProcessEnv = process.env,
): Promise<WindowsBuilderInvocation> {
  const index = argv.indexOf('--projectDir')
  const stage = index < 0 ? undefined : argv[index + 1]
  if (stage === undefined || stage.length === 0 || stage.startsWith('--') || argv.lastIndexOf('--projectDir') !== index) {
    throw new Error('Expected one explicit --projectDir for the prepared stage.')
  }
  const origin = await realpath(enteringCwd)
  const context = await prepareWindowsBuilderContext(resolve(origin, stage), origin, env)
  const configIndex = argv.indexOf('--config')
  const configPath = configIndex < 0 ? undefined : argv[configIndex + 1]
  if (configPath === undefined || configPath.length === 0 || configPath.startsWith('--') || argv.lastIndexOf('--config') !== configIndex
    || !argv.includes('--win') || argv.includes('--mac') || argv.includes('--linux')) {
    throw new Error('Expected Windows-only arguments and one explicit --config.')
  }
  const require = createRequire(join(origin, 'package.json'))
  const manifestPath = require.resolve('electron-builder/package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: string; bin?: { 'electron-builder'?: string } }
  const publicCli = manifest.bin?.['electron-builder']
  if (manifest.name !== 'electron-builder' || typeof publicCli !== 'string') {
    throw new Error('Installed builder has no public CLI entry.')
  }
  const cli = await realpath(resolve(dirname(manifestPath), publicCli))
  const derivedConfig = await deriveWindowsConfiguration(context.cwd, resolve(context.cwd, configPath))
  return { ...context, cli, argv: argv.map((value, at) =>
    at === configIndex + 1 ? derivedConfig : at === index + 1 ? context.cwd : value) }
}

/** @param invocation Prepared public CLI invocation. @returns The child's unmodified exit code. */
export async function runWindowsBuilder(invocation: WindowsBuilderInvocation): Promise<number> {
  return await new Promise((done, fail) => {
    const child = spawn(process.execPath, [invocation.cli, ...invocation.argv], {
      cwd: invocation.cwd, env: invocation.env, stdio: 'inherit', shell: false,
    })
    child.once('error', fail)
    child.once('close', (code, signal) => {
      if (signal !== null || code === null) fail(new Error('Builder did not exit normally.'))
      else done(code)
    })
  })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await runWindowsBuilder(await prepareWindowsBuilderInvocation(process.argv.slice(2))) }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Windows builder launch failed.'}\n`); process.exitCode = 1 }
}
