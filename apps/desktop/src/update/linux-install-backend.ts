import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { LinuxInstallDescriptor } from './linux-installer.ts'
import { verifyLinuxUpdatePackage } from './linux-installer.ts'
import { cancelAppImageReplacement, copyLinuxUpdateFile, finishAppImageReplacement, prepareAppImageReplacement, probeLinuxNoReplace, recoverAppImageReplacement } from './linux-appimage-replace.ts'
import { runLinuxDebTransaction } from './linux-deb-transaction.ts'
import { inspectLinuxDirectory, inspectLinuxFile, parseLinuxAppImagePlan, parseLinuxHelperRequest, readLinuxUpdateRecord, validateLinuxRestartEnvironment, writeLinuxUpdateRecord } from './linux-update-protocol.ts'
import type { LinuxAppImagePlan, LinuxHelperArtifact, LinuxHelperRequest, LinuxInstallResult, LinuxPackageKitTransaction, LinuxParentIdentity } from './linux-update-protocol.ts'

/** Shared main-process input; runtime and helper are explicit version-bound file artifacts. */
export interface LinuxInstallRequest {
  download: LinuxInstallDescriptor
  installationPath: string
  parent: LinuxParentIdentity
  helperRuntime: { node: LinuxHelperArtifact; helper: LinuxHelperArtifact }
  deadlines: { readyMs: number; commandMs: number; parentExitMs: number; resultMs: number; pollMs: number }
  restartEnvironment: Record<string, string>
}

/** An injected PackageKit adapter owns D-Bus encoding, system authentication and its connection. */
export interface LinuxPackageKitClient {
  available(): Promise<boolean>
  createTransaction(): Promise<LinuxPackageKitTransaction>
  verifyInstalled(version: string): Promise<boolean>
}

/** A prepared handle grants one commit; success still awaits the shared restarted-app receipt. */
export interface LinuxInstallHandle {
  ready: Promise<void>
  completion: Promise<LinuxInstallResult>
  transactionDirectory: string | null
  commit(): Promise<void>
  cancel(): Promise<'cancelled' | 'too-late' | 'failed'>
  acknowledgeRestart(): Promise<void>
}

/** Capability report never substitutes for a native authorization or upgrade acceptance. */
export interface LinuxInstallCapabilities { supported: boolean; format: 'deb' | 'appimage'; reason: string | null }

/**
 * Validate available dependencies without invoking an installer or selecting another backend silently.
 * @param request - Main-owned installation and runtime descriptors.
 * @param packageKit - Maintained system-bus adapter for deb installation.
 * @returns Platform capability; AppImage checks use private disposable filesystem probes.
 */
export async function probeLinuxInstallCapabilities(
  request: LinuxInstallRequest,
  packageKit?: LinuxPackageKitClient,
): Promise<LinuxInstallCapabilities> {
  if (process.platform !== 'linux') return { supported: false, format: request.download.packageFormat, reason: 'native-linux-required' }
  if (request.download.packageFormat === 'deb') {
    const supported = await packageKit?.available() === true
    return { supported, format: 'deb', reason: supported ? null : 'packagekit-adapter-unavailable' }
  }
  try {
    await inspectLinuxFile(request.installationPath)
    await inspectLinuxDirectory(dirname(request.installationPath))
    await probeLinuxNoReplace(dirname(request.installationPath))
    for (const artifact of [request.helperRuntime.node, request.helperRuntime.helper]) {
      const identity = await inspectLinuxFile(artifact.path, 2_000_000_000, true)
      if (identity.sha256 !== artifact.sha256 || identity.bytes !== artifact.bytes) throw new Error('Runtime artifact mismatch')
    }
    return { supported: true, format: 'appimage', reason: null }
  } catch { return { supported: false, format: 'appimage', reason: 'protected-installation-or-runtime-unavailable' } }
}

async function waitRecord(
  directory: string,
  name: string,
  plan: LinuxAppImagePlan,
  timeoutMs: number,
  pollMs: number,
  stopped: () => boolean = () => false,
): Promise<Record<string, unknown>> {
  const deadline = performance.now() + timeoutMs
  while (true) {
    try {
      const value = await readLinuxUpdateRecord(join(directory, `${name}.json`))
      if (typeof value !== 'object' || value === null || !('id' in value) || value.id !== plan.id || !('nonce' in value) || value.nonce !== plan.nonce) throw new Error('Linux helper receipt identity mismatch')
      return value
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (stopped()) throw new Error(`Linux helper exited before ${name} receipt`)
    if (performance.now() >= deadline) throw new Error(`Linux helper ${name} deadline exceeded`)
    await sleep(pollMs)
  }
}

function ownHelper(child: ChildProcess) {
  let closed = false
  let spawnError: Error | undefined
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('error', (error) => { spawnError = error })
    child.once('close', (code, signal) => { closed = true; resolve({ code, signal }) })
  })
  async function join(timeoutMs: number) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const exit = await Promise.race([done, new Promise<never>((_, reject) => {
        timer = setTimeout(() =>{  reject(new Error('Linux helper exit is unconfirmed')) }, timeoutMs)
      })])
      return exit
    } finally { clearTimeout(timer) }
  }
  return {
    stopped: () => closed || spawnError !== undefined,
    join,
    async stopBeforeCommit(timeoutMs: number) {
      if (!closed) child.kill('SIGTERM')
      try { await join(timeoutMs) }
      catch {
        if (!closed) child.kill('SIGKILL')
        await join(timeoutMs)
      }
    },
  }
}

function parseResult(value: unknown): LinuxInstallResult {
  if (typeof value !== 'object' || value === null || !('status' in value)) throw new Error('Invalid Linux helper result')
  if (value.status === 'cancelled' || value.status === 'system-transaction-complete') return { status: value.status }
  if (value.status === 'restart-requested' && 'pid' in value && Number.isSafeInteger(value.pid) && Number(value.pid) > 0) return { status: value.status, pid: Number(value.pid) }
  if ((value.status === 'failed' || value.status === 'recovery-required') && 'reason' in value && typeof value.reason === 'string') return { status: value.status, reason: value.reason }
  throw new Error('Invalid Linux helper result')
}

/**
 * Prepare one bounded installation. Only commit permits a system package request or parent-exit handoff.
 * @param request - Main-owned installation input copied before preparation.
 * @param packageKit - Maintained system-bus adapter for deb installation.
 * @returns One-use handle after system tracking or independent helper readiness.
 */
export async function prepareLinuxInstall(request: LinuxInstallRequest, packageKit?: LinuxPackageKitClient): Promise<LinuxInstallHandle> {
  if (process.platform !== 'linux') throw new Error('Native Linux is required for installation')
  request = structuredClone(request)
  for (const value of Object.values(request.deadlines)) if (!Number.isSafeInteger(value) || value <= 0 || value > 600_000) throw new Error('Invalid Linux installation deadline')
  const verified = await verifyLinuxUpdatePackage(request.download)
  if (request.download.packageFormat === 'deb') {
    if (packageKit === undefined || !await packageKit.available()) throw new Error('PackageKit adapter is unavailable')
    const transaction = await packageKit.createTransaction(), abort = new AbortController()
    let started = false, settled = false
    let resolve!: (result: LinuxInstallResult) => void
    const completion = new Promise<LinuxInstallResult>((fulfill) => { resolve = fulfill })
    return {
      ready: Promise.resolve(), completion, transactionDirectory: null,
      async commit() {
        if (started || settled) throw new Error('Linux install handle already consumed')
        started = true
        try { await verifyLinuxUpdatePackage(request.download) }
        catch (error) {
          let result: LinuxInstallResult = { status: 'failed', reason: 'Prepared package changed before commit' }
          try { await transaction.close() }
          catch { result = { status: 'recovery-required', reason: 'Prepared transaction cleanup failed' } }
          settled = true; resolve(result); throw error
        }
        void runLinuxDebTransaction(transaction, verified.path, async () => await packageKit.verifyInstalled(request.download.desktopVersion), { timeoutMs: request.deadlines.resultMs, signal: abort.signal }).then((result) => { settled = true; resolve(result) }, () => { settled = true; resolve({ status: 'recovery-required', reason: 'System transaction cleanup failed' }) })
      },
      async cancel() {
        if (settled) return 'too-late'
        if (!started) {
          settled = true
          try { await transaction.close() }
          catch { resolve({ status: 'recovery-required', reason: 'Prepared transaction cleanup failed' }); return 'failed' }
          resolve({ status: 'cancelled' }); return 'cancelled'
        }
        abort.abort(); const result = await completion; return result.status === 'cancelled' ? 'cancelled' : 'too-late'
      },
      acknowledgeRestart() { return Promise.reject(new Error('deb readiness is owned by the shared coordinator')) },
    }
  }
  await probeLinuxNoReplace(dirname(request.installationPath))
  const plan = await prepareAppImageReplacement(request.download, request.installationPath)
  let helper: ReturnType<typeof ownHelper> | undefined
  try {
    for (const [name, artifact] of [['node', request.helperRuntime.node], ['helper.mjs', request.helperRuntime.helper]] as const) {
      const identity = await inspectLinuxFile(artifact.path, 2_000_000_000, true)
      if (identity.bytes !== artifact.bytes || identity.sha256 !== artifact.sha256) throw new Error('Independent runtime artifact changed')
      await copyLinuxUpdateFile(artifact.path, join(plan.transactionDirectory, name), identity, true)
    }
    const helperRequest: LinuxHelperRequest = parseLinuxHelperRequest({
      schema: 1, planPath: join(plan.transactionDirectory, 'plan.json'), parent: request.parent,
      commandTimeoutMs: request.deadlines.commandMs, parentExitTimeoutMs: request.deadlines.parentExitMs,
      pollIntervalMs: request.deadlines.pollMs,
    })
    const requestPath = join(plan.transactionDirectory, 'helper-request.json')
    await writeLinuxUpdateRecord(requestPath, helperRequest)
    const child = spawn(join(plan.transactionDirectory, 'node'), [join(plan.transactionDirectory, 'helper.mjs'), requestPath], { cwd: plan.transactionDirectory, shell: false, detached: true, stdio: 'ignore', env: validateLinuxRestartEnvironment(request.restartEnvironment) })
    const owned = ownHelper(child)
    helper = owned
    const ready = waitRecord(plan.transactionDirectory, 'ready', plan, request.deadlines.readyMs, request.deadlines.pollMs, owned.stopped).then((value) => {
      if (value.pid !== child.pid) throw new Error('Linux helper ready PID mismatch')
    })
    await ready
    child.unref()
    let committed = false, settled = false
    const completion = waitRecord(plan.transactionDirectory, 'result', plan, request.deadlines.commandMs + request.deadlines.parentExitMs + request.deadlines.resultMs, request.deadlines.pollMs, owned.stopped)
      .then(async (value) => {
        const result = parseResult(value.result), exit = await owned.join(request.deadlines.resultMs)
        if ((result.status === 'cancelled' || result.status === 'restart-requested') && (exit.code !== 0 || exit.signal !== null)) throw new Error('Linux helper did not exit cleanly')
        return result
      }).catch(() => ({ status: 'recovery-required' as const, reason: 'Independent helper result or exit is unconfirmed; retained transaction requires recovery' }))
      .then((result) => { settled = true; return result })
    return {
      ready, completion, transactionDirectory: plan.transactionDirectory,
      async commit() {
        if (committed || settled || owned.stopped()) throw new Error('Linux install handle already consumed')
        committed = true; await writeLinuxUpdateRecord(join(plan.transactionDirectory, 'commit.json'), { id: plan.id, nonce: plan.nonce, command: 'commit' })
      },
      async cancel() {
        if (settled) return (await completion).status === 'cancelled' ? 'cancelled' : 'too-late'
        await writeLinuxUpdateRecord(join(plan.transactionDirectory, 'cancel.json'), { id: plan.id, nonce: plan.nonce, command: 'cancel' })
        return (await completion).status === 'cancelled' ? 'cancelled' : 'too-late'
      },
      async acknowledgeRestart() {
        if ((await completion).status !== 'restart-requested') throw new Error('Linux restart was not requested')
        await finishAppImageReplacement(plan)
      },
    }
  } catch (error) {
    // No commit handle escaped. Join this owned helper before releasing its preparation lock.
    await helper?.stopBeforeCommit(request.deadlines.resultMs)
    try { await cancelAppImageReplacement(plan) } catch { /* Retain changed transaction ownership for explicit recovery. */ }
    throw error
  }
}

/**
 * Recover a retained transaction only after the shared owner confirms helper exit and exclusive installation ownership.
 * @param planPath - Canonical retained plan selected by the shared owner.
 * @param dataRollbackPermitted - Explicit shared data compatibility decision.
 * @returns Resolves after protected recovery or throws with retained recovery evidence.
 */
export async function recoverLinuxInstall(planPath: string, dataRollbackPermitted: boolean): Promise<void> {
  const plan = parseLinuxAppImagePlan(await readLinuxUpdateRecord(planPath))
  await recoverAppImageReplacement(plan, dataRollbackPermitted)
}
