/** Detached macOS installation transaction. After launch is attempted, rollback to an older binary is forbidden. */
import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, renameSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyDesktopUpdateFile } from './verification.ts'
import {
  absoluteMacPath, assertPhysicalPath, assertPrivateDirectory, bytesSha256, createRestartRequest, exactRecord,
  hasErrorCode, publishPrivateRecord, readPhysicalFile, readPrivateRecord, readRestartReady,
  type NativeRestartFacts,
} from './restart-receipt.ts'

const APP_NAME = 'DeepSeek Harness.app'
const BUNDLE_ID = 'ai.deepseek.harness.desktop'
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u
/** The helper protocol is independent from Electron and binds all mutable files to one private transaction. */
export interface UpdateHelperConfig {
  schema: 2
  attemptId: string
  nonce: string
  transactionDirectory: string
  parentPid: number
  currentAppPath: string
  dmgPath: string
  verifiedDownloadDirectory: string
  expectedDesktopVersion: string
  expectedHarnessVersion: string
  expectedSha256: string
  expectedBytes: number
  restart: { home: string; dshHome: string; userData: string }
  files: { node: string; helper: string; source: string; license: string }
}
/** A terminal outcome retains the first failure and names any backup requiring explicit recovery. */
export interface UpdateTransactionOutcome {
  schema: 1
  attemptId: string
  nonce: string
  status: 'installed-host-ready' | 'manual-install-required' | 'failed-before-launch' | 'recovery-required'
  phase: string
  firstError: string | null
  recoveryError: string | null
  newAppMayHaveStarted: boolean
  newAppPid: number | null
  backupPath: string | null
}
/** Native process observation, rather than LaunchServices acknowledgement. */
export interface RestartedProcess { pid: number; hasExited: () => boolean }
/** Injectable operations support offline tests; default operations are bounded native subprocesses. */
export interface UpdateHelperDependencies {
  run?: (command: string, args: readonly string[], timeoutMs: number) => Promise<string>
  spawnApp?: (executable: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<RestartedProcess>
  parentAlive?: (pid: number) => boolean
  canWrite?: (directory: string) => boolean
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  signal?: AbortSignal
}
/** Reject unknown JSON fields, unsafe paths, and stale schema-1 Electron helper requests.
 * @param value Decoded private request file.
 * @returns A closed request or null when any field is unsafe.
 */
export function validateUpdateHelperConfig(value: unknown): UpdateHelperConfig | null {
  if (!exactRecord(value, ['schema', 'attemptId', 'nonce', 'transactionDirectory', 'parentPid', 'currentAppPath', 'dmgPath',
    'verifiedDownloadDirectory', 'expectedDesktopVersion', 'expectedHarnessVersion', 'expectedSha256', 'expectedBytes', 'restart', 'files'])
    || value.schema !== 2 || !Number.isSafeInteger(value.parentPid) || Number(value.parentPid) <= 0
    || typeof value.attemptId !== 'string' || !/^[a-f\d]{32}$/u.test(value.attemptId)
    || typeof value.nonce !== 'string' || !/^[a-f\d]{64}$/u.test(value.nonce)
    || !absoluteMacPath(value.currentAppPath) || basename(value.currentAppPath) !== APP_NAME
    || !absoluteMacPath(value.dmgPath) || !absoluteMacPath(value.verifiedDownloadDirectory)
    || dirname(value.dmgPath) !== value.verifiedDownloadDirectory
    || !absoluteMacPath(value.transactionDirectory) || dirname(value.transactionDirectory) !== value.verifiedDownloadDirectory
    || !basename(value.transactionDirectory).startsWith('desktop-update-')
    || typeof value.expectedDesktopVersion !== 'string' || !VERSION.test(value.expectedDesktopVersion)
    || typeof value.expectedHarnessVersion !== 'string' || !VERSION.test(value.expectedHarnessVersion)
    || basename(value.dmgPath) !== `DeepSeek-Harness-${value.expectedDesktopVersion}-mac-x64.dmg`
    || typeof value.expectedSha256 !== 'string' || !/^[a-f\d]{64}$/u.test(value.expectedSha256)
    || !Number.isSafeInteger(value.expectedBytes) || Number(value.expectedBytes) <= 0
    || !exactRecord(value.restart, ['home', 'dshHome', 'userData']) || !Object.values(value.restart).every(absoluteMacPath)
    || !exactRecord(value.files, ['node', 'helper', 'source', 'license'])
    || !Object.values(value.files).every(hash => typeof hash === 'string' && /^[a-f\d]{64}$/u.test(hash))) return null
  return value as unknown as UpdateHelperConfig
}
/** Only fixed native paths and explicit isolated identities are inherited by restarted applications.
 * @param config Native-owned installation request.
 * @param requestPath Fixed restart-request.json path in this transaction.
 * @returns Scrubbed environment for the new native main process.
 */
export function restartEnvironment(config: UpdateHelperConfig, requestPath: string): NodeJS.ProcessEnv {
  if (requestPath !== join(config.transactionDirectory, 'restart-request.json')) throw new Error('Unexpected restart request path.')
  return { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: config.restart.home, DSH_HOME: config.restart.dshHome,
    TMPDIR: join(config.transactionDirectory, 'tmp'), DSH_DESKTOP_RESTART_REQUEST: requestPath }
}
function runNative(command: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((accept, reject) => {
    execFile(command, [...args], { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } }, (error, stdout) => {
      if (error) reject(error instanceof Error ? error : new Error('Native updater command failed.'))
      else accept(stdout.trim())
    })
  })
}
function spawnNative(executable: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<RestartedProcess> {
  return new Promise((accept, reject) => {
    const child = spawn(executable, [...args], { detached: true, shell: false, stdio: 'ignore', env })
    let exited = false
    child.once('error', reject)
    child.once('exit', () => { exited = true })
    child.once('spawn', () => {
      if (child.pid === undefined) { reject(new Error('New app did not report a PID.')); return }
      child.unref(); accept({ pid: child.pid, hasExited: () => exited })
    })
  })
}
function parentAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    if (hasErrorCode(error, 'ESRCH')) return false
    throw error
  }
}
/** Bound an operation even if an injected operation or a child never settles.
 * @param operation Started operation whose caller retains any cleanup responsibility.
 * @param timeoutMs Maximum wait duration.
 * @param label Failure context.
 * @param signal Optional caller cancellation.
 * @returns Operation result before cancellation or deadline.
 */
export async function withinDeadline<T>(operation: Promise<T>, timeoutMs: number, label: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    signal?.throwIfAborted()
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error(`${label} timed out.`)) }, timeoutMs)
      abort = () => { reject(signal?.reason instanceof Error ? signal.reason : new Error('Update cancelled.')) }
      signal?.addEventListener('abort', abort, { once: true })
    })])
  } finally {
    if (timer) clearTimeout(timer)
    if (abort) signal?.removeEventListener('abort', abort)
  }
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
/** Reverify independent transaction files before the helper acknowledges handoff.
 * @param config Validated native request.
 */
export function verifyCopiedHelper(config: UpdateHelperConfig): void {
  assertPrivateDirectory(config.transactionDirectory)
  const entries = [['node', 'node', 256 * 1024 * 1024], ['helper', 'update-helper.mjs', 16 * 1024 * 1024],
    ['source', 'node-source.json', 1024 * 1024], ['license', 'LICENSE', 4 * 1024 * 1024]] as const
  for (const [key, name, limit] of entries) {
    if (bytesSha256(readPhysicalFile(join(config.transactionDirectory, name), limit, true)) !== config.files[key]) {
      throw new Error(`Copied helper ${key} checksum mismatch.`)
    }
  }
}
/** Execute one already acknowledged transaction. Tests inject system operations and never imply native acceptance.
 * @param config Validated private request.
 * @param dependencies Bounded native operations or explicit test substitutes.
 * @returns Terminal outcome, also published exclusively as outcome.json.
 */
export async function runUpdateTransaction(
  config: UpdateHelperConfig, dependencies: UpdateHelperDependencies = {},
): Promise<UpdateTransactionOutcome> {
  if (validateUpdateHelperConfig(config) === null) throw new Error('Unsafe update helper configuration.')
  assertPrivateDirectory(config.transactionDirectory)
  const now = dependencies.now ?? Date.now
  const sleep = dependencies.sleep ?? (ms => new Promise(accept => setTimeout(accept, ms)))
  const timeout = dependencies.timeoutMs ?? 90_000
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 180_000) throw new Error('Invalid updater deadline.')
  const signal = dependencies.signal
  const run = (command: string, args: readonly string[], limit = timeout) => withinDeadline(
    (dependencies.run ?? runNative)(command, args, limit), limit, basename(command), signal)
  const checkCancellation = () => {
    signal?.throwIfAborted()
    const cancelled = readPrivateRecord(config.transactionDirectory, 'cancel.json')
    if (cancelled !== undefined) {
      if (!exactRecord(cancelled, ['schema', 'attemptId', 'nonce']) || cancelled.schema !== 1
        || cancelled.attemptId !== config.attemptId || cancelled.nonce !== config.nonce) throw new Error('Invalid cancellation identity.')
      throw new Error('Update cancelled.')
    }
  }
  const wait = async (probe: () => boolean, label: string, limit = timeout) => {
    await withinDeadline((async () => {
      const deadline = now() + limit
      do { checkCancellation(); if (probe()) return; await sleep(Math.min(100, limit)) } while (now() < deadline)
      throw new Error(`${label} timed out.`)
    })(), limit, label, signal)
  }
  const outcome: UpdateTransactionOutcome = { schema: 1, attemptId: config.attemptId, nonce: config.nonce,
    status: 'failed-before-launch', phase: 'handoff', firstError: null, recoveryError: null,
    newAppMayHaveStarted: false, newAppPid: null, backupPath: null }
  // Duplicates fail before they can publish an outcome owned by the first helper.
  publishPrivateRecord(config.transactionDirectory, 'execution-claim.json', {
    schema: 1, attemptId: config.attemptId, nonce: config.nonce, pid: process.pid,
  })
  let mounted = false
  let currentMoved = false
  let ownedStage: string | undefined
  const mountPoint = join(config.transactionDirectory, 'mount')
  try {
    await wait(() => {
      const approved = readPrivateRecord(config.transactionDirectory, 'handoff-approved.json')
      if (approved === undefined) return false
      if (!exactRecord(approved, ['schema', 'attemptId', 'nonce']) || approved.schema !== 1
        || approved.attemptId !== config.attemptId || approved.nonce !== config.nonce) throw new Error('Invalid handoff approval.')
      return true
    }, 'Helper handoff', Math.min(timeout, 15_000))
    outcome.phase = 'parent-exit'
    await wait(() => !(dependencies.parentAlive ?? parentAlive)(config.parentPid), 'Previous application exit', Math.min(timeout, 30_000))
    outcome.phase = 'payload-verification'
    checkCancellation()
    assertPhysicalPath(config.currentAppPath)
    assertPrivateDirectory(config.verifiedDownloadDirectory)
    await verifyDesktopUpdateFile({ desktopVersion: config.expectedDesktopVersion, harnessVersion: config.expectedHarnessVersion,
      sha256: config.expectedSha256, bytes: config.expectedBytes, assetName: basename(config.dmgPath), localPath: config.dmgPath,
      stagingDirectory: config.verifiedDownloadDirectory, target: { platform: 'darwin', arch: 'x64', packageFormat: 'dmg' } }, signal)
    const parent = dirname(config.currentAppPath)
    const writable = dependencies.canWrite ?? ((directory: string) => {
      try { accessSync(directory, constants.W_OK); return true } catch (error) {
        if (hasErrorCode(error, 'EACCES') || hasErrorCode(error, 'EPERM')) return false
        throw error
      }
    })
    if (!writable(parent)) {
      outcome.phase = 'manual-install'; await run('/usr/bin/open', [config.dmgPath], Math.min(timeout, 30_000))
      outcome.status = 'manual-install-required'
    } else {
      const verifyBundle = async (appPath: string): Promise<string> => {
        assertPhysicalPath(appPath)
        if (!lstatSync(appPath).isDirectory()) throw new Error('Update bundle is not a physical directory.')
        const plist = join(appPath, 'Contents', 'Info.plist'); assertPhysicalPath(plist)
        const value = (key: string) => run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])
        if (await value('CFBundleIdentifier') !== BUNDLE_ID) throw new Error('Update bundle identifier mismatch.')
        if (await value('CFBundleShortVersionString') !== config.expectedDesktopVersion) throw new Error('Update bundle version mismatch.')
        const name = await value('CFBundleExecutable')
        if (!/^[A-Za-z0-9._ -]+$/u.test(name) || name === '.' || name === '..') throw new Error('Invalid bundle executable name.')
        const executable = join(appPath, 'Contents', 'MacOS', name); assertPhysicalPath(executable)
        if (!lstatSync(executable).isFile() || !(await run('/usr/bin/lipo', ['-archs', executable])).split(/\s+/u).includes('x86_64')) {
          throw new Error('Update executable is not Intel x86_64.')
        }
        const metadata: unknown = JSON.parse(readPhysicalFile(join(appPath, 'Contents', 'Resources', 'update-metadata.json'), 64 * 1024).toString('utf8'))
        if (typeof metadata !== 'object' || metadata === null || !('schema' in metadata) || metadata.schema !== 1
          || !('desktopVersion' in metadata) || metadata.desktopVersion !== config.expectedDesktopVersion
          || !('harnessVersion' in metadata) || metadata.harnessVersion !== config.expectedHarnessVersion
          || !('platform' in metadata) || metadata.platform !== 'darwin' || !('arch' in metadata) || metadata.arch !== 'x64') {
          throw new Error('Packaged update metadata mismatch.')
        }
        return executable
      }
      mkdirSync(mountPoint, { mode: 0o700 }); mkdirSync(join(config.transactionDirectory, 'tmp'), { mode: 0o700 })
      outcome.phase = 'mount'
      await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPoint, config.dmgPath]); mounted = true
      const candidate = join(mountPoint, APP_NAME)
      await verifyBundle(candidate)
      ownedStage = mkdtempSync(join(parent, '.DeepSeek-Harness-update-')); assertPrivateDirectory(ownedStage)
      const staged = join(ownedStage, APP_NAME)
      outcome.backupPath = join(ownedStage, 'previous.app')
      outcome.phase = 'copy'
      await run('/usr/bin/ditto', ['--noqtn', candidate, staged], Math.min(timeout, 180_000)); await verifyBundle(staged)
      checkCancellation()
      outcome.phase = 'replace'
      renameSync(config.currentAppPath, outcome.backupPath); currentMoved = true
      renameSync(staged, config.currentAppPath)
      const executablePath = await verifyBundle(config.currentAppPath)
      const facts: NativeRestartFacts = { desktopVersion: config.expectedDesktopVersion, harnessVersion: config.expectedHarnessVersion,
        executablePath, ...config.restart }
      const requestPath = createRestartRequest(config.transactionDirectory, facts, config.attemptId, config.nonce, Date.now() + timeout)
      checkCancellation()
      outcome.phase = 'restart'
      // Even a spawn error can arrive after process creation. Preserve both generations from this point onward.
      outcome.newAppMayHaveStarted = true
      const child = await withinDeadline((dependencies.spawnApp ?? spawnNative)(executablePath,
        [`--user-data-dir=${config.restart.userData}`], restartEnvironment(config, requestPath)), timeout, 'Application restart', signal)
      if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error('Invalid restarted process PID.')
      outcome.newAppPid = child.pid
      outcome.phase = 'host-ready'
      await wait(() => {
        if (child.hasExited()) throw new Error('New application exited before Host readiness.')
        return readRestartReady(requestPath, child.pid) !== null
      }, 'New application Host readiness')
      outcome.status = 'installed-host-ready'
    }
  } catch (error) {
    outcome.firstError = errorText(error)
    if (outcome.newAppMayHaveStarted) outcome.status = 'recovery-required'
    else if (currentMoved && outcome.backupPath && ownedStage) {
      try {
        if (existsSync(config.currentAppPath)) renameSync(config.currentAppPath, join(ownedStage, 'rejected.app'))
        renameSync(outcome.backupPath, config.currentAppPath); outcome.backupPath = null
      } catch (recoveryError) { outcome.status = 'recovery-required'; outcome.recoveryError = errorText(recoveryError) }
    }
  } finally {
    if (mounted) {
      try { await withinDeadline((dependencies.run ?? runNative)('/usr/bin/hdiutil', ['detach', mountPoint], 30_000), 30_000, 'DMG detach') }
      catch (error) { outcome.recoveryError ??= errorText(error) }
    }
  }
  publishPrivateRecord(config.transactionDirectory, 'outcome.json', outcome)
  return outcome
}

async function main(): Promise<void> {
  const path = process.argv[2]
  if (!path || basename(path) !== 'helper-request.json') throw new Error('Missing fixed helper request.')
  assertPrivateDirectory(dirname(path))
  const config = validateUpdateHelperConfig(JSON.parse(readPhysicalFile(path, 64 * 1024, true).toString('utf8')))
  if (!config || config.transactionDirectory !== dirname(path)) throw new Error('Unsafe update helper configuration.')
  verifyCopiedHelper(config)
  if (process.platform !== 'darwin' || process.arch !== 'x64' || process.versions.node !== '24.17.0'
    || process.execPath !== join(config.transactionDirectory, 'node') || resolve(process.argv[1] ?? '') !== join(config.transactionDirectory, 'update-helper.mjs')) {
    throw new Error('Helper is not running under the copied standalone Node runtime.')
  }
  publishPrivateRecord(config.transactionDirectory, 'helper-ready.json', { schema: 1, attemptId: config.attemptId, nonce: config.nonce,
    pid: process.pid, nodeVersion: process.versions.node, nodeSha256: config.files.node, helperSha256: config.files.helper,
    requestSha256: bytesSha256(readPhysicalFile(path, 64 * 1024, true)) })
  const outcome = await runUpdateTransaction(config)
  if (outcome.firstError) throw new Error(outcome.firstError)
}
const invokedPath = process.argv[1]
if (invokedPath !== undefined && basename(invokedPath) === 'update-helper.mjs' && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`DeepSeek Harness update helper failed: ${errorText(error)}\n`); process.exitCode = 1
  })
}
