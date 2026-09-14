/** Reproducible Desktop preparation: exact official inputs, native adapters, then the shared stage. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { promisify, parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { buildDesktopNative } from './build-desktop-native.ts'
import { stageDesktopBase } from './stage-desktop-base.ts'
import { inspectOfficialTarball, prepareOfficialRuntime, resolveOfficialPnpmCli, verifyOfficialInputs } from './desktop-official-inputs.ts'
import { importOfficialRuntime } from './import-desktop-official-runtime.ts'
import { prepareDesktopHelperRuntime, verifyDesktopHelperRuntime } from './prepare-desktop-helper-runtime.ts'

const OFFICIAL_SHA = 'fb2c4b9e698e30edb738bca4cf0618587db7d203'
const OFFICIAL_VERSION = '0.1.5-rc.2'
const exec = promisify(execFile)

/** Ordered official build phases; packing keeps source and native-install identities separate. */
export interface OfficialBuildPhase { cwd: string; args: string[] }

/**
 * Plan an explicit clean-source build. Callers verify the source before running these phases.
 * @param source - pinned official checkout.
 * @param packages - newly owned tarball output root.
 * @returns pnpm argument vectors; no shell syntax or platform packaging commands.
 */
export function officialBuildPhases(source: string, packages: string): OfficialBuildPhase[] {
  return [
    { cwd: source, args: ['install', '--frozen-lockfile'] },
    { cwd: source, args: ['run', 'build:official'] },
    { cwd: source, args: ['run', 'release:pack', '--family', 'dsh', '--out', join(packages, 'dsh')] },
    { cwd: source, args: ['run', 'release:pack', '--family', 'vendor', '--out', join(packages, 'vendor')] },
    { cwd: join(source, 'native/system'), args: ['run', 'build:ts'] },
    { cwd: join(source, 'native/system/packages/entry'), args: ['pack', '--pack-destination', join(packages, 'native')] },
  ]
}

async function runNode(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ exitCode: number; stdout: string }> {
  try {
    const result = await exec(process.execPath, args, { cwd, maxBuffer: 32 * 1024 * 1024, env: { ...env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' } })
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    return { exitCode: 0, stdout: result.stdout }
  } catch (cause) {
    const result = cause as { stdout?: string; stderr?: string }
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    throw cause
  }
}

/**
 * Enumerate regular package archives; only dsh/vendor publish-order.txt sidecars are excluded.
 * Unknown names and non-file objects are rejected before archive inspection.
 * @param packages - output root containing dsh, vendor and native family directories.
 * @returns archive paths for individual inspection and complete package-set verification.
 */
export async function listOfficialPackageTarballs(packages: string): Promise<string[]> {
  const paths: string[] = []
  for (const family of ['dsh', 'vendor', 'native']) {
    const directory = join(packages, family)
    const outputs = await readdir(directory, { withFileTypes: true })
    for (const output of outputs.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const { name } = output
      const sidecar = (family === 'dsh' || family === 'vendor') && name === 'publish-order.txt'
      if (!output.isFile() || (!sidecar && !name.endsWith('.tgz'))) {
        throw new Error(`Unexpected official package output: ${name}`)
      }
      if (!sidecar) paths.push(join(directory, name))
    }
  }
  return paths
}

async function buildOfficial(source: string, packages: string, descriptor: string, pnpm: string): Promise<string> {
  const sha = (await exec('git', ['-C', source, 'rev-parse', 'HEAD'])).stdout.trim()
  const dirty = (await exec('git', ['-C', source, 'status', '--porcelain'])).stdout.trim()
  if (sha !== OFFICIAL_SHA || dirty !== '') throw new Error('Official build requires the exact clean source checkout.')
  if (existsSync(packages) || existsSync(descriptor)) throw new Error('Official build outputs already exist; verify and reuse their receipt instead.')
  await mkdir(packages, { recursive: true })
  for (const family of ['dsh', 'vendor', 'native']) await mkdir(join(packages, family))
  for (const command of officialBuildPhases(source, packages)) await runNode(command.cwd, [pnpm, ...command.args])
  const entries = []
  for (const path of await listOfficialPackageTarballs(packages)) {
    entries.push({ ...await inspectOfficialTarball(path), path })
  }
  if (entries.length !== 275) throw new Error('The pinned official package set must contain 275 packages.')
  const record = {
    sourceSha: OFFICIAL_SHA, sourceTree: (await exec('git', ['-C', source, 'rev-parse', 'HEAD^{tree}'])).stdout.trim(),
    sourceDirty: false, harnessVersion: OFFICIAL_VERSION, buildCommand: 'pnpm run build:official',
    clientBuildRecordSha256: createHash('sha256').update(await readFile(join(source, '.dsh-build/client-build-environment.json'))).digest('hex'),
    packages: entries,
  }
  const bytes = `${JSON.stringify(record, null, 2)}\n`
  await writeFile(descriptor, bytes, { flag: 'wx' })
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Execute the explicitly selected official preparation and shared base stage.
 * @param argv - source/receipt/runtime paths and optional explicit official-build request.
 */
export async function prepareDesktopBase(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: {
    'official-source': { type: 'string' }, packages: { type: 'string' }, descriptor: { type: 'string' },
    'descriptor-sha256': { type: 'string' }, runtime: { type: 'string' }, stage: { type: 'string' },
    'work-dir': { type: 'string' }, 'build-official': { type: 'boolean', default: false },
    'runtime-audit': { type: 'string' }, 'runtime-audit-sha256': { type: 'string' },
    'helper-runtime': { type: 'string' }, 'helper-cache': { type: 'string' },
  } })
  if (values['official-source'] === undefined) throw new Error('Provide --official-source pointing to the clean pinned official checkout.')
  const root = resolve(import.meta.dirname, '..')
  const source = resolve(values['official-source'])
  const work = resolve(values['work-dir'] ?? join(root, '.dsh-build/desktop-base', `${process.platform}-${process.arch}`))
  const packages = resolve(values.packages ?? join(work, 'official-packages'))
  const descriptor = resolve(values.descriptor ?? join(work, 'official-inputs.json'))
  const runtime = resolve(values.runtime ?? join(work, 'official-runtime'))
  const stage = resolve(values.stage ?? join(root, 'apps/desktop/.stage'))
  if (existsSync(stage)) throw new Error('Desktop stage already exists; use its packaging command or select a new --stage.')
  if (!['darwin', 'linux', 'win32'].includes(process.platform) || process.arch !== 'x64') {
    throw new Error('Desktop preparation requires a supported native x64 host.')
  }
  const require = createRequire(join(root, 'apps/desktop/package.json'))
  const pnpmDirectory = dirname(require.resolve('pnpm'))
  const pnpm = await resolveOfficialPnpmCli(pnpmDirectory)
  await mkdir(work, { recursive: true })
  const descriptorSha256 = values['build-official']
    ? await buildOfficial(source, packages, descriptor, pnpm)
    : values['descriptor-sha256']
  if (descriptorSha256 === undefined) throw new Error('Provide --descriptor-sha256 for existing inputs, or explicitly request --build-official.')
  const inputs = await verifyOfficialInputs({
    sourceDirectory: source, packagesDirectory: packages, descriptorPath: descriptor, descriptorSha256,
  })
  if (values['runtime-audit'] !== undefined) {
    if (values['runtime-audit-sha256'] === undefined) throw new Error('A trusted --runtime-audit-sha256 is required for audited reuse.')
    await importOfficialRuntime(inputs, runtime, values['runtime-audit'], values['runtime-audit-sha256'])
  } else {
    await prepareOfficialRuntime(inputs, {
      runtimeDirectory: runtime, pnpmJs: pnpm, runner: command => runNode(command.cwd, command.args, command.env),
    })
  }
  const helperDirectory = resolve(values['helper-runtime'] ?? join(work, 'helper-runtime'))
  const helperTarget = { platform: process.platform as 'darwin' | 'linux' | 'win32', arch: 'x64' as const }
  const helper = existsSync(helperDirectory)
    ? await verifyDesktopHelperRuntime(helperDirectory, helperTarget)
    : await prepareDesktopHelperRuntime({ ...helperTarget, outputDirectory: helperDirectory,
      source: { kind: 'download', cacheDirectory: resolve(values['helper-cache'] ?? join(work, 'downloads')) },
    })
  if (helper.execution !== 'native-verified') throw new Error('Formal Desktop preparation requires a natively verified helper runtime.')
  await buildDesktopNative(root, source, join(work, 'native-build'), async (command) => { await runNode(command.cwd, command.args) })
  const staged = await stageDesktopBase(root, runtime, stage, helperDirectory)
  console.log(`Desktop base stage ready: ${staged.stageDir}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareDesktopBase(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
