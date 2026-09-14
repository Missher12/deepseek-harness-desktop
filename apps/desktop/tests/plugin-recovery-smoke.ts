/** Native Bundle recovery continuation; platform drivers own UI interaction and process observation. */
import { spawn } from 'node:child_process'
import { lstat, mkdir, readFile, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ElectronApplication, Page } from 'playwright'
import { isDesktopCompatibilitySnapshot, type DesktopCompatibilitySnapshot, type DesktopPluginMutation } from '../src/compatibility/contracts.ts'
import { resolveDesktopRuntime } from '../src/harness/composition.ts'
import { terminateProcessTree } from '../src/harness/process-tree.ts'
import type {} from '../src/preload-api.ts'
import { validateDesktopBaseSmokeDescriptor } from '../../../scripts/desktop-base-contract.ts'
import { closeBaseSmokeOwnedApplication } from './packaged-base-smoke.ts'
import { BASE_SMOKE_EVENTS, baseSmokeFile, confinedBaseSmokePath, verifyPackagedAppImageIdentity, verifyRemountedAppImageIdentity,
  type BaseSmokeAppImageObservation,
  type BaseSmokeEvidence, type PackagedDesktopBaseSmokeReceipt } from './base-smoke-receipt.ts'

const A = 'dsh-r7-recovery-probe-a'
const B = 'dsh-r7-recovery-probe-b'
const FAILED_VERSION = '1.0.0'
const RESTORED_VERSION = '1.0.1'
const BROKEN_YAML = '- insert: [\n'
class RecoveryCliFailure extends Error {
  constructor(readonly ownedPid: number | undefined, readonly cleanupUnconfirmed: boolean) {
    super('Official fixture CLI failed; first command evidence retained.')
  }
}

/** Confirmation evidence must describe the actual platform operation. */
export type PluginRecoveryConfirmation = 'native-dialog-clicked' | 'dialog-contract-intercepted'
/** All historical children and loopback listeners, including validation candidates, owned by one launch. */
export interface PluginRecoveryResources { pids: number[]; ports: number[] }
/** Exact released core context; the driver must reuse its home, userData and active Session. */
export interface PluginRecoveryContext {
  core: PackagedDesktopBaseSmokeReceipt
  fixtureRoot: string
}
/** Platform implementation of native controls; no state store or validation substitution is accepted. */
export interface PluginRecoveryDriver {
  schemaVersion: 1
  launch(context: PluginRecoveryContext): Promise<ElectronApplication>
  openRecovery(app: ElectronApplication): Promise<Page>
  /** Wait for and click the real Apply/restart button; interception must return its distinct evidence kind. */
  confirmRestart(app: ElectronApplication): Promise<PluginRecoveryConfirmation>
  /** Wait for the actual base Host and Web renderer after startup or an IPC restart. */
  waitForHost(app: ElectronApplication): Promise<void>
  /** Include exited candidate PIDs/ports observed since launch, not only the current process tree. */
  inventory(app: ElectronApplication): Promise<PluginRecoveryResources>
  /** Reopen the supplied Session, submit an ordinary turn and observe its completed persisted output. */
  continueConversation(app: ElectronApplication, context: PluginRecoveryContext): Promise<{
    activeSessionId: string
    completed: boolean
    persistedLogPath: string
    userText: string
    assistantText: string
  }>
  /** Close native app and its provider, awaiting process and listener shutdown. */
  quit(app: ElectronApplication): Promise<void>
}
/** Explicit public CLI runner; env is scrubbed again and isolation variables are fixed by this module. */
export interface PluginRecoveryCli { executable: string; cliPath: string; env: NodeJS.ProcessEnv }
/** Platform-owned literal AppImage mount; shared checks inspect its actual Linux process and await final release. */
export interface PluginRecoveryAppImageMount {
  owner: { pid: number; startTime: string }
  observation: BaseSmokeAppImageObservation
  release(): Promise<PluginRecoveryResources>
}
/** Run only after the core driver has released exclusive ownership of the isolated smoke root. */
export interface PluginRecoverySmokeOptions {
  coreReceiptPath: string
  fixtureRoot: string
  cli: PluginRecoveryCli
  driver: PluginRecoveryDriver
  /** Actual held read-only AppImage mount used only for public CLI commands; the platform owns its mount process until return. */
  cliAppImageMount?: PluginRecoveryAppImageMount
}
/** Intercepted dialogs produce a separate, non-mergeable development receipt. */
export interface PluginRecoverySmokeResult {
  status: 'passed' | 'development-only'
  evidencePath: string
  fixtureRoot: string
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')) as unknown }
async function put(path: string, value: unknown): Promise<void> { await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }) }
function contains(root: string, path: string): boolean {
  const local = relative(resolve(root), resolve(path))
  return local === '' || (!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`))
}
async function physical(path: string): Promise<void> {
  if (!(await lstat(path)).isDirectory() || await realpath(path) !== resolve(path)) throw new Error('Recovery fixture requires a physical directory.')
}
async function bundle(directory: string, name: string, version: string, probe: string): Promise<void> {
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, type: 'module', main: './index.js', dependencies: {},
    dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2) + '\n')
  await writeFile(join(directory, 'cordis.patch.yml'), `- insert:\n    - id: ${name}\n      name: ${name}\n`)
  await writeFile(join(directory, 'index.js'), `import { appendFileSync } from 'node:fs'\nconst emit = event => appendFileSync(${JSON.stringify(probe)}, JSON.stringify({ name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)}, event, pid: process.pid }) + '\\n')\nemit('evaluated')\nexport function apply(ctx) { ctx.effect(() => { emit('active'); return () => emit('disposed') }) }\n`)
}

/** @param root Existing physical, exclusive fixture directory. @returns Two newly created local Bundles and their append-only probe. */
export async function createPluginRecoveryFixtures(root: string): Promise<{ a: string; b: string; probe: string }> {
  await physical(root)
  const a = join(root, 'bundle-a'), b = join(root, 'bundle-b'), probe = join(root, 'activations.jsonl')
  await mkdir(a)
  await mkdir(b)
  await writeFile(probe, '', { flag: 'wx', mode: 0o600 })
  await bundle(a, A, FAILED_VERSION, probe)
  await bundle(b, B, FAILED_VERSION, probe)
  return { a, b, probe }
}

/** @param confirmations Actual native dialog observations. @returns Whether the result can be merged as native UI evidence. */
export function pluginRecoveryConfirmationStatus(confirmations: readonly PluginRecoveryConfirmation[]): 'passed' | 'development-only' {
  if (confirmations.length === 0) throw new Error('Missing native confirmation evidence.')
  return confirmations.every(item => item === 'native-dialog-clicked') ? 'passed' : 'development-only'
}

/**
 * @param receipt Published composition receipt.
 * @param name Paused Bundle.
 * @param directory Its physical source.
 * @param before Prior execution count.
 * @param after Current execution count.
 */
export function verifyRecoveryExclusion(receipt: unknown, name: string, directory: string, before: number, after: number): void {
  if (!record(receipt) || !Array.isArray(receipt.activeBundles) || receipt.activeBundles.includes(name)
    || !Array.isArray(receipt.excludedBundles) || !receipt.excludedBundles.some(item => record(item) && item.name === name)) throw new Error('Paused Bundle was not excluded.')
  if (!Array.isArray(receipt.observations) || receipt.observations.some(item => record(item) && item.name === name)
    || !Array.isArray(receipt.inputs) || receipt.inputs.some(item => record(item) && typeof item.path === 'string' && contains(directory, item.path))) {
    throw new Error('Paused Bundle manifest or YAML was parsed.')
  }
  if (before !== after) throw new Error('Paused Bundle code executed.')
}

async function probeRows(path: string): Promise<Array<{ name: string; version: string; event: string; pid: number }>> {
  return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map((line) => {
    const row: unknown = JSON.parse(line)
    if (!record(row) || typeof row.name !== 'string' || typeof row.version !== 'string'
      || !['evaluated', 'active', 'disposed'].includes(String(row.event)) || !Number.isSafeInteger(row.pid) || Number(row.pid) <= 0) throw new Error('Invalid Bundle activation probe.')
    return row as { name: string; version: string; event: string; pid: number }
  })
}
async function until(test: () => Promise<boolean>, reason: string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (!await test()) { if (Date.now() >= deadline) throw new Error(reason); await delay(100) }
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { if (record(error) && error.code === 'ESRCH') return false; throw error }
}
async function listening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (value: boolean): void => { socket.destroy(); done(value) }
    socket.once('connect', () =>{  finish(true) }); socket.once('error', () =>{  finish(false) }); socket.setTimeout(500, () =>{  finish(false) })
  })
}

/**
 * Run only local dependency-free fixture add/remove through the fixed official CLI; pnpm remains a real public runner.
 * @param cli Exact executable and official CLI path.
 * @param context Exclusive isolated root and official core identity.
 * @param args Fixed add/remove arguments constructed by the continuation.
 * @param evidencePath New bounded command output file; failure preserves it before rejecting.
 */
export async function runRecoveryPluginCli(
  cli: PluginRecoveryCli, context: PluginRecoveryContext, args: readonly string[], evidencePath: string,
): Promise<void> {
  if (args[0] !== 'add' && args[0] !== 'remove') throw new Error('Recovery CLI permits only fixture add/remove.')
  if (args.length !== 2 || (args[0] === 'remove' ? ![A, B].includes(args[1]!)
    : !args[1]!.startsWith('file:') || !contains(context.fixtureRoot, args[1]!.slice(5)))) {
    throw new Error('Recovery CLI permits only owned local fixture packages.')
  }
  if (args[0] === 'add') {
    const directory = args[1]!.slice(5)
    await physical(directory)
    const manifest = await json(join(directory, 'package.json'))
    if (!record(manifest) || ![A, B].includes(String(manifest.name)) || !record(manifest.dependencies)
      || Object.keys(manifest.dependencies).length !== 0 || manifest.scripts !== undefined
      || manifest.peerDependencies !== undefined || manifest.optionalDependencies !== undefined || manifest.devDependencies !== undefined) {
      throw new Error('Recovery CLI accepts only dependency-free fixture Bundles without lifecycle scripts.')
    }
  }
  const env = Object.fromEntries(Object.entries(cli.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'
    && !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/iu.test(entry[0])))
  Object.assign(env, { HOME: join(context.core.smokeRoot, 'home'), USERPROFILE: join(context.core.smokeRoot, 'home'),
    DSH_HOME: context.core.harnessHome, ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1', npm_config_offline: 'true',
    npm_config_store_dir: join(context.fixtureRoot, 'pnpm-store'), npm_config_manage_package_manager_versions: 'false' })
  const result = await new Promise<{
    code: number | string | null
    signal: string | null
    killed: boolean
    timedOut: boolean
    stdout: string
    stderr: string
    treeStopFailed: boolean
    pid: number | undefined
  }>((done) => {
    let stdout = '', stderr = '', killed = false, timedOut = false, treeStopFailed = false
    let spawnCode: string | undefined
    let guard: NodeJS.Timeout | undefined
    let settled = false
    const child = spawn(cli.executable, [cli.cliPath, 'plugin', '--profile', 'web', ...args],
      { cwd: context.fixtureRoot, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    const finish = (code: number | string | null, signal: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer); clearTimeout(guard)
      done({ code, signal, killed, timedOut, stdout, stderr, treeStopFailed, pid: child.pid })
    }
    const stop = (): void => {
      if (killed || child.pid === undefined) return
      killed = true
      try { terminateProcessTree(child.pid, 'force', process.platform) } catch { treeStopFailed = true }
      guard = setTimeout(() => { treeStopFailed = true; finish('tree-stop-unconfirmed', null) }, 3_000)
    }
    const timer = setTimeout(() => { timedOut = true; stop() }, 60_000)
    const collect = (source: 'stdout' | 'stderr', bytes: Buffer): void => {
      const current = source === 'stdout' ? stdout : stderr
      const value = current + bytes.toString('utf8')
      if (source === 'stdout') stdout = value.slice(0, 4 * 1024 * 1024)
      else stderr = value.slice(0, 4 * 1024 * 1024)
      if (value.length > 4 * 1024 * 1024) stop()
    }
    child.stdout.on('data', (bytes: Buffer) => { collect('stdout', bytes) })
    child.stderr.on('data', (bytes: Buffer) => { collect('stderr', bytes) })
    child.once('error', (error: NodeJS.ErrnoException) => { spawnCode = error.code ?? 'spawn-error' })
    child.once('close', (code, signal) => {
      finish(spawnCode ?? code, signal)
    })
  })
  await put(evidencePath, { argv: [cli.cliPath, 'plugin', '--profile', 'web', ...args], ...result })
  if (result.code !== 0 || result.signal !== null || result.killed || result.timedOut || result.treeStopFailed) {
    throw new RecoveryCliFailure(result.pid, result.treeStopFailed)
  }
}

async function readCore(path: string): Promise<PackagedDesktopBaseSmokeReceipt> {
  const value = await json(path)
  if (!record(value) || value.schema !== 1 || value.composition !== 'base' || value.platform !== process.platform || value.arch !== 'x64'
    || typeof value.activeSessionId !== 'string' || !value.activeSessionId.startsWith('session-')
    || !record(value.installed) || !record(value.descriptor) || !Array.isArray(value.protectedFiles)
    || !record(value.checks) || !record(value.checks.processCleanup) || value.checks.processCleanup.status !== 'passed'
    || !record(value.checks.portCleanup) || value.checks.portCleanup.status !== 'passed') throw new Error('Invalid or unreleased same-base core receipt.')
  const core = value as unknown as PackagedDesktopBaseSmokeReceipt
  if (core.installed.officialSourceSha !== 'fb2c4b9e698e30edb738bca4cf0618587db7d203') throw new Error('Core receipt is not the fixed official runtime.')
  if (core.installed.mode === 'packaged-appimage') {
    const descriptor = validateDesktopBaseSmokeDescriptor(await json(core.descriptor.path))
    await verifyPackagedAppImageIdentity(core.installed, descriptor, core.smokeRoot)
  }
  for (const file of [core.descriptor, core.installed.executable,
    ...core.installed.mode === 'packaged-appimage' ? [] : core.installed.files, ...core.protectedFiles]) {
    const actual = await baseSmokeFile(file.path)
    if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes) throw new Error('Core receipt bytes changed before continuation.')
  }
  for (const directory of [core.smokeRoot, core.harnessHome, core.userData, core.workspacePath]) await physical(directory)
  for (const directory of [core.harnessHome, core.userData, core.workspacePath]) await confinedBaseSmokePath(core.smokeRoot, directory)
  for (const check of ['processCleanup', 'portCleanup'] as const) {
    const result = core.checks[check]
    if (result?.status !== 'passed') throw new Error('Core receipt has not released native resources.')
    const actual = await baseSmokeFile(result.evidence.path)
    if (actual.sha256 !== result.evidence.sha256) throw new Error('Core cleanup evidence changed.')
    const evidence = await json(actual.path)
    if (!record(evidence) || evidence.runId !== core.runId || !record(evidence.facts)) throw new Error('Invalid core cleanup evidence.')
    const numbers = evidence.facts[check === 'processCleanup' ? 'pids' : 'ports']
    if (!Array.isArray(numbers) || numbers.length === 0 || numbers.some(value => !Number.isSafeInteger(value) || Number(value) <= 0)) {
      throw new Error('Core cleanup has no concrete resources.')
    }
    if (check === 'processCleanup' ? numbers.some(pid => alive(Number(pid)))
      : (await Promise.all(numbers.map(port => listening(Number(port))))).some(Boolean)) throw new Error('Core native resources remain active.')
  }
  return core
}

async function observeCliMount(mount: PluginRecoveryAppImageMount): Promise<BaseSmokeAppImageObservation> {
  if (process.platform !== 'linux' || !Number.isSafeInteger(mount.owner.pid) || mount.owner.pid < 1
    || !/^\d+$/.test(mount.owner.startTime)) throw new Error('Invalid native CLI mount owner.')
  const proc = `/proc/${String(mount.owner.pid)}`
  const processStat = await readFile(join(proc, 'stat'), 'utf8')
  const fields = processStat.slice(processStat.lastIndexOf(')') + 2).trim().split(/\s+/)
  if (fields[19] !== mount.owner.startTime || fields[0] === 'Z') throw new Error('CLI mount owner exited or changed.')
  const image = await stat(mount.observation.appImage, { bigint: true })
  const ownerExecutable = await stat(join(proc, 'exe'), { bigint: true })
  if (image.dev !== ownerExecutable.dev || image.ino !== ownerExecutable.ino
    || await realpath(join(proc, 'exe')) !== await realpath(mount.observation.appImage)
    || await readlink(join(proc, 'ns/mnt')) !== await readlink('/proc/self/ns/mnt')) throw new Error('CLI mount owner is not the original AppImage in this namespace.')
  return { ...mount.observation, mountInfo: await readFile(join(proc, 'mountinfo'), 'utf8') }
}

/**
 * Exercise actual native Bundle pause, canonical CLI reconciliation and validated restoration on a released isolated core run.
 * @param options Fixed runtime, exclusive fixture folder and platform UI driver.
 * @returns A scenario evidence path; intercepted dialogs never yield mergeable native evidence.
 */
export async function runPluginRecoverySmoke(options: PluginRecoverySmokeOptions): Promise<PluginRecoverySmokeResult> {
  const mount = options.cliAppImageMount
  if (mount === undefined) return await runOwnedPluginRecoverySmoke(options)
  let released: Promise<PluginRecoveryResources> | undefined
  const release = (): Promise<PluginRecoveryResources> => {
    released ??= (async () => {
      const resources = await mount.release()
      if (!resources.pids.includes(mount.owner.pid) || resources.pids.some(pid => !Number.isSafeInteger(pid) || pid < 1)
        || resources.ports.some(port => !Number.isSafeInteger(port) || port < 1 || port > 65535)) {
        throw new Error('CLI mount release has an invalid process inventory.')
      }
      await until(async () => resources.pids.every(pid => !alive(pid)), 'CLI mount process cleanup is unconfirmed.')
      await until(async () => (await Promise.all(resources.ports.map(listening))).every(open => !open), 'CLI mount port cleanup is unconfirmed.')
      try {
        await lstat(mount.observation.appDir)
        throw new Error('CLI AppImage mount directory remains after release.')
      } catch (error) { if (!record(error) || error.code !== 'ENOENT') throw error }
      return resources
    })()
    return released
  }
  try { return await runOwnedPluginRecoverySmoke({ ...options, cliAppImageMount: { ...mount, release } }) }
  finally { await release() }
}

async function runOwnedPluginRecoverySmoke(options: PluginRecoverySmokeOptions): Promise<PluginRecoverySmokeResult> {
  const core = await readCore(options.coreReceiptPath)
  await put(join(core.smokeRoot, 'checks/pauseRecovery-attempt.json'), { schema: 1, runId: core.runId, status: 'started' })
  if (options.driver.schemaVersion !== 1) throw new Error('Unsupported Bundle recovery driver version.')
  await physical(options.fixtureRoot)
  await confinedBaseSmokePath(core.smokeRoot, options.fixtureRoot)
  const descriptor = validateDesktopBaseSmokeDescriptor(await json(core.descriptor.path))
  const cliIdentity = core.installed.mode === 'packaged-appimage'
    ? await verifyRemountedAppImageIdentity(core.installed, await observeCliMount(options.cliAppImageMount
      ?? (() => { throw new Error('Direct AppImage recovery requires a held native CLI mount.') })()), descriptor)
    : core.installed
  const runtime = resolveDesktopRuntime(join(cliIdentity.appPath, 'package.json'))
  if (runtime.kind !== 'base' || await realpath(runtime.cli) !== await realpath(options.cli.cliPath)) throw new Error('Recovery CLI does not match the actual core runtime.')
  const context = { core, fixtureRoot: options.fixtureRoot }
  const fixtures = await createPluginRecoveryFixtures(options.fixtureRoot)
  const canonical = await confinedBaseSmokePath(core.smokeRoot, join(core.harnessHome, 'profiles/web'))
  const originals = new Map<string, Buffer | undefined>()
  for (const name of ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    const path = join(canonical, name)
    try { if (!(await lstat(path)).isFile()) throw new Error('Canonical input is not a regular file.'); originals.set(path, await readFile(path)) }
    catch (error) { if (record(error) && error.code === 'ENOENT') originals.set(path, undefined); else throw error }
  }
  const originalManifest: unknown = JSON.parse(originals.get(join(canonical, 'package.json'))!.toString('utf8'))
  if (!record(originalManifest) || !record(originalManifest.dsh) || !record(originalManifest.dsh.profile)
    || !Array.isArray(originalManifest.dsh.profile.bundles)) throw new Error('Invalid canonical profile before fixture install.')
  const originalBundles = originalManifest.dsh.profile.bundles
  const originalDeps = originalManifest.dependencies ?? {}
  if (!record(originalDeps) || [A, B].some(name => Object.hasOwn(originalDeps, name) || originalBundles.includes(name))) throw new Error('Recovery fixture would overwrite an existing Bundle.')
  let app: ElectronApplication | undefined
  const pids = new Set<number>(), ports = new Set<number>(), confirmations: PluginRecoveryConfirmation[] = []
  const events: string[] = []
  let phase = 'install-fixture', command = 0, installedA: string | undefined, bInstalled = false, aInstalled = false
  let cliCleanupUnconfirmed = false
  let nativeQuiescent = true
  const cli = async (args: string[]): Promise<void> => {
    if (core.installed.mode === 'packaged-appimage') {
      const current = await verifyRemountedAppImageIdentity(core.installed, await observeCliMount(options.cliAppImageMount!), descriptor)
      if (await realpath(options.cli.executable) !== current.executable.path) throw new Error('AppImage CLI must use the verified mounted Electron in Node mode.')
    }
    try { await runRecoveryPluginCli(options.cli, context, args, join(options.fixtureRoot, `cli-${++command}.json`)) } catch (error) {
      if (error instanceof RecoveryCliFailure) {
        cliCleanupUnconfirmed ||= error.cleanupUnconfirmed
        if (error.ownedPid !== undefined && alive(error.ownedPid)) {
          pids.add(error.ownedPid)
          cliCleanupUnconfirmed = true
        }
      }
      throw error
    }
    if (aInstalled && args[1] !== A) installedA = await confinedBaseSmokePath(core.smokeRoot, join(canonical, 'node_modules', A))
    const current = await json(join(canonical, 'package.json')) as { dependencies?: Record<string, unknown>; dsh?: { profile?: { bundles?: string[] } } }
    for (const [name, value] of Object.entries(originalDeps)) if (current.dependencies?.[name] !== value) throw new Error('Canonical CLI changed an adjacent dependency.')
    const remaining = current.dsh?.profile?.bundles?.filter(name => originalBundles.includes(name))
    if (JSON.stringify(remaining) !== JSON.stringify(originalBundles)) throw new Error('Canonical CLI changed adjacent Bundle ordering.')
    const before = originals.get(join(canonical, 'cordis.patch.yml'))
    if (before !== undefined && !(await readFile(join(canonical, 'cordis.patch.yml'))).equals(before)) throw new Error('Canonical CLI changed the user patch.')
  }
  const inventory = async (): Promise<void> => {
    if (app === undefined) return
    const resources = await options.driver.inventory(app)
    if (resources.pids.length === 0 || resources.pids.some(pid => !Number.isSafeInteger(pid) || pid <= 0)
      || resources.ports.some(port => !Number.isSafeInteger(port) || port <= 0 || port > 65535)) throw new Error('Invalid native recovery process inventory.')
    resources.pids.forEach(pid => pids.add(pid)); resources.ports.forEach(port => ports.add(port))
    for (const row of await probeRows(fixtures.probe)) pids.add(row.pid)
  }
  const close = async (): Promise<void> => {
    if (app === undefined) return
    const owned = app
    const rootPid = owned.process().pid
    if (rootPid === undefined) throw new Error('Recovery native root PID is unknown.')
    await closeBaseSmokeOwnedApplication({ rootPid,
      record: (values) => { values.forEach(pid => pids.add(pid)) },
      discover: async () => { await inventory(); return [...pids] },
      quit: async () => { await options.driver.quit(owned); app = undefined },
      waitForQuiescence: async (values) => { await until(async () => values.every(pid => !alive(pid)), 'Recovery left an owned process alive.') },
    })
    await until(async () => (await Promise.all([...ports].map(listening))).every(open => !open), 'Recovery left an owned port listening.')
    nativeQuiescent = true
  }
  const launch = async (healthy: boolean): Promise<void> => {
    nativeQuiescent = false
    app = await options.driver.launch(context)
    const rootPid = app.process().pid
    if (rootPid !== undefined) pids.add(rootPid)
    const actual = await app.evaluate(async ({ app: native }) => ({ executable: process.execPath, appPath: native.getAppPath(),
      resourcesDirectory: process.resourcesPath, appImage: process.env.APPIMAGE, appDir: process.env.APPDIR,
      mountInfo: process.platform === 'linux' ? await (await import('node:fs/promises')).readFile('/proc/self/mountinfo', 'utf8') : '',
      userData: native.getPath('userData'), home: process.env.DSH_HOME, version: native.getVersion() }))
    if (core.installed.mode === 'packaged-appimage') {
      if (actual.appImage === undefined || actual.appDir === undefined) throw new Error('Recovery did not launch the original AppImage directly.')
      await verifyRemountedAppImageIdentity(core.installed, { appImage: actual.appImage, appDir: actual.appDir,
        executablePath: actual.executable, resourcesDirectory: actual.resourcesDirectory,
        appPath: actual.appPath, mountInfo: actual.mountInfo }, descriptor)
    } else if (await realpath(actual.executable) !== core.installed.executable.path
      || await realpath(actual.appPath) !== core.installed.appPath) {
      throw new Error('Native recovery launched a different installation.')
    }
    if (await realpath(actual.userData) !== core.userData || actual.home !== core.harnessHome
      || actual.version !== core.installed.desktopVersion) {
      throw new Error('Native recovery launched a different home or version.')
    }
    if (healthy) await options.driver.waitForHost(app)
    await inventory()
  }
  const snapshot = async (): Promise<DesktopCompatibilitySnapshot> => {
    const page = await options.driver.openRecovery(app!)
    const result = await page.evaluate(async () => await window.dshDesktop?.getCompatibility())
    if (!isDesktopCompatibilitySnapshot(result)) throw new Error('Invalid actual native recovery snapshot.')
    return result
  }
  const entry = async () => (await snapshot()).entries.find(item => item.name === A)
  const mutate = async (action: DesktopPluginMutation['action']): Promise<void> => {
    const page = await options.driver.openRecovery(app!)
    const state = await snapshot()
    const pending = page.evaluate(async mutation => await window.dshDesktop?.mutatePlugin(mutation),
      { name: A, revision: state.revision, action })
    // Register rejection before waiting on the native modal; a failed click is drained by native quit in finally.
    void pending.catch(() => undefined)
    const confirmation = await options.driver.confirmRestart(app!)
    if (confirmation === 'dialog-contract-intercepted' && core.installed.mode !== 'development-stage') {
      throw new Error('Packaged native recovery cannot intercept its confirmation dialog.')
    }
    confirmations.push(confirmation)
    const result = await pending
    if (!isDesktopCompatibilitySnapshot(result)) throw new Error('Native mutation returned an invalid snapshot.')
    await options.driver.waitForHost(app!)
    await inventory()
  }
  const evaluated = async () => (await probeRows(fixtures.probe)).filter(row => row.name === A && row.event === 'evaluated').length
  const excluded = async (before: number): Promise<void> => {
    if (await readFile(join(installedA!, 'cordis.patch.yml'), 'utf8') !== BROKEN_YAML) {
      throw new Error('The paused invalid YAML was silently repaired.')
    }
    verifyRecoveryExclusion(await json(join(core.harnessHome, 'profiles/desktop-base/receipt.json')), A, installedA!, before, await evaluated())
    if ((await entry())?.health !== 'paused') throw new Error('Bundle pause did not survive native startup.')
  }
  let failed: unknown
  try {
    await cli(['add', `file:${fixtures.a}`]); aInstalled = true
    installedA = await confinedBaseSmokePath(core.smokeRoot, join(canonical, 'node_modules', A))
    await launch(true)
    if ((await entry())?.version !== FAILED_VERSION || !(await probeRows(fixtures.probe)).some(row => row.name === A && row.event === 'active')) throw new Error('Initial fixture Bundle did not activate in the real Host.')
    events.push('bundle-observed'); await close()
    phase = 'attributable-load-failure'
    await writeFile(join(fixtures.a, 'cordis.patch.yml'), BROKEN_YAML)
    await writeFile(join(installedA, 'cordis.patch.yml'), BROKEN_YAML)
    const before = await evaluated()
    await launch(false)
    await until(async () => (await entry())?.health === 'suspected', 'First actual startup did not record attributable suspicion.')
    if ((await entry())?.reason !== 'invalid-yaml') throw new Error('Startup failure was not attributable to fixture YAML.')
    await close(); events.push('attributable-load-failed')
    await launch(true); await excluded(before); events.push('bundle-excluded-before-parse'); await close()
    phase = 'canonical-cli-reconciliation'
    await cli(['add', `file:${fixtures.b}`]); bInstalled = true
    await launch(true); await excluded(before)
    if (!(await probeRows(fixtures.probe)).some(row => row.name === B && row.event === 'active')) throw new Error('Independent Bundle B did not activate.')
    await close(); await cli(['remove', B]); bInstalled = false
    await launch(true); await excluded(before)
    events.push('canonical-cli-reconciled', 'paused-state-survived-restart')
    phase = 'native-validation'
    await mutate('disable')
    if ((await entry())?.enabled !== false) throw new Error('Native disable choice was not persisted.')
    await close()
    await bundle(fixtures.a, A, RESTORED_VERSION, fixtures.probe)
    await bundle(installedA, A, RESTORED_VERSION, fixtures.probe)
    await launch(true)
    const candidateStart = (await probeRows(fixtures.probe)).length
    await mutate('restore')
    const restored = await entry()
    const candidateRows = (await probeRows(fixtures.probe)).slice(candidateStart)
    if (restored?.health !== 'healthy' || restored.version !== RESTORED_VERSION ||  restored.enabled
      || !candidateRows.some(row => row.name === A && row.version === RESTORED_VERSION && row.event === 'active')) throw new Error('Native fixed-Host validation or preserved user choice was not observed.')
    if (candidateRows.some(row => alive(row.pid))) throw new Error('Validation candidate remained alive after restoration.')
    events.push('candidate-host-validated')
    await mutate('enable')
    if ((await entry())?.enabled !== true || !(await probeRows(fixtures.probe)).some(row => row.name === A && row.version === RESTORED_VERSION && row.event === 'active' && alive(row.pid))) throw new Error('Explicitly enabled repaired Bundle is not active.')
    events.push('bundle-restored')
    phase = 'ordinary-conversation'
    const turn = await options.driver.continueConversation(app!, context)
    await confinedBaseSmokePath(core.harnessHome, turn.persistedLogPath)
    const log = await readFile(turn.persistedLogPath, 'utf8')
    if (!turn.completed || turn.activeSessionId !== core.activeSessionId || turn.userText.length === 0 || turn.assistantText.length === 0
      || !log.includes(JSON.stringify(turn.userText).slice(1, -1)) || !log.includes(JSON.stringify(turn.assistantText).slice(1, -1))) throw new Error('Ordinary conversation did not complete in the same persisted Session.')
    events.push('conversation-completed')
    await close()
  } catch (error) {
    failed = error
    await put(join(options.fixtureRoot, 'first-failure.json'), { schema: 1, phase, events, errorName: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown recovery failure' })
  } finally {
    try {
      try { await close() } catch (error) { failed ??= error }
      if (!nativeQuiescent || cliCleanupUnconfirmed || [...pids].some(alive)) {
        throw failed ?? new Error('Canonical restoration withheld while owned processes remain alive.')
      }
      try {
        if (bInstalled) await cli(['remove', B])
        if (aInstalled) await cli(['remove', A])
      } catch (error) { failed ??= error }
      if (cliCleanupUnconfirmed) throw failed
      for (const [path, original] of originals) {
        if (original === undefined) await rm(path, { force: true })
        else await writeFile(path, original)
      }
    } finally {
      if (options.cliAppImageMount !== undefined) {
        const released = await options.cliAppImageMount.release()
        if (!released.pids.includes(options.cliAppImageMount.owner.pid)) throw new Error('CLI mount cleanup omitted its owner.')
        released.pids.forEach(pid => pids.add(pid)); released.ports.forEach(port => ports.add(port))
        await until(async () => [...pids].every(pid => !alive(pid)), 'CLI mount process cleanup is unconfirmed.')
        try {
          await lstat(options.cliAppImageMount.observation.appDir)
          throw new Error('CLI AppImage mount directory remains after release.')
        } catch (error) { if (!record(error) || error.code !== 'ENOENT') throw error }
      }
    }
  }
  if (failed !== undefined) throw failed
  for (const file of core.protectedFiles) if ((await baseSmokeFile(file.path)).sha256 !== file.sha256) throw new Error('A protected old Session or workspace file changed.')
  if (pids.size === 0 || ports.size === 0) throw new Error('Native recovery lacks observed process or port evidence.')
  events.push('all-owned-pids-gone', 'ports-closed')
  if (JSON.stringify(events) !== JSON.stringify(BASE_SMOKE_EVENTS.pauseRecovery)) throw new Error('Bundle recovery event chain differs from the shared descriptor.')
  const status = pluginRecoveryConfirmationStatus(confirmations)
  const evidence: Omit<BaseSmokeEvidence, 'status'> & { status: PluginRecoverySmokeResult['status'] } = {
    schema: 1, runId: core.runId, check: 'pauseRecovery', status, descriptorSha256: core.descriptor.sha256,
    executableSha256: core.installed.executable.sha256, events,
    facts: { bundleName: A, failedVersion: FAILED_VERSION, restoredVersion: RESTORED_VERSION, activeSessionId: core.activeSessionId,
      persistedPausedState: true, restoredPluginActive: true, userChoicePreserved: true, confirmations,
      confirmation: status === 'passed' ? 'native-dialog-clicked' : 'dialog-contract-intercepted',
      pids: [...pids], ports: [...ports], alivePids: [], listeningPorts: [], canonicalRestored: true,
      exclusionEvidence: 'invalid-yaml-retained-and-absent-from-official-composition-inputs-and-execution-probe' },
  }
  const evidencePath = status === 'passed' ? join(core.smokeRoot, 'checks/pauseRecovery.json') : join(options.fixtureRoot, 'pauseRecovery.development.json')
  await put(evidencePath, evidence)
  return { status, evidencePath, fixtureRoot: options.fixtureRoot }
}
