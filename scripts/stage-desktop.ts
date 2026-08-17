import { spawnSync } from 'node:child_process'
import { cp, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const DESKTOP_PACKAGE = '@deepseek-ai/dsh-desktop'

/** OS seams injected by staging tests. */
export interface StageDesktopDependencies {
  remove(path: string): Promise<void>
  pnpmInvocation(args: readonly string[]): { command: string; args: readonly string[] }
  run(command: string, args: readonly string[], cwd: string): void
  copy(source: string, target: string): Promise<void>
  isFile(path: string): Promise<boolean>
  findNativeBinaries(root: string): Promise<readonly string[]>
}

/** Auditable result returned by one staging operation. */
export interface DesktopStageResult {
  stageDir: string
  validatedFiles: readonly string[]
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function pathIsFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

async function findNativeBinaries(root: string): Promise<string[]> {
  const found: string[] = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (directory === undefined) break
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isMissing(error)) continue
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile() && entry.name.endsWith('.node')) found.push(path)
    }
  }
  return found.sort()
}

function run(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, [...args], { cwd, stdio: 'inherit', shell: false })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`Desktop staging command failed (${command}, status ${String(result.status)}).`)
  }
}

/** Build a shell-free pnpm invocation that also works on Windows. */
export function desktopStagePnpmInvocation(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
  nodeExecutable = process.execPath,
): { command: string; args: string[] } {
  const entrypoint = environment.npm_execpath
  if (entrypoint === undefined || entrypoint === '') {
    throw new Error('Desktop staging: npm_execpath is unavailable; invoke staging through a pnpm package script.')
  }
  return { command: nodeExecutable, args: [entrypoint, ...args] }
}

const realDependencies: StageDesktopDependencies = {
  remove: async (path) => { await rm(path, { recursive: true, force: true }) },
  pnpmInvocation: desktopStagePnpmInvocation,
  run,
  copy: async (source, target) => { await cp(source, target, { recursive: true, force: true }) },
  isFile: pathIsFile,
  findNativeBinaries,
}

function stageRelative(stageDir: string, path: string): string {
  const value = relative(stageDir, path)
  if (value === '' || value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error(`Desktop staging found a file outside the stage directory: ${path}`)
  }
  return value.split(sep).join('/')
}

/**
 * Create a production-only, self-contained desktop package tree.
 * @param repositoryRoot - Exact DeepSeek Harness repository root.
 * @param dependencies - Injectable filesystem and command seams.
 * @returns Validated stage directory and repository-portable file list.
 */
export async function stageDesktop(
  repositoryRoot: string,
  dependencies: StageDesktopDependencies = realDependencies,
  requestedStageDir?: string,
): Promise<DesktopStageResult> {
  const root = resolve(repositoryRoot)
  const desktopDir = resolve(root, 'apps', 'desktop')
  const defaultStageDir = resolve(desktopDir, '.stage')
  const stageDir = requestedStageDir === undefined ? defaultStageDir : resolve(requestedStageDir)
  const isDefaultStage = stageDir === defaultStageDir
  const isDedicatedExternalStage = basename(stageDir) === 'dsh-desktop-stage' && dirname(stageDir) !== stageDir
  if (!isDefaultStage && !isDedicatedExternalStage) {
    throw new Error(`Desktop staging refused an unexpected deletion target: ${stageDir}`)
  }

  await dependencies.remove(stageDir)
  // pnpm 11's legacy deploy writes its dependency mode into the root workspace
  // state. Passing --prod there corrupts later root commands into production-
  // only verification. The stage may contain dev tools, but electron-builder's
  // production dependency graph and explicit files allowlist exclude them from
  // the shipped application.
  const deploy = dependencies.pnpmInvocation(['--filter', DESKTOP_PACKAGE, 'deploy', '--legacy', stageDir])
  dependencies.run(deploy.command, deploy.args, root)

  for (const entry of ['lib', 'renderer', 'assets', 'electron-builder.yml', 'desktop.cordis.patch.yml'] as const) {
    await dependencies.copy(join(desktopDir, entry), join(stageDir, entry))
  }
  await dependencies.copy(join(root, 'THIRD_PARTY_NOTICES.md'), join(stageDir, 'THIRD_PARTY_NOTICES.md'))

  const required = [
    'package.json',
    'electron-builder.yml',
    'desktop.cordis.patch.yml',
    'THIRD_PARTY_NOTICES.md',
    'lib/main.js',
    'lib/preload.cjs',
    'renderer/loading.html',
    'renderer/failure.html',
    'assets/icon-source.png',
    'assets/icon.icns',
    'assets/icon.ico',
    'node_modules/@deepseek-ai/dsh/lib/bin.js',
    'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
    'node_modules/@deepseek-ai/dsh-host-desktop-plugin-runtime/lib/index.js',
    'node_modules/dshmarket/lib/index.js',
    'node_modules/dshmarket/client/client.js',
    'node_modules/pnpm/bin/pnpm.mjs',
  ]
  for (const path of required) {
    if (!await dependencies.isFile(join(stageDir, path))) {
      throw new Error(`Desktop staging missing required file: ${path}`)
    }
  }

  const nativeBinaries = await dependencies.findNativeBinaries(join(stageDir, 'node_modules'))
  if (nativeBinaries.length === 0) throw new Error('Desktop staging found no native .node modules.')

  return {
    stageDir,
    validatedFiles: [...required, ...nativeBinaries.map(path => stageRelative(stageDir, path))],
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  try {
    const result = await stageDesktop(
      resolve(import.meta.dirname, '..'),
      realDependencies,
      process.env.DSH_DESKTOP_STAGE_DIR,
    )
    console.log(`desktop stage: ${result.validatedFiles.length} required file(s) validated in ${result.stageDir}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Desktop staging failed with a non-Error value.')
    process.exitCode = 1
  }
}
