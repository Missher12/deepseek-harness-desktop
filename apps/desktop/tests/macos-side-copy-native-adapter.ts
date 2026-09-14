/** Mac native consumers bind shared descriptors before invoking foundation-owned operations. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createConnection } from 'node:net'
import { _electron as electron, type Locator, type Page } from 'playwright'
import { promisify } from 'node:util'
import { constants, createReadStream } from 'node:fs'
import { access, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { baseSmokeScaleArguments, closeBaseSmokeOwnedApplication, waitForPackagedBaseReady, runPackagedDesktopBaseSmoke, type PackagedDesktopBaseSmokeResult } from './packaged-base-smoke.ts'
import { BASE_SMOKE_EVENTS, baseSmokeFile, confinedBaseSmokePath, completePackagedDesktopBaseSmokeReceipt, verifyPackagedDesktopBaseSmokeReceipt, type BaseSmokeEvidence, type PackagedDesktopBaseSmokeReceipt } from './base-smoke-receipt.ts'
import { terminateProcessTree } from '../src/harness/process-tree.ts'
import { withOwnedPickerAutomation } from './native-directory-picker-smoke.ts'
import { verifyBaseLegacyFixture } from './base-legacy-fixture.ts'
import { validateDesktopBaseSmokeDescriptor, type DesktopBaseSmokeDescriptor } from '../../../scripts/desktop-base-contract.ts'

/** Explicit artifact identity supplied by the native job, never inferred from a daily installation. */
export interface MacBaseSmokeRequest {
  readonly application: string
  readonly descriptorPath: string
  readonly descriptorSha256: string
  readonly asarSha256: string
  readonly sourceSha: string
  readonly expectedDesktopVersion: string
}

/** Verified Mac layout; this record is input validation, not runtime readiness evidence. */
export interface MacBaseSmokeInputs extends MacBaseSmokeRequest {
  readonly descriptor: DesktopBaseSmokeDescriptor
  readonly resources: string
  readonly executable: string
  readonly coreRoot: string
  readonly requiredFiles: readonly string[]
}

const REQUIRED_ENV = [
  'DSH_DESKTOP_SMOKE_DESCRIPTOR', 'DSH_DESKTOP_SMOKE_DESCRIPTOR_SHA256',
  'DSH_MACOS_CANDIDATE_ASAR_SHA256', 'DSH_MACOS_SOURCE_SHA',
] as const

/**
 * Resolve the explicit native request; ordinary offline test discovery supplies none.
 * @param env - Invocation environment, passed explicitly to avoid process-global mutation.
 * @param application - Candidate app selected by the platform caller.
 * @param version - Expected Desktop version read from the current source manifest.
 * @returns Complete request, or undefined only when native acceptance was not requested.
 */
export function macBaseSmokeRequestFromEnvironment(
  env: NodeJS.ProcessEnv, application: string, version: string,
): MacBaseSmokeRequest | undefined {
  if (env.DSH_MACOS_REQUIRE_NATIVE !== undefined && !['0', '1'].includes(env.DSH_MACOS_REQUIRE_NATIVE)) {
    throw new Error('DSH_MACOS_REQUIRE_NATIVE must be 0 or 1.')
  }
  const requested = env.DSH_MACOS_REQUIRE_NATIVE === '1' || REQUIRED_ENV.some(key => env[key] !== undefined)
  if (!requested) return undefined
  const [descriptorPath, descriptorSha256, asarSha256, sourceSha] = REQUIRED_ENV.map(key => env[key])
  if (!descriptorPath || !descriptorSha256 || !asarSha256 || !sourceSha) {
    throw new Error('Mac native acceptance requires all descriptor, artifact and source inputs.')
  }
  return { application, descriptorPath, descriptorSha256, asarSha256, sourceSha, expectedDesktopVersion: version }
}

function within(root: string, path: string): boolean {
  const local = relative(root, path)
  return local !== '' && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local)
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const value of createReadStream(path)) {
    const chunk: unknown = value
    if (!Buffer.isBuffer(chunk)) throw new Error('Mac artifact stream is not binary.')
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/**
 * Map a shared descriptor path to the Mac Resources directory without following an escape.
 * @param resources - Physical Contents/Resources root.
 * @param requiredPath - Validated descriptor path with its abstract resources/ prefix.
 * @returns Physical regular file confined to the app's Resources tree.
 */
export async function macRequiredResource(resources: string, requiredPath: string): Promise<string> {
  const parts = requiredPath.split('/')
  if (parts.shift() !== 'resources' || parts.length === 0
    || parts.some(part => part === '' || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) {
    throw new Error('Invalid Mac resource descriptor path.')
  }
  const path = await realpath(join(resources, ...parts))
  if (!within(resources, path)) throw new Error('Required file resolves outside Mac resources.')
  if (!(await lstat(path)).isFile()) throw new Error('Required Mac resource is not a regular file.')
  return path
}

/**
 * Verify descriptor bytes, fixed shared requirements, packaged metadata and the candidate ASAR.
 * @param request - Explicit expected versions and trusted artifact hashes from the native job.
 * @returns Verified paths for a foundation smoke or update adapter; no application is launched.
 */
export async function loadMacBaseSmokeInputs(request: MacBaseSmokeRequest): Promise<MacBaseSmokeInputs> {
  if (!/^[0-9a-f]{40}$/u.test(request.sourceSha)) throw new Error('Mac source SHA must be complete.')
  if (!isAbsolute(request.application) || !isAbsolute(request.descriptorPath)) {
    throw new Error('Mac native inputs require absolute artifact paths.')
  }
  const application = await realpath(request.application)
  if (application === '/Applications' || application.startsWith('/Applications/')) {
    throw new Error('Mac native acceptance must not consume a daily application.')
  }
  const descriptorBytes = await readFile(request.descriptorPath)
  if (!/^[0-9a-f]{64}$/u.test(request.descriptorSha256)
    || createHash('sha256').update(descriptorBytes).digest('hex') !== request.descriptorSha256) {
    throw new Error('Mac descriptor SHA-256 differs from the trusted input.')
  }
  const rawDescriptor: unknown = JSON.parse(descriptorBytes.toString('utf8'))
  const descriptor = validateDesktopBaseSmokeDescriptor(rawDescriptor)
  if (descriptor.platform !== 'darwin' || descriptor.arch !== 'x64') throw new Error('Mac descriptor must target darwin/x64.')
  if (descriptor.desktopVersion !== request.expectedDesktopVersion) throw new Error('Mac descriptor version differs from source.')
  const resources = await realpath(join(application, 'Contents/Resources'))
  if (!within(application, resources)) throw new Error('Resources resolve outside the Mac application.')
  const requiredFiles = []
  for (const path of descriptor.requiredPaths) requiredFiles.push(await macRequiredResource(resources, path))
  const asar = await macRequiredResource(resources, 'resources/app.asar')
  if (!/^[0-9a-f]{64}$/u.test(request.asarSha256) || await digest(asar) !== request.asarSha256) {
    throw new Error('Mac app.asar SHA-256 differs from the candidate.')
  }
  const metadataPath = await macRequiredResource(resources, 'resources/update-metadata.json')
  const metadata: unknown = JSON.parse(await readFile(metadataPath, 'utf8'))
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)
    || !('schema' in metadata) || metadata.schema !== 1
    || !('desktopVersion' in metadata) || metadata.desktopVersion !== descriptor.desktopVersion
    || !('harnessVersion' in metadata) || metadata.harnessVersion !== descriptor.harnessVersion
    || !('platform' in metadata) || metadata.platform !== 'darwin'
    || !('arch' in metadata) || metadata.arch !== 'x64') {
    throw new Error('Packaged Mac metadata differs from the accepted descriptor.')
  }
  const executable = await realpath(join(application, 'Contents/MacOS/DeepSeek Harness'))
  if (!within(application, executable) || !(await lstat(executable)).isFile()) {
    throw new Error('Mac executable escapes the application or is not regular.')
  }
  await access(executable, constants.X_OK)
  const coreRoot = await realpath(join(resources, ...descriptor.coreRoot.split('/').slice(1)))
  if (!within(resources, coreRoot) || !(await lstat(coreRoot)).isDirectory()) throw new Error('Mac official runtime escapes resources.')
  return { ...request, application, resources, descriptor, executable, coreRoot, requiredFiles }
}

/** Required owned fixture paths for one core run. */
export interface MacBaseCoreOptions {
  readonly smokeRoot: string
  readonly legacyFixturePath: string | undefined
  readonly scalePercent?: 100 | 150
  readonly picker?: MacPickerPolicy
}

/** Core completion stays distinct from a complete native acceptance receipt. */
export interface MacBaseCoreRun {
  readonly inputs: MacBaseSmokeInputs
  readonly smokeRoot: string
  readonly result: PackagedDesktopBaseSmokeResult
}

const SMOKE_ENV = ['DSH_DESKTOP_SMOKE_ROOT', 'DSH_DESKTOP_SMOKE_DSH_HOME', 'DSH_DESKTOP_SMOKE_USER_DATA',
  'DSH_DESKTOP_SMOKE_DESCRIPTOR', 'DSH_DESKTOP_SMOKE_LEGACY_FIXTURE'] as const
let coreTail: Promise<unknown> = Promise.resolve()

/**
 * Run the foundation core with its verified historical fixture and restore exact environment state.
 * @param request - Candidate artifact identity.
 * @param options - Existing owned smoke root and real old-reader fixture receipt.
 * @returns Core output, which remains partial until separately owned continuation evidence is complete.
 */
export function runMacBaseCore(request: MacBaseSmokeRequest, options: MacBaseCoreOptions): Promise<MacBaseCoreRun> {
  const picker = options.picker ?? macPickerPolicyFromEnvironment({})
  const operation = coreTail.then(async () => {
    if (!options.legacyFixturePath) throw new Error('Mac base acceptance requires a real legacy fixture receipt.')
    if (process.platform !== 'darwin' || process.arch !== 'x64') throw new Error('Mac base core requires Intel macOS.')
    if (process.env.DSH_DESKTOP_SMOKE_STAGE !== undefined) throw new Error('Mac packaged consumers reject development-stage launches.')
    const inputs = await loadMacBaseSmokeInputs(request)
    const smokeRoot = await realpath(options.smokeRoot)
    const legacy = await verifyBaseLegacyFixture(options.legacyFixturePath, { isolationRoot: smokeRoot, platform: 'darwin' })
    const previous = Object.fromEntries(SMOKE_ENV.map(key => [key, process.env[key]]))
    try {
      Object.assign(process.env, { DSH_DESKTOP_SMOKE_ROOT: smokeRoot, DSH_DESKTOP_SMOKE_DSH_HOME: legacy.dshHome,
        DSH_DESKTOP_SMOKE_USER_DATA: join(smokeRoot, 'electron-data'), DSH_DESKTOP_SMOKE_DESCRIPTOR: request.descriptorPath,
        DSH_DESKTOP_SMOKE_LEGACY_FIXTURE: options.legacyFixturePath })
      const result = await runPackagedDesktopBaseSmoke(inputs.executable, 'darwin', options.scalePercent === undefined ? {} : { scalePercent: options.scalePercent })
      if (result.composition !== 'base' || await realpath(result.receiptPath) !== join(smokeRoot, 'base-smoke-receipt.json')) {
        throw new Error('Mac base core returned a different composition or receipt root.')
      }
      const run = { inputs, smokeRoot, result }
      await completeMacCore(run, options.legacyFixturePath, picker, options.scalePercent)
      return run
    } finally {
      for (const key of SMOKE_ENV) {
        if (previous[key] === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = previous[key]
      }
    }
  })
  coreTail = operation.then(() => undefined, () => undefined)
  return operation
}

/** Portable core evidence retains the explicitly unverified recovery scenario. */
export interface MacVerifiedBaseEvidence {
  schema: 1
  composition: 'base'
  acceptance: 'core-passed'
  pickerMode: 'automatic' | 'manual'
  unverifiedChecks: ['pauseRecovery']
  continuation: { bytes: number; sha256: string }
  sourceSha: string
  descriptorSha256: string
  appAsarSha256: string
  desktopVersion: string
  harnessVersion: string
  executableSha256: string
  infoPlistSha256: string
  architecture: 'x86_64'
  receipt: { bytes: number; sha256: string }
  installedFiles: { name: string; bytes: number; sha256: string }[]
  primaryDisplayScaleFactor: number
  rendererDevicePixelRatio: number
}

async function nativeText(command: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await promisify(execFile)(command, args, { cwd, encoding: 'utf8', timeout: 15_000,
    maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C' } })
  return stdout.trim()
}

/**
 * Verify scoped shared evidence, actual Mac binary/plist, clean source revision, and unchanged inputs.
 * @param run - Result of the core and Mac historical UI/directory-picker continuation.
 * @returns Portable core evidence; this does not certify a side-copy installer transaction or enhancements.
 */
export async function verifyMacBaseRun(run: MacBaseCoreRun): Promise<MacVerifiedBaseEvidence> {
  if (process.platform !== 'darwin' || process.arch !== 'x64') throw new Error('Mac native verification requires Intel macOS.')
  const receipt = await verifyPackagedDesktopBaseSmokeReceipt(run.result.receiptPath, {
    platform: 'darwin', descriptorPath: run.inputs.descriptorPath, smokeRoot: run.smokeRoot, scope: 'core',
  })
  const continuation = await verifyMacContinuation(run, receipt)
  const inputs = await loadMacBaseSmokeInputs(run.inputs)
  if (receipt.installed.mode !== 'packaged' || receipt.installed.executable.path !== inputs.executable
    || receipt.installed.resourcesDirectory !== inputs.resources
    || receipt.descriptor.sha256 !== inputs.descriptorSha256) throw new Error('Mac native receipt differs from the selected artifact.')
  const repositoryRoot = resolve(import.meta.dirname, '../../..')
  if (await nativeText('/usr/bin/git', ['rev-parse', 'HEAD'], repositoryRoot) !== inputs.sourceSha
    || await nativeText('/usr/bin/git', ['status', '--porcelain', '--untracked-files=normal'], repositoryRoot) !== '') {
    throw new Error('Mac native evidence requires the exact clean source revision.')
  }
  if (await nativeText('/usr/bin/lipo', ['-archs', inputs.executable]) !== 'x86_64') throw new Error('Mac candidate is not Intel x86_64 only.')
  const plist = await realpath(join(inputs.application, 'Contents/Info.plist'))
  if (!within(inputs.application, plist)) throw new Error('Info.plist escapes the candidate app.')
  const version = await nativeText('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist])
  const bundle = await nativeText('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist])
  if (version !== inputs.expectedDesktopVersion || bundle !== 'ai.deepseek.harness.desktop') throw new Error('Mac Info.plist identity mismatch.')
  if (receipt.outcome !== 'core-passed' || receipt.checks.pauseRecovery?.status !== 'not-run') {
    throw new Error('Mac core consumer requires explicit unverified pauseRecovery evidence.')
  }
  const file = await baseSmokeFile(run.result.receiptPath)
  return { schema: 1, composition: 'base', acceptance: 'core-passed', pickerMode: continuation.pickerMode, unverifiedChecks: ['pauseRecovery'],
    continuation: { bytes: continuation.bytes, sha256: continuation.sha256 }, sourceSha: inputs.sourceSha,
    descriptorSha256: inputs.descriptorSha256, appAsarSha256: inputs.asarSha256, desktopVersion: version,
    harnessVersion: receipt.installed.harnessVersion, executableSha256: receipt.installed.executable.sha256,
    infoPlistSha256: (await baseSmokeFile(plist)).sha256, architecture: 'x86_64', receipt: { bytes: file.bytes, sha256: file.sha256 },
    installedFiles: receipt.installed.files.map(item => ({
      name: relative(inputs.resources, item.path), bytes: item.bytes, sha256: item.sha256,
    })),
    primaryDisplayScaleFactor: receipt.primaryDisplayScaleFactor, rendererDevicePixelRatio: receipt.rendererDevicePixelRatio }
}

/**
 * Require independent pre-produced legacy fixtures for current native startup observations.
 * @param value - Parsed JSON array supplied by the platform operator.
 * @returns One or ten unique normalized fixture roots; their contents are verified by the shared core consumer.
 */
export function decodeMacStartupFixtures(value: unknown): MacBaseCoreOptions[] {
  if (!Array.isArray(value) || ![1, 10].includes(value.length)) throw new Error('Startup requires one or ten explicit fixtures.')
  const roots = new Set<string>()
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item) || Object.keys(item).length !== 2
      || !('smokeRoot' in item) || typeof item.smokeRoot !== 'string' || !isAbsolute(item.smokeRoot)
      || resolve(item.smokeRoot) !== item.smokeRoot || item.smokeRoot === '/'
      || !('legacyFixturePath' in item) || typeof item.legacyFixturePath !== 'string' || !isAbsolute(item.legacyFixturePath)
      || resolve(item.legacyFixturePath) !== item.legacyFixturePath || !within(item.smokeRoot, item.legacyFixturePath)) {
      throw new Error('Startup fixtures require normalized owned roots and legacy receipts.')
    }
    if (roots.has(item.smokeRoot)) throw new Error('Startup fixtures must use distinct smoke roots.')
    roots.add(item.smokeRoot)
    return { smokeRoot: item.smokeRoot, legacyFixturePath: item.legacyFixturePath }
  })
}

/** Select only a live application's descendants from a native process snapshot.
 * @param snapshot Output of ps pid, parent pid and executable columns.
 * @param rootPid PID returned by the owned Electron launcher.
 * @returns Owned process identities, including the root; missing roots fail closed.
 */
export function macOwnedProcesses(snapshot: string, rootPid: number): { pid: number; command: string }[] {
  const rows = snapshot.trim().split('\n').map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line)
    if (match === null) throw new Error('Invalid Mac process inventory.')
    return { pid: Number(match[1]), parent: Number(match[2]), command: match[3]! }
  })
  if (!rows.some(row => row.pid === rootPid)) throw new Error('Owned Mac application root is absent.')
  const ids = new Set([rootPid])
  for (let changed = true; changed;) {
    changed = false
    for (const row of rows) if (ids.has(row.parent) && !ids.has(row.pid)) { ids.add(row.pid); changed = true }
  }
  return rows.filter(row => ids.has(row.pid)).map(({ pid, command }) => ({ pid, command }))
}

async function untilMac(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(100)
  }
  throw new Error(message)
}

function macProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

async function macPortOpen(port: number): Promise<boolean> {
  return await new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (open: boolean): void => { socket.destroy(); resolvePort(open) }
    socket.once('connect', () => { finish(true) })
    socket.once('error', () => { finish(false) })
    socket.setTimeout(500, () => { finish(true) })
  })
}

/** Resolve one new owned picker and verify its exact system executable from PID-scoped lsof output.
 * @param owned Current root-descendant inventory from macOwnedProcesses.
 * @param before PIDs observed before the Add workspace action.
 * @param inspect Reads text-image fields for exactly the candidate PID; errors remain failures.
 * @returns The unique verified picker PID, or undefined when no candidate has appeared.
 */
export async function findMacPickerProcess(owned: readonly { pid: number; command: string }[], before: ReadonlySet<number>,
  inspect: (pid: number) => Promise<string>): Promise<number | undefined> {
  const candidates = owned.filter(row => !before.has(row.pid) && ['osascript', '/usr/bin/osascript'].includes(row.command))
  if (candidates.length > 1) throw new Error('More than one owned native folder picker appeared.')
  const candidate = candidates[0]
  if (candidate === undefined) return undefined
  const fields = (await inspect(candidate.pid)).trim().split('\n')
  if (JSON.stringify(fields.filter(field => field.startsWith('p'))) !== JSON.stringify([`p${candidate.pid}`])
    || !fields.includes('n/usr/bin/osascript')) throw new Error('Owned picker system image is not verified.')
  return candidate.pid
}

/** Native picker automation receives its owned PID and destination as argv, never executable source. */
export const MAC_DIRECTORY_PICKER_SCRIPT = `on run argv
set targetPid to (item 1 of argv) as integer
set folderPath to item 2 of argv
tell application "System Events"
  set targetProcess to first application process whose unix id is targetPid
  tell targetProcess
    set frontmost to true
    repeat 100 times
      if exists window 1 then exit repeat
      delay 0.1
    end repeat
    if not (exists window 1) then error "Owned folder dialog is absent"
    keystroke "g" using {command down, shift down}
    repeat 100 times
      if exists sheet 1 of window 1 then exit repeat
      delay 0.1
    end repeat
    if not (exists sheet 1 of window 1) then error "Go to folder sheet is absent"
    set value of text field 1 of sheet 1 of window 1 to folderPath
    key code 36
    repeat 100 times
      if not (exists sheet 1 of window 1) then exit repeat
      delay 0.1
    end repeat
    if exists sheet 1 of window 1 then error "Go to folder did not finish"
    if exists button "Choose" of window 1 then
      click button "Choose" of window 1
    else if exists button "选择" of window 1 then
      click button "选择" of window 1
    else if exists button "选取" of window 1 then
      click button "选取" of window 1
    else
      error "Owned dialog Choose button is absent"
    end if
  end tell
end tell
end run`

/** Explicit native picker interaction policy; automatic failures never switch modes. */
export type MacPickerPolicy = { readonly mode: 'automatic' } | { readonly mode: 'manual'; readonly timeoutMs: number }

/** Parse the platform operator's explicit picker mode and bounded manual wait.
 * @param env Invocation environment, without modifying process-global state.
 * @returns Automatic by default, or a manual wait of 1000 through 600000 milliseconds.
 */
export function macPickerPolicyFromEnvironment(env: NodeJS.ProcessEnv): MacPickerPolicy {
  const mode = env.DSH_MACOS_PICKER_MODE ?? 'automatic'
  const timeout = env.DSH_MACOS_PICKER_TIMEOUT_MS
  if (!['automatic', 'manual'].includes(mode)) throw new Error('Mac picker mode must be automatic or manual.')
  if (mode === 'automatic') {
    if (timeout !== undefined) throw new Error('Mac picker timeout is only valid in explicit manual mode.')
    return { mode }
  }
  const timeoutMs = timeout === undefined ? 600_000 : Number(timeout)
  if ((timeout !== undefined && !/^[1-9]\d*$/u.test(timeout)) || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1000 || timeoutMs > 600_000) throw new Error('Manual picker timeout must be 1000 through 600000 milliseconds.')
  return { mode: 'manual', timeoutMs }
}

/** Official workspace fields used to bind a new visible row to its canonical directory. */
export interface MacWorkspaceRecord { id: string; path: string; title: string }

function macRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read the fixed official workspace domain's ordered records without inspecting selected directory contents.
 * @param value Parsed owned storages/workspace.json, as defined by official workspace/spec.ts.
 * @returns IDs, canonical full paths and UI titles from global.workspaceIds and tables.workspaces.
 */
export function decodeMacWorkspaceRecords(value: unknown): MacWorkspaceRecord[] {
  if (!macRecord(value) || !macRecord(value.global) || !Array.isArray(value.global.workspaceIds)
    || !macRecord(value.tables) || !macRecord(value.tables.workspaces)) throw new Error('Invalid official workspace registry.')
  const ids = new Set<string>()
  return value.global.workspaceIds.map((id: unknown) => {
    const item = typeof id === 'string' ? (value.tables as { workspaces: Record<string, unknown> }).workspaces[id] : undefined
    if (typeof id !== 'string' || ids.has(id) || !macRecord(item) || typeof item.path !== 'string'
      || !isAbsolute(item.path) || resolve(item.path) !== item.path || typeof item.title !== 'string') throw new Error('Invalid official workspace record.')
    ids.add(id)
    return { id, path: item.path, title: item.title }
  })
}

async function readMacWorkspaces(harnessHome: string): Promise<MacWorkspaceRecord[]> {
  const path = await confinedBaseSmokePath(harnessHome, join(harnessHome, 'storages/workspace.json'))
  return decodeMacWorkspaceRecords(JSON.parse(await readFile(path, 'utf8')) as unknown)
}

/** Wait for the native chooser to exit and the official registry to adopt exactly the requested new directory.
 * @param read Reads only the owned application's official registry.
 * @param before Workspace IDs observed before Add workspace.
 * @param expectedPath Physical owned directory created for this invocation.
 * @param pickerAlive Reads the confirmed chooser's current process lifetime.
 * @param deadline Absolute deadline; cancellation allows at most 30 seconds for an in-flight adoption to settle.
 * @returns The newly durable exact-path workspace; cancellation, wrong paths and timeout reject.
 */
export async function waitForMacWorkspaceSelection(read: () => Promise<MacWorkspaceRecord[]>, before: ReadonlySet<string>,
  expectedPath: string, pickerAlive: () => boolean, deadline: number): Promise<MacWorkspaceRecord> {
  let closed = false
  let limit = deadline
  while (Date.now() < limit) {
    const added = (await read()).filter(item => !before.has(item.id))
    if (Date.now() >= limit) break
    if (added.length > 1) throw new Error('Native picker produced more than one new workspace.')
    if (added[0] !== undefined && added[0].path !== expectedPath) throw new Error('Native picker selected a different full path.')
    const running = pickerAlive()
    if (!running && !closed) { closed = true; limit = Math.min(limit, Date.now() + 30_000) }
    if (added[0] !== undefined && !running) return added[0]
    await delay(100)
  }
  if (closed) throw new Error('Native picker closed without the requested new workspace; cancelled or adoption failed.')
  throw new Error('Native picker selection timed out.')
}

/** Execute only the selected picker mode; manual mode never launches an input-automation process.
 * @param policy Explicitly resolved platform mode.
 * @param pid Confirmed new owned system picker PID.
 * @param directory Exact owned target path.
 * @param observe Verifies native process exit and actual official workspace adoption.
 * @returns Verified workspace record, never an acknowledgement from outside the application.
 */
export async function runMacPickerInteraction(policy: MacPickerPolicy, pid: number, directory: string,
  observe: () => Promise<MacWorkspaceRecord>): Promise<MacWorkspaceRecord> {
  if (policy.mode === 'manual') return await observe()
  let selected: MacWorkspaceRecord | undefined
  await withOwnedPickerAutomation('/usr/bin/osascript', ['-e', MAC_DIRECTORY_PICKER_SCRIPT, String(pid), directory],
    async () => { selected = await observe() })
  if (selected === undefined) throw new Error('Automatic picker did not verify a workspace result.')
  return selected
}

interface MacPickerSelection { pid: number; mode: 'automatic' | 'manual'; workspace: MacWorkspaceRecord }

async function selectMacDirectory(page: Page, selectedDirectory: string, harnessHome: string, policy: MacPickerPolicy,
  scalePercent: number, smokeRoot: string, inventory: () => Promise<{ pid: number; command: string }[]>): Promise<MacPickerSelection> {
  await mkdir(selectedDirectory, { mode: 0o700 })
  const directory = await confinedBaseSmokePath(smokeRoot, selectedDirectory)
  const previousWorkspaces = new Set((await readMacWorkspaces(harnessHome)).map(item => item.id))
  const before = new Set((await inventory()).map(row => row.pid))
  const button = page.getByRole('button', { name: /^(?:Add workspace|添加工作区)$/u })
  await button.click({ timeout: 30_000 })
  let pickerPid: number | undefined
  await untilMac(async () => {
    pickerPid = await findMacPickerProcess(await inventory(), before,
      async pid => await nativeText('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn']))
    return pickerPid !== undefined
  }, 'Owned native folder picker did not appear.')
  if (pickerPid === undefined) throw new Error('Owned picker PID is missing.')
  const pid = pickerPid
  let deadline = Date.now() + (policy.mode === 'manual' ? policy.timeoutMs : 30_000)
  if (policy.mode === 'manual') {
    const title = await nativeText('/usr/bin/osascript', ['-e', `on run argv
set p to (item 1 of argv) as integer
tell application "System Events"
  tell (first application process whose unix id is p)
    repeat 100 times
      if exists window 1 then exit repeat
      delay 0.1
    end repeat
    if (count windows) is not 1 then error "Unique owned picker window is absent"
    if (value of attribute "AXIdentifier" of window 1) is not "open-panel" then error "Owned open-panel is absent"
    return name of window 1
  end tell
end tell
end run`, String(pid)])
    deadline = Date.now() + policy.timeoutMs
    const pending = { kind: 'mac-picker-awaiting-user', mode: 'manual', expectedPath: directory, pickerPid: pid,
      windowTitle: title, windowIdentifier: 'open-panel', scalePercent, deadline: new Date(deadline).toISOString() }
    await writeFile(join(smokeRoot, 'checks/mac-picker-awaiting-user.json'), `${JSON.stringify(pending, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    process.stdout.write(`${JSON.stringify(pending)}\n`)
  }
  const workspace = await runMacPickerInteraction(policy, pid, directory, async () => await waitForMacWorkspaceSelection(
    () => readMacWorkspaces(harnessHome), previousWorkspaces, directory, () => macProcessAlive(pid), deadline))
  const row = page.locator('[role="treeitem"][aria-expanded]').filter({ has: page.getByText(workspace.title, { exact: true }) })
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  if (await row.count() !== 1) throw new Error('Native folder selection did not create one workspace row.')
  await page.locator('[data-composer-input][contenteditable="true"]:not([aria-disabled="true"])').click({ trial: true, timeout: 30_000 })
  return { pid, mode: policy.mode, workspace }
}

/** Verify the selected official Session row using its existing drag payload.
 * @param row Unique historical row whose selection has settled.
 * @param expectedSessionId ID produced and verified by the historical runtime.
 * @returns After both the actual row ID and selected state match; no drop or reorder is performed.
 */
export async function verifyMacLegacySelection(row: Pick<Locator, 'evaluate'>, expectedSessionId: string): Promise<void> {
  const observed = await row.evaluate((element) => {
    const transfer = new DataTransfer()
    try {
      // Official fb2 Rows.tsx emits node.id as text/plain and derives aria-selected from currentId.
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
      return { sessionId: transfer.getData('text/plain'), selected: element.getAttribute('aria-selected') }
    } finally {
      element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }))
    }
  })
  if (observed.sessionId !== expectedSessionId) throw new Error('Historical UI reopened a different Session.')
  if (observed.selected !== 'true') throw new Error('Historical Session is not selected.')
}

async function completeMacCore(run: MacBaseCoreRun, legacyFixturePath: string, policy: MacPickerPolicy,
  scalePercent?: 100 | 150): Promise<void> {
  const legacy = await verifyBaseLegacyFixture(legacyFixturePath, { isolationRoot: run.smokeRoot, platform: 'darwin' })
  const receipt = JSON.parse(await readFile(run.result.receiptPath, 'utf8')) as PackagedDesktopBaseSmokeReceipt
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|ELECTRON_RUN_AS_NODE/iu.test(entry[0])))
  Object.assign(env, { HOME: join(run.smokeRoot, 'home'), USERPROFILE: join(run.smokeRoot, 'home'),
    DSH_HOME: legacy.dshHome, CODEX_HOME: join(run.smokeRoot, 'home/codex'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: '' })
  const application = await electron.launch({ executablePath: run.inputs.executable,
    args: [`--user-data-dir=${run.result.userData}`, ...baseSmokeScaleArguments(scalePercent)],
    cwd: legacy.workspacePath, env, timeout: 90_000 })
  const pids = new Set<number>()
  const ports = new Set<number>()
  let pickerPid: number | undefined
  let failure: unknown
  let pickerSelection: MacPickerSelection | undefined
  let onboarding: Awaited<ReturnType<typeof waitForPackagedBaseReady>> | undefined
  const rootPid = application.process().pid
  if (rootPid !== undefined) pids.add(rootPid)
  const inventory = async (): Promise<{ pid: number; command: string }[]> => {
    if (rootPid === undefined) throw new Error('Mac continuation launcher did not return a PID.')
    const rows = macOwnedProcesses(await nativeText('/bin/ps', ['-axo', 'pid=,ppid=,comm=']), rootPid)
    for (const row of rows) pids.add(row.pid)
    return rows
  }
  try {
    await inventory()
    const page = await application.firstWindow()
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:/u, { timeout: 60_000 })
    const port = Number(new URL(page.url()).port)
    if (!Number.isSafeInteger(port) || port <= 0) throw new Error('Mac continuation Harness port is missing.')
    ports.add(port)
    onboarding = await waitForPackagedBaseReady(page, { welcome: 'expected', credentials: 'missing' })
    const observed = await application.evaluate(({ app }) => ({ executable: process.execPath, home: process.env.DSH_HOME,
      userData: app.getPath('userData'), scale: app.commandLine.getSwitchValue('force-device-scale-factor') }))
    if (await realpath(observed.executable) !== run.inputs.executable || observed.home !== legacy.dshHome
      || await realpath(observed.userData) !== run.result.userData
      || observed.scale !== (scalePercent === undefined ? '' : String(scalePercent / 100))) throw new Error('Mac continuation launched a different executable, home, userData or scale.')
    const workspace = page.locator('[role="treeitem"][aria-expanded]').filter({ has: page.getByText('R7 legacy workspace', { exact: true }) })
    await workspace.waitFor({ state: 'visible', timeout: 30_000 })
    if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click()
    const row = page.locator('[role="treeitem"][aria-selected]').filter({ has: page.getByText(legacy.title, { exact: true }) })
    await row.waitFor({ state: 'visible', timeout: 30_000 })
    if (await row.count() !== 1) throw new Error('Historical title does not identify one Session.')
    await row.click()
    await untilMac(async () => await row.getAttribute('aria-selected') === 'true', 'Historical Session is not selected.')
    await verifyMacLegacySelection(row, legacy.sessionId)
    await page.getByText('Legacy fixture complete: R7_LEGACY_TOOL_OK', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
    if (await row.getAttribute('aria-selected') !== 'true') throw new Error('Historical Session is not selected.')
    await page.screenshot({ path: join(run.smokeRoot, 'legacy-reader.png') })
    pickerSelection = await selectMacDirectory(page, join(run.smokeRoot, 'native-picker-selected'), legacy.dshHome, policy,
      scalePercent ?? run.result.rendererDevicePixelRatio * 100, run.smokeRoot, inventory)
    pickerPid = pickerSelection.pid
    await page.screenshot({ path: join(run.smokeRoot, 'native-directory-picker.png') })
  } catch (error) { failure = error } finally {
    try {
      if (rootPid === undefined) { await application.close(); throw new Error('Mac continuation PID is unknown.') }
      await closeBaseSmokeOwnedApplication({ rootPid, record: (tree) => { for (const pid of tree) pids.add(pid) },
        discover: async () => (await inventory()).map(row => row.pid),
        quit: async () => {
          const closed = application.waitForEvent('close', { timeout: 30_000 }).then(() => undefined, (error: unknown) => error)
          try { await application.evaluate(({ app }) => { app.quit() }) } catch (error) {
            await application.close()
            await closed
            throw error
          }
          const error = await closed
          if (error !== undefined) { await application.close(); throw error }
        },
        waitForQuiescence: async () => {
          await untilMac(async () => [...pids].every(pid => !macProcessAlive(pid)), 'Mac continuation left owned processes alive.')
        },
      })
      await untilMac(async () => (await Promise.all([...ports].map(macPortOpen))).every(open => !open), 'Mac continuation left a listening Harness port.')
    } catch (error) {
      failure = failure === undefined ? error : new AggregateError([failure, error], 'Mac continuation and cleanup failed.')
      try {
        for (const pid of pids) if (macProcessAlive(pid)) terminateProcessTree(pid, 'force', 'darwin')
        await untilMac(async () => [...pids].every(pid => !macProcessAlive(pid)), 'Mac continuation force cleanup did not settle.')
      } catch (cleanupError) { failure = new AggregateError([failure, cleanupError], 'Mac continuation could not drain owned processes.') }
    }
  }
  try { await verifyBaseLegacyFixture(legacyFixturePath, { isolationRoot: run.smokeRoot, platform: 'darwin' }) } catch (error) {
    failure = failure === undefined ? error : new AggregateError([failure, error], 'Mac continuation and protected-data verification failed.')
  }
  if (failure !== undefined) throw failure
  const continuationPath = join(run.smokeRoot, 'checks/mac-continuation.json')
  await writeFile(continuationPath, `${JSON.stringify({ schema: 1, runId: receipt.runId, executableSha256: receipt.installed.executable.sha256,
    legacySessionId: legacy.sessionId, directoryPicker: 'native-dialog-clicked', pickerPid, pickerSelection, onboarding,
    pids: [...pids], ports: [...ports], alivePids: [], listeningPorts: [] }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  const evidence: BaseSmokeEvidence = { schema: 1, runId: receipt.runId, check: 'legacyCompatibility', status: 'passed',
    descriptorSha256: receipt.descriptor.sha256, executableSha256: receipt.installed.executable.sha256,
    events: [...BASE_SMOKE_EVENTS.legacyCompatibility], facts: { desktopVersion: legacy.oldVersion, harnessVersion: legacy.harnessVersion,
      sourceSha: legacy.sourceSha, fixtureReceipt: await baseSmokeFile(legacyFixturePath), oldReaderVerified: true,
      oldWorkspacePreserved: true, oldSessionReopened: true, legacySessionId: legacy.sessionId,
      continuation: await baseSmokeFile(continuationPath) } }
  const evidencePath = join(run.smokeRoot, 'checks/legacyCompatibility.json')
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await completePackagedDesktopBaseSmokeReceipt(run.result.receiptPath, { legacyCompatibility: evidencePath }, {
    platform: 'darwin', descriptorPath: run.inputs.descriptorPath, smokeRoot: run.smokeRoot, scope: 'core',
  })
}

async function verifyMacContinuation(run: MacBaseCoreRun, receipt: PackagedDesktopBaseSmokeReceipt) {
  const file = await baseSmokeFile(join(run.smokeRoot, 'checks/mac-continuation.json'))
  if (file.path !== join(run.smokeRoot, 'checks/mac-continuation.json')) throw new Error('Mac continuation evidence was redirected.')
  const legacy = receipt.checks.legacyCompatibility
  if (legacy?.status !== 'passed') throw new Error('Mac historical UI evidence is missing.')
  const historical = JSON.parse(await readFile(legacy.evidence.path, 'utf8')) as BaseSmokeEvidence
  if (JSON.stringify(historical.facts.continuation) !== JSON.stringify(file)) throw new Error('Mac continuation evidence bytes changed.')
  const value: unknown = JSON.parse(await readFile(file.path, 'utf8'))
  if (typeof value !== 'object' || value === null || !('schema' in value) || value.schema !== 1
    || !('runId' in value) || value.runId !== receipt.runId
    || !('executableSha256' in value) || value.executableSha256 !== receipt.installed.executable.sha256
    || !('legacySessionId' in value) || value.legacySessionId !== historical.facts.legacySessionId
    || !('directoryPicker' in value) || value.directoryPicker !== 'native-dialog-clicked'
    || !('pickerPid' in value) || !Number.isSafeInteger(value.pickerPid)
    || !('pids' in value) || !Array.isArray(value.pids) || value.pids.length === 0
    || value.pids.some(pid => !Number.isSafeInteger(pid) || Number(pid) <= 0) || !value.pids.includes(value.pickerPid)
    || !('ports' in value) || !Array.isArray(value.ports) || value.ports.length === 0
    || value.ports.some(port => !Number.isSafeInteger(port) || Number(port) <= 0 || Number(port) > 65535)
    || !('alivePids' in value) || JSON.stringify(value.alivePids) !== '[]'
    || !('listeningPorts' in value) || JSON.stringify(value.listeningPorts) !== '[]') throw new Error('Mac continuation evidence is incomplete.')
  if (value.pids.some(pid => macProcessAlive(Number(pid)))
    || (await Promise.all(value.ports.map(port => macPortOpen(Number(port))))).some(Boolean)) {
    throw new Error('Mac continuation processes or listeners remain live.')
  }
  if (!('pickerSelection' in value) || !macRecord(value.pickerSelection)
    || !['automatic', 'manual'].includes(String(value.pickerSelection.mode)) || value.pickerSelection.pid !== value.pickerPid
    || !macRecord(value.pickerSelection.workspace)) throw new Error('Mac picker selection evidence is missing.')
  const selected = value.pickerSelection.workspace
  const expectedPath = await realpath(join(run.smokeRoot, 'native-picker-selected'))
  const current = (await readMacWorkspaces(run.result.harnessHome)).find(item => item.id === selected.id)
  if (current === undefined || current.path !== expectedPath || selected.path !== expectedPath || selected.title !== current.title) {
    throw new Error('Mac picker workspace no longer matches the requested full path.')
  }
  return { ...file, pickerMode: value.pickerSelection.mode as 'automatic' | 'manual' }
}
