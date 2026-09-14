/** Assemble an opt-in base shell without changing its official runtime input. */
import { chmod, cp, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { JSON_SCHEMA, dump, load } from 'js-yaml'
import { verifyOfficialRuntime } from './desktop-base-runtime.ts'
import { verifyDesktopHelperRuntime } from './prepare-desktop-helper-runtime.ts'
import { createDesktopBaseSmokeDescriptor } from './desktop-base-contract.ts'
import type { DesktopStageResult } from './stage-desktop.ts'

const ADAPTERS = ['ui-desktop-shell', 'ui-settings-system-update'] as const
const SHELL_UTILITIES = ['dsh-atomic-write', 'dsh-home-paths'] as const
const SHELL_FILES = ['lib/main.js', 'lib/preload.cjs', 'lib/update-helper.js',
  'renderer/loading.html', 'renderer/failure.html', 'assets/icon-source.png', 'base.cordis.patch.yml',
  'electron-builder.yml', 'electron-builder.linux.yml', 'build/installer.nsh',
  'build/linux/after-pack.cjs', 'build/linux/launcher.sh', 'build/linux/apparmor-profile',
  'assets/icon.icns', 'assets/icon-windows.ico', 'assets/tray-windows-16.png',
  'assets/tray-windows-20.png', 'assets/tray-windows-24.png', 'assets/tray-windows-32.png']
const CORE_FILES = ['node_modules/@deepseek-ai/dsh/lib/bin.js',
  'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/worker.cjs']
const ENHANCEMENT_PACKAGES = new Set([
  'dsh-client-runtime', 'dsh-reasoning-effort', 'dsh-session-messenger', 'dshmarket',
  'dsh-usage-insights', 'dsh-client-ui-settings-usage', 'dsh-client-ui-settings-personalization',
  'dsh-missher-brain', 'dsh-client-ui-settings-brain', 'dsh-desktop-workbench',
])

function hasFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every(field => Object.hasOwn(value, field))
}

function isBaseComposition(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false
  const row: unknown = value[0]
  if (!hasFields(row, ['insert']) || !Array.isArray(row.insert) || row.insert.length !== 2) return false
  const adapters = new Map([
    ['desktop-shell', '@deepseek-ai/dsh-client-ui-desktop-shell'],
    ['desktop-system-update', '@deepseek-ai/dsh-client-ui-settings-system-update'],
  ])
  const entries: unknown[] = row.insert
  for (const entry of entries) {
    if (!hasFields(entry, ['id', 'name']) || typeof entry.id !== 'string'
      || !adapters.has(entry.id) || adapters.get(entry.id) !== entry.name) return false
    adapters.delete(entry.id)
  }
  return adapters.size === 0
}

function validateBasePatch(source: string): void {
  let parsed: unknown
  try {
    parsed = load(source, { schema: JSON_SCHEMA })
  } catch (cause) {
    throw new Error('Invalid base composition YAML.', { cause })
  }
  if (!isBaseComposition(parsed)) throw new Error('Unexpected base composition entries or configuration.')
}

async function requireFile(path: string): Promise<void> {
  if (!(await lstat(path)).isFile()) throw new Error(`Base stage requires a regular file: ${path}`)
}

async function copyAdapter(root: string, stage: string, name: typeof ADAPTERS[number]): Promise<void> {
  const source = join(root, 'packages/client', name)
  const target = join(stage, 'official-runtime/node_modules/@deepseek-ai', `dsh-client-${name}`)
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as {
    name: string
    peerDependencies?: Record<string, string>
    devDependencies?: unknown
    scripts?: unknown
  }
  if (manifest.name !== `@deepseek-ai/dsh-client-${name}`) throw new Error('Unexpected native Client adapter identity.')
  const require = createRequire(join(stage, 'official-runtime/package.json'))
  for (const [dependency, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!range.startsWith('workspace:')) continue
    const actual = JSON.parse(await readFile(require.resolve(`${dependency}/package.json`), 'utf8')) as { version: string }
    if (typeof actual.version !== 'string') throw new Error('Native adapter peer has no installed version.')
    manifest.peerDependencies ??= {}
    manifest.peerDependencies[dependency] = actual.version
  }
  delete manifest.devDependencies
  delete manifest.scripts
  await mkdir(target, { recursive: true })
  await cp(join(source, 'lib'), join(target, 'lib'), { recursive: true, dereference: false, verbatimSymlinks: true })
  await writeFile(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * Copy verified official bytes and the two native Client adapters into a new stage.
 * Staged POSIX runtime descriptors are readable by ordinary users after system installation.
 * Existing outputs are never deleted; the immutable runtime, shell utility identities and base patch are checked before output mutation.
 * @param repositoryRoot - base-shell source checkout with compiled shell and adapter files.
 * @param runtimeDirectory - separately installed, fingerprinted official runtime.
 * @param requestedStageDir - optional directory named dsh-desktop-stage; defaults to apps/desktop/.stage.
 * @param helperRuntimeDirectory - independently verified standalone Node assets for update transactions.
 * @returns physical stage and required-file receipt; this does not build installers or grant native acceptance.
 */
export async function stageDesktopBase(
  repositoryRoot: string,
  runtimeDirectory: string,
  requestedStageDir?: string,
  helperRuntimeDirectory?: string,
): Promise<DesktopStageResult> {
  const root = resolve(repositoryRoot)
  const shell = join(root, 'apps/desktop')
  const defaultStage = join(shell, '.stage')
  const stage = requestedStageDir === undefined ? defaultStage : resolve(requestedStageDir)
  if (stage !== defaultStage && basename(stage) !== 'dsh-desktop-stage') throw new Error('Unexpected base stage directory.')
  const provenance = await verifyOfficialRuntime(runtimeDirectory)
  if (helperRuntimeDirectory === undefined) throw new Error('Base staging requires the standalone update-helper runtime.')
  if (process.platform !== 'darwin' && process.platform !== 'linux' && process.platform !== 'win32') {
    throw new Error('Unsupported Desktop helper platform.')
  }
  const helper = await verifyDesktopHelperRuntime(resolve(helperRuntimeDirectory), { platform: process.platform, arch: 'x64' })
  if (helper.execution !== 'native-verified') throw new Error('Base staging requires a natively verified update-helper runtime.')
  for (const file of provenance.files) {
    if (file.path.split('/').some(part => ENHANCEMENT_PACKAGES.has(part))) {
      throw new Error(`Base runtime contains an enhancement package: ${file.path}`)
    }
  }
  for (const path of SHELL_FILES) await requireFile(join(shell, path))
  await requireFile(join(root, 'THIRD_PARTY_NOTICES.md'))
  const basePatch = await readFile(join(shell, 'base.cordis.patch.yml'))
  validateBasePatch(basePatch.toString('utf8'))
  for (const path of CORE_FILES) await requireFile(join(runtimeDirectory, path))
  const shellDependencies: Record<string, string> = {}
  for (const name of SHELL_UTILITIES) {
    const expectedName = `@deepseek-ai/${name}`
    const path = join(runtimeDirectory, 'node_modules', expectedName, 'package.json')
    await requireFile(path)
    const utility: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof utility !== 'object' || utility === null || !('name' in utility) || utility.name !== expectedName
      || !('version' in utility) || utility.version !== provenance.harnessVersion) {
      throw new Error(`Unexpected base shell utility identity: ${expectedName}`)
    }
    shellDependencies[expectedName] = utility.version
  }
  for (const name of ADAPTERS) {
    for (const file of ['package.json', 'lib/index.js', 'lib/client.js']) {
      await requireFile(join(root, 'packages/client', name, file))
    }
  }
  await mkdir(dirname(stage), { recursive: true })
  await mkdir(stage)
  await cp(runtimeDirectory, join(stage, 'official-runtime'), { recursive: true, dereference: false, verbatimSymlinks: true })
  await cp(helperRuntimeDirectory, join(stage, 'helper-runtime'), { recursive: true, dereference: false, verbatimSymlinks: true })
  await verifyDesktopHelperRuntime(join(stage, 'helper-runtime'), { platform: process.platform, arch: 'x64' })
  // Confirm the copy before adding separately identified native adapters.
  await verifyOfficialRuntime(join(stage, 'official-runtime'))
  if (process.platform !== 'win32') {
    const descriptors = ['provenance.json',
      ...provenance.files.filter(file => file.path === 'desktop-official-installation.json').map(file => file.path)]
    for (const name of descriptors) {
      const path = join(stage, 'official-runtime', name)
      const stat = await lstat(path)
      if (!stat.isFile()) throw new Error(`Packaged runtime descriptor must be a regular file: ${name}`)
      await chmod(path, (stat.mode & 0o777) | 0o444)
    }
  }
  for (const directory of ['lib', 'renderer', 'assets', 'build']) {
    await cp(join(shell, directory), join(stage, directory), { recursive: true, dereference: false, verbatimSymlinks: true })
  }
  await writeFile(join(stage, 'base.cordis.patch.yml'), basePatch)
  for (const file of ['electron-builder.yml', 'electron-builder.linux.yml']) {
    await cp(join(shell, file), join(stage, file))
  }
  const builder = load(await readFile(join(shell, 'electron-builder.yml'), 'utf8'), { schema: JSON_SCHEMA }) as {
    extraResources?: unknown[]
  }
  builder.extraResources = [...builder.extraResources ?? [], { from: 'helper-runtime', to: 'desktop-helper' }]
  await writeFile(join(stage, 'electron-builder.yml'), dump(builder))
  await cp(join(root, 'THIRD_PARTY_NOTICES.md'), join(stage, 'THIRD_PARTY_NOTICES.md'))
  const manifest = JSON.parse(await readFile(join(shell, 'package.json'), 'utf8')) as {
    name: string
    version: string
    main: string
    productName?: string
  }
  await writeFile(join(stage, 'package.json'), `${JSON.stringify({
    name: manifest.name, version: manifest.version, main: manifest.main, type: 'module', private: true,
    description: 'Opt-in base Desktop candidate over the pinned official Harness runtime',
    dependencies: shellDependencies,
  }, null, 2)}\n`)
  await writeFile(join(stage, 'update-metadata.json'), `${JSON.stringify({
    schema: 1, desktopVersion: manifest.version, harnessVersion: provenance.harnessVersion,
    platform: process.platform, arch: process.arch, channel: 'release',
  }, null, 2)}\n`)
  const cliManifest = JSON.parse(await readFile(join(runtimeDirectory, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')) as {
    dependencies?: Record<string, unknown>
  }
  await writeFile(join(stage, 'base-smoke.json'), `${JSON.stringify(createDesktopBaseSmokeDescriptor(
    manifest.version, process.platform, Object.keys(cliManifest.dependencies ?? {}),
  ), null, 2)}\n`)
  for (const name of ADAPTERS) await copyAdapter(root, stage, name)
  await writeFile(join(stage, 'official-runtime/desktop-native.json'), `${JSON.stringify({
    private: true,
    dependencies: Object.fromEntries(ADAPTERS.map(name => [`@deepseek-ai/dsh-client-${name}`, '*'])),
  }, null, 2)}\n`)
  // These two stateless utilities are exact official bytes required by the native main process.
  for (const name of SHELL_UTILITIES) {
    const target = join(stage, 'node_modules/@deepseek-ai', name)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(stage, 'official-runtime/node_modules/@deepseek-ai', name), target, { recursive: true, dereference: false, verbatimSymlinks: true })
  }
  await writeFile(join(stage, 'desktop-composition.json'), `${JSON.stringify({
    schema: 1, kind: 'base', officialSha: provenance.sourceSha, harnessVersion: provenance.harnessVersion,
  }, null, 2)}\n`)
  await writeFile(join(stage, 'base-stage.json'), `${JSON.stringify({
    schema: 1, kind: 'base', officialSha: provenance.sourceSha,
    officialInventorySha256: provenance.inventorySha256,
    nativeAdapters: ADAPTERS.map(name => `@deepseek-ai/dsh-client-${name}`),
    verification: 'official core copy verified; native adapters are separately owned shell code',
  }, null, 2)}\n`)
  return { stageDir: await realpath(stage), validatedFiles: [...SHELL_FILES, ...CORE_FILES.map(path => `official-runtime/${path}`)] }
}
