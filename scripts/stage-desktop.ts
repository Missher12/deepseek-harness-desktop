import { spawnSync } from 'node:child_process'
import { cp, lstat, readFile, readdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import * as yaml from 'js-yaml'
import {
  assertComputerUseHelperArchitecture,
  computerUseHelperBuildSpec,
} from './build-computer-use-helper.ts'
import {
  officialClientBuildEnvironment,
  readClientBuildRecord,
} from './client-build-environment.ts'

const DESKTOP_PACKAGE = '@deepseek-ai/dsh-desktop'
const SESSION_MESSENGER_PACKAGE = '@deepseek-ai/dsh-session-messenger'
const SESSION_MESSENGER_ROW_ID = 'session-messenger'
const DESKTOP_CONTROL_HOST_PACKAGE = '@deepseek-ai/dsh-desktop-control-host'
const DESKTOP_CONTROL_HOST_ROW_ID = 'desktop-control-host'

/** OS seams injected by staging tests. */
export interface StageDesktopDependencies {
  readonly platform: NodeJS.Platform
  readonly arch: string
  verifyOfficialClientBuild(root: string): void
  readText(path: string): Promise<string>
  readBinary(path: string): Promise<Uint8Array>
  remove(path: string): Promise<void>
  pnpmInvocation(args: readonly string[]): { command: string; args: readonly string[] }
  run(command: string, args: readonly string[], cwd: string): void
  copy(source: string, target: string): Promise<void>
  isFile(path: string): Promise<boolean>
  findPackageDirectories(root: string, packageDirectoryName: string): Promise<readonly string[]>
  findNativeBinaries(root: string): Promise<readonly string[]>
  findComputerUseHelpers(root: string): Promise<readonly string[]>
  isExecutable(path: string): Promise<boolean>
  lstat(path: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>
  realpath(path: string): Promise<string>
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

type WalkDecision = 'collect' | 'descend' | 'skip'

/** Traverse one tree with explicit collection and descent decisions. */
async function findTreePaths(
  root: string,
  classify: (path: string, name: string, isDirectory: boolean) => Promise<WalkDecision> | WalkDecision,
): Promise<string[]> {
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
      const decision = await classify(path, entry.name, entry.isDirectory())
      if (decision === 'collect') found.push(path)
      else if (decision === 'descend' && entry.isDirectory()) pending.push(path)
    }
  }
  return found.sort()
}

async function findNativeBinaries(root: string): Promise<string[]> {
  return findTreePaths(root, (_path, name, isDirectory) => {
    if (isDirectory) return 'descend'
    return name.endsWith('.node') ? 'collect' : 'skip'
  })
}

async function findComputerUseHelpers(root: string): Promise<string[]> {
  return findTreePaths(root, (_path, name, isDirectory) => {
    if (isDirectory) return 'descend'
    return name === 'computer-use-helper' || name === 'computer-use-helper.exe' ? 'collect' : 'skip'
  })
}

async function findPackageDirectories(root: string, packageDirectoryName: string): Promise<string[]> {
  return findTreePaths(root, async (path, name, isDirectory) => {
    if (!isDirectory) return 'skip'
    if (name === packageDirectoryName && await pathIsFile(join(path, 'package.json'))) return 'collect'
    return 'descend'
  })
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
  platform: process.platform,
  arch: process.arch,
  verifyOfficialClientBuild: (root) => {
    readClientBuildRecord(root, officialClientBuildEnvironment(root))
  },
  remove: async (path) => { await rm(path, { recursive: true, force: true }) },
  readText: async path => await readFile(path, 'utf8'),
  readBinary: async path => new Uint8Array(await readFile(path)),
  pnpmInvocation: desktopStagePnpmInvocation,
  run,
  copy: async (source, target) => { await cp(source, target, { recursive: true, force: true }) },
  isFile: pathIsFile,
  findPackageDirectories,
  findNativeBinaries,
  findComputerUseHelpers,
  isExecutable: async path => ((await stat(path)).mode & 0o111) !== 0,
  lstat,
  realpath,
}

const REASONING_EFFORT_PACKAGE = '@deepseek-ai/dsh-reasoning-effort'
const REASONING_EFFORT_IDENTITIES = new Set([
  REASONING_EFFORT_PACKAGE,
  'dsh-reasoning-effort',
])

/**
 * Fail closed when the immutable Desktop patch omits the attributed fork or
 * also mounts the upstream package that competes for the same single slot.
 * @param source - Complete Desktop patch YAML.
 */
export function validateReasoningEffortPatch(source: string): void {
  let document: unknown
  try {
    document = yaml.load(source)
  } catch (cause) {
    throw new Error('Desktop staging preflight could not parse desktop.cordis.patch.yml.', { cause })
  }

  const matching: Array<{ id?: string; name?: string }> = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : undefined
    const name = typeof row.name === 'string' ? row.name : undefined
    if (id === 'reasoning-effort' || (name !== undefined && REASONING_EFFORT_IDENTITIES.has(name))) {
      matching.push({ ...(id === undefined ? {} : { id }), ...(name === undefined ? {} : { name }) })
    }
    for (const child of Object.values(row)) visit(child)
  }
  visit(document)

  const candidate = matching[0]
  if (matching.length !== 1
    || candidate === undefined
    || candidate.id !== 'reasoning-effort'
    || candidate.name !== REASONING_EFFORT_PACKAGE) {
    throw new Error(
      'Desktop staging preflight requires exactly one reasoning-effort row for '
      + `${REASONING_EFFORT_PACKAGE}; the upstream original and attributed fork cannot be enabled together.`,
    )
  }
}

function stageRelative(stageDir: string, path: string): string {
  const value = relative(stageDir, path)
  if (value === '' || value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error(`Desktop staging found a file outside the stage directory: ${path}`)
  }
  return value.split(sep).join('/')
}

function isStrictDescendant(parent: string, path: string): boolean {
  const value = relative(parent, path)
  return value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)
}

function flattenEntryRows(entries: EntryOptions[]): EntryOptions[] {
  const rows: EntryOptions[] = []
  const visit = (children: EntryOptions[]): void => {
    for (const row of children) {
      rows.push(row)
      if (row.group && Array.isArray(row.config)) visit(row.config as EntryOptions[])
    }
  }
  visit(entries)
  return rows
}

function assertCanonicalSessionMessengerRow(content: string): void {
  let parsed: unknown
  try {
    parsed = yaml.load(content, { schema: entryListSchema })
  } catch (error: unknown) {
    throw new Error('Desktop staging requires exactly one canonical session-messenger row.', { cause: error })
  }
  if (!Array.isArray(parsed) || parsed.some(patch => (
    typeof patch !== 'object' || patch === null || Array.isArray(patch)
  ))) {
    throw new Error('Desktop staging requires exactly one canonical session-messenger row.')
  }
  const patches = parsed as PatchOptions[]
  if (patches.some(patch => (
    patch.id === SESSION_MESSENGER_ROW_ID || patch.name === SESSION_MESSENGER_PACKAGE
  ))) {
    throw new Error('Desktop staging requires exactly one canonical session-messenger row.')
  }
  const entries = applyEntryPatches([], patches, () => {})
  const rows = flattenEntryRows(entries)
  const candidates = rows.filter(row => (
    row.id === SESSION_MESSENGER_ROW_ID || row.name === SESSION_MESSENGER_PACKAGE
  ))
  const candidate = candidates[0]
  if (candidates.length !== 1
    || candidate === undefined
    || candidate.id !== SESSION_MESSENGER_ROW_ID
    || candidate.name !== SESSION_MESSENGER_PACKAGE
    || Object.keys(candidate).sort().join(',') !== 'id,name') {
    throw new Error('Desktop staging requires exactly one canonical session-messenger row.')
  }
}

/** Fail closed unless the immutable overlay contains one unconfigured internal control Host row. */
export function validateDesktopControlHostPatch(content: string): void {
  let parsed: unknown
  try {
    parsed = yaml.load(content, { schema: entryListSchema })
  } catch (error: unknown) {
    throw new Error('Desktop staging requires exactly one canonical desktop-control-host row.', { cause: error })
  }
  if (!Array.isArray(parsed) || parsed.some(patch => (
    typeof patch !== 'object' || patch === null || Array.isArray(patch)
  ))) {
    throw new Error('Desktop staging requires exactly one canonical desktop-control-host row.')
  }
  const patches = parsed as PatchOptions[]
  if (patches.some(patch => (
    patch.id === DESKTOP_CONTROL_HOST_ROW_ID || patch.name === DESKTOP_CONTROL_HOST_PACKAGE
  ))) {
    throw new Error('Desktop staging requires exactly one canonical desktop-control-host row.')
  }
  const entries = applyEntryPatches([], patches, () => {})
  const rows = flattenEntryRows(entries)
  const candidates = rows.filter(row => (
    row.id === DESKTOP_CONTROL_HOST_ROW_ID || row.name === DESKTOP_CONTROL_HOST_PACKAGE
  ))
  const candidate = candidates[0]
  if (candidates.length !== 1
    || candidate === undefined
    || candidate.id !== DESKTOP_CONTROL_HOST_ROW_ID
    || candidate.name !== DESKTOP_CONTROL_HOST_PACKAGE
    || Object.keys(candidate).sort().join(',') !== 'id,name') {
    throw new Error('Desktop staging requires exactly one canonical desktop-control-host row.')
  }
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
  dependencies.verifyOfficialClientBuild(root)
  const helperSpec = computerUseHelperBuildSpec(dependencies.platform, dependencies.arch)

  const desktopPatch = await dependencies.readText(join(desktopDir, 'desktop.cordis.patch.yml'))
  validateReasoningEffortPatch(desktopPatch)
  assertCanonicalSessionMessengerRow(desktopPatch)
  validateDesktopControlHostPatch(desktopPatch)
  await dependencies.remove(stageDir)
  // pnpm 11's legacy deploy writes its dependency mode into the root workspace
  // state. Passing --prod there corrupts later root commands into production-
  // only verification. The stage may contain dev tools, but electron-builder's
  // production dependency graph and explicit files allowlist exclude them from
  // the shipped application.
  const deploy = dependencies.pnpmInvocation(['--filter', DESKTOP_PACKAGE, 'deploy', '--legacy', stageDir])
  dependencies.run(deploy.command, deploy.args, root)

  const desktopEntries = [
    'lib',
    'renderer',
    'assets',
    'build',
    'electron-builder.yml',
    'desktop.cordis.patch.yml',
    'update-metadata.json',
  ] as const
  for (const entry of desktopEntries) {
    await dependencies.copy(join(desktopDir, entry), join(stageDir, entry))
  }
  const helperDirectory = dirname(helperSpec.nativeRelativePath)
  await dependencies.copy(
    join(desktopDir, 'native-bin', helperDirectory),
    join(stageDir, 'native-bin', helperDirectory),
  )
  await dependencies.copy(join(root, 'THIRD_PARTY_NOTICES.md'), join(stageDir, 'THIRD_PARTY_NOTICES.md'))

  const required = [
    'package.json',
    'electron-builder.yml',
    'build/installer.nsh',
    'desktop.cordis.patch.yml',
    'THIRD_PARTY_NOTICES.md',
    'lib/main.js',
    'lib/preload.cjs',
    'lib/update-helper.js',
    'update-metadata.json',
    'renderer/loading.html',
    'renderer/failure.html',
    'assets/icon-source.png',
    'assets/icon.icns',
    'assets/icon.ico',
    'node_modules/@deepseek-ai/dsh/lib/bin.js',
    'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
    'node_modules/@deepseek-ai/dsh-client-ui-brand-official/lib/client.js',
    ...[
      'backend', 'cordis', 'debugger', 'devops', 'frontend', 'minimal',
      'planner', 'ptc', 'qa', 'research', 'reviewer', 'standard',
    ].flatMap(preset => [
      `node_modules/@deepseek-ai/dsh-agent-presets/presets/${preset}/preset.yml`,
      `node_modules/@deepseek-ai/dsh-agent-presets/presets/${preset}/agent.cordis.yml`,
    ]),
    'node_modules/@deepseek-ai/dsh-host-desktop-plugin-runtime/lib/index.js',
    'node_modules/@deepseek-ai/dsh-desktop-managed-memory/package.json',
    'node_modules/@deepseek-ai/dsh-desktop-managed-memory/lib/index.js',
    'node_modules/@deepseek-ai/dsh-desktop-managed-memory/lib/client.js',
    'node_modules/@deepseek-ai/dsh-desktop-managed-evolution/package.json',
    'node_modules/@deepseek-ai/dsh-desktop-managed-evolution/lib/index.js',
    'node_modules/@deepseek-ai/dsh-desktop-managed-evolution/lib/client.js',
    'node_modules/dshmarket/package.json',
    'node_modules/@deepseek-ai/dsh-session-messenger/package.json',
    'node_modules/@deepseek-ai/dsh-session-messenger/lib/index.js',
    'node_modules/@deepseek-ai/dsh-session-messenger/lib/client.js',
    'node_modules/@deepseek-ai/dsh-session-messenger/cordis.patch.yml',
    'node_modules/@deepseek-ai/dsh-desktop-control-protocol/package.json',
    'node_modules/@deepseek-ai/dsh-desktop-control-protocol/protocol-v1.json',
    'node_modules/@deepseek-ai/dsh-desktop-control-protocol/lib/index.js',
    'node_modules/@deepseek-ai/dsh-desktop-control-protocol/lib/invariant.js',
    'node_modules/@deepseek-ai/dsh-browser-control/package.json',
    'node_modules/@deepseek-ai/dsh-browser-control/lib/index.js',
    'node_modules/@deepseek-ai/dsh-browser-control/lib/invariant.js',
    'node_modules/@deepseek-ai/dsh-computer-control/package.json',
    'node_modules/@deepseek-ai/dsh-computer-control/lib/index.js',
    'node_modules/@deepseek-ai/dsh-computer-control/lib/invariant.js',
    'node_modules/@deepseek-ai/dsh-desktop-control-host/package.json',
    'node_modules/@deepseek-ai/dsh-desktop-control-host/lib/index.js',
    'node_modules/@deepseek-ai/dsh-desktop-control-host/lib/invariant.js',
    'node_modules/@deepseek-ai/dsh-client-ui-settings-system-update/lib/index.js',
    'node_modules/@deepseek-ai/dsh-client-ui-settings-system-update/lib/client.js',
    'node_modules/@deepseek-ai/dsh-client-ui-desktop-control/package.json',
    'node_modules/@deepseek-ai/dsh-client-ui-desktop-control/lib/index.js',
    'node_modules/@deepseek-ai/dsh-client-ui-desktop-control/lib/client.js',
    'node_modules/@deepseek-ai/dsh-tool-computer-control/package.json',
    'node_modules/@deepseek-ai/dsh-tool-computer-control/lib/index.js',
    'node_modules/@deepseek-ai/dsh-tool-computer-control/lib/invariant.js',
    'node_modules/dshmarket/lib/index.js',
    'node_modules/dshmarket/lib/routes.js',
    'node_modules/dshmarket/src/client/MarketSection.tsx',
    'node_modules/dshmarket/client/client.js',
    'node_modules/dshmarket/client/client.js.map',
    'node_modules/@deepseek-ai/dsh-reasoning-effort/lib/index.js',
    'node_modules/@deepseek-ai/dsh-reasoning-effort/lib/client.js',
    'node_modules/@deepseek-ai/dsh-reasoning-effort/LICENSE',
    'node_modules/@deepseek-ai/dsh-reasoning-effort/THIRD_PARTY_NOTICES.md',
    'node_modules/@deepseek-ai/dsh-reasoning-effort/lib/assets/chibi-runner-strip.png',
    'node_modules/pnpm/bin/pnpm.mjs',
    `native-bin/${helperSpec.nativeRelativePath}`,
  ]
  for (const path of required) {
    if (!await dependencies.isFile(join(stageDir, path))) {
      throw new Error(`Desktop staging missing required file: ${path}`)
    }
  }

  const marketPackageDirectories = await dependencies.findPackageDirectories(
    join(stageDir, 'node_modules'),
    'dshmarket',
  )
  if (marketPackageDirectories.length !== 1) {
    throw new Error(`Desktop staging expected exactly one dshmarket package; found ${String(marketPackageDirectories.length)}.`)
  }

  const marketRoot = join(stageDir, 'node_modules', 'dshmarket')
  let marketManifest: unknown
  try {
    marketManifest = JSON.parse(await dependencies.readText(join(marketRoot, 'package.json')))
  } catch (error) {
    throw new Error('Desktop staging could not parse the staged dshmarket manifest.', { cause: error })
  }
  if (
    typeof marketManifest !== 'object'
    || marketManifest === null
    || !('name' in marketManifest)
    || !('version' in marketManifest)
    || marketManifest.name !== 'dshmarket'
    || marketManifest.version !== '1.10.1'
  ) {
    throw new Error('Desktop staging expected dshmarket@1.10.1 exactly.')
  }

  const compactMarker = 'data-dshmarket-layout'
  const semanticArtifacts = [
    ['Client source', 'src/client/MarketSection.tsx'],
    ['Client bundle', 'client/client.js'],
    ['Client source map', 'client/client.js.map'],
  ] as const
  for (const [label, path] of semanticArtifacts) {
    const contents = await dependencies.readText(join(marketRoot, path))
    if (!contents.includes(compactMarker)) {
      throw new Error(`Desktop staging compact marker missing from ${label}.`)
    }
  }
  const hostBundle = await dependencies.readText(join(marketRoot, 'lib/routes.js'))
  if (!hostBundle.includes('self-protected')) {
    throw new Error('Desktop staging dshmarket Host self-protection marker is missing.')
  }
  if (!hostBundle.includes('restoreProfileManifestSnapshot')) {
    throw new Error('Desktop staging dshmarket manifest-transaction marker is missing.')
  }

  const nativeBinaries = await dependencies.findNativeBinaries(join(stageDir, 'node_modules'))
  if (nativeBinaries.length === 0) throw new Error('Desktop staging found no native .node modules.')

  const nativeBinDir = join(stageDir, 'native-bin')
  const selectedPlatformDir = join(nativeBinDir, helperDirectory)
  const helperPath = join(nativeBinDir, helperSpec.nativeRelativePath)
  const nativeHelpers = await dependencies.findComputerUseHelpers(nativeBinDir)
  if (nativeHelpers.length !== 1 || resolve(nativeHelpers[0] ?? '') !== resolve(helperPath)) {
    throw new Error(`Desktop staging expected exactly one platform-matching Computer Use helper; found ${String(nativeHelpers.length)}.`)
  }
  const helperStats = await dependencies.lstat(helperPath)
  if (helperStats.isSymbolicLink() || !helperStats.isFile()) {
    throw new Error('Desktop staging requires the Computer Use helper to be a regular file, not a symbolic link.')
  }
  const [nativeBinRealPath, selectedPlatformRealPath, helperRealPath] = await Promise.all([
    dependencies.realpath(nativeBinDir),
    dependencies.realpath(selectedPlatformDir),
    dependencies.realpath(helperPath),
  ])
  if (!isStrictDescendant(nativeBinRealPath, selectedPlatformRealPath)) {
    throw new Error('Desktop staging requires the selected platform directory real path to remain inside the staged native-bin directory.')
  }
  if (!isStrictDescendant(selectedPlatformRealPath, helperRealPath)) {
    throw new Error('Desktop staging requires the Computer Use helper real path to remain inside the selected platform directory.')
  }
  assertComputerUseHelperArchitecture(
    await dependencies.readBinary(helperPath),
    dependencies.platform,
    dependencies.arch,
  )
  if (dependencies.platform === 'darwin' && !await dependencies.isExecutable(helperPath)) {
    throw new Error('Desktop staging requires an executable Computer Use helper on macOS.')
  }

  dependencies.run(
    process.execPath,
    [join(root, 'scripts', 'verify-desktop-stage-main-import.mjs'), stageDir],
    root,
  )

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
