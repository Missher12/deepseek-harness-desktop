import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { cancelAppImageReplacement, commitAppImageReplacement } from './linux-appimage-replace.ts'
import { parseLinuxAppImagePlan, parseLinuxHelperRequest, readLinuxUpdateRecord, writeLinuxUpdateRecord } from './linux-update-protocol.ts'
import type { LinuxAppImagePlan, LinuxHelperRequest, LinuxInstallResult, LinuxParentIdentity, LinuxRenameNoReplace } from './linux-update-protocol.ts'

/**
 * Read the kernel start identity; only ENOENT denotes an exited parent.
 * @param pid - Positive process identifier.
 * @returns Kernel start ticks, or undefined when the process disappeared.
 */
export async function readLinuxParentStartTime(pid: number): Promise<string | undefined> {
  try {
    const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
    const start = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u)[19]
    if (!Number.isSafeInteger(pid) || pid <= 0 || !stat.startsWith(`${String(pid)} (`) || start === undefined || !/^\d+$/.test(start)) throw new Error('Invalid Linux parent identity')
    return start
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Wait for this exact parent, honoring cancellation without sending a process signal.
 * @param parent - PID and start ticks identifying only the old app.
 * @param timeoutMs - Parent-exit deadline.
 * @param pollIntervalMs - Delay between kernel observations.
 * @param observe - Kernel reader, replaceable by an offline observer.
 * @param cancelled - Reader for the transaction cancellation command.
 * @returns Whether the exact parent exited or cancellation was observed.
 */
export async function waitForLinuxParentExit(
  parent: LinuxParentIdentity, timeoutMs: number, pollIntervalMs: number,
  observe: (pid: number) => Promise<string | undefined> = readLinuxParentStartTime,
  cancelled: () => Promise<boolean> = () => Promise.resolve(false),
): Promise<'exited' | 'cancelled'> {
  const deadline = performance.now() + timeoutMs
  while (true) {
    if (await cancelled()) return 'cancelled'
    if (await observe(parent.pid) !== parent.startTime) return 'exited'
    if (performance.now() >= deadline) throw new Error('Linux parent exit deadline exceeded')
    await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - performance.now())))
  }
}

async function control(plan: LinuxAppImagePlan, name: 'commit' | 'cancel'): Promise<boolean> {
  let value: unknown
  try { value = await readLinuxUpdateRecord(join(plan.transactionDirectory, `${name}.json`)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  if (typeof value !== 'object' || value === null || !('id' in value) || value.id !== plan.id
    || !('nonce' in value) || value.nonce !== plan.nonce || !('command' in value) || value.command !== name) throw new Error('Invalid Linux helper control record')
  return true
}

function launchImage(plan: LinuxAppImagePlan): Promise<number> {
  return new Promise((fulfill, reject) => {
    const child = spawn(plan.targetPath, [], {
      cwd: dirname(plan.targetPath), shell: false, detached: true, stdio: 'ignore',
      env: { ...process.env, DSH_UPDATE_TRANSACTION: plan.transactionDirectory, DSH_UPDATE_ID: plan.id, DSH_UPDATE_NONCE: plan.nonce },
    })
    child.once('error', reject)
    child.once('spawn', () => {
      if (child.pid === undefined) { reject(new Error('Restarted AppImage has no PID')); return }
      child.unref(); fulfill(child.pid)
    })
  })
}

/**
 * Execute file control from outside the old mount; the shared owner still validates new-app readiness.
 * @param requestPath - Private request beside its plan.
 * @param operations - Optional observers used by offline tests.
 * @returns Retained transaction outcome; a spawned PID does not prove app readiness.
 */
export async function runLinuxUpdateHelper(requestPath: string, operations: {
  parentStartTime?: (pid: number) => Promise<string | undefined>
  launch?: (plan: LinuxAppImagePlan, request: LinuxHelperRequest) => Promise<number>
  move?: LinuxRenameNoReplace
} = {}): Promise<LinuxInstallResult> {
  const request = parseLinuxHelperRequest(await readLinuxUpdateRecord(requestPath))
  const plan = parseLinuxAppImagePlan(await readLinuxUpdateRecord(request.planPath))
  if (dirname(requestPath) !== plan.transactionDirectory || dirname(request.planPath) !== plan.transactionDirectory) throw new Error('Helper request is outside its transaction')
  let committing = false
  let result: LinuxInstallResult
  try {
    await writeLinuxUpdateRecord(join(plan.transactionDirectory, 'ready.json'), { id: plan.id, nonce: plan.nonce, pid: process.pid })
    const deadline = performance.now() + request.commandTimeoutMs
    while (true) {
      if (await control(plan, 'cancel')) { await cancelAppImageReplacement(plan); result = { status: 'cancelled' }; break }
      if (await control(plan, 'commit')) {
        const stopped = await waitForLinuxParentExit(request.parent, request.parentExitTimeoutMs, request.pollIntervalMs, operations.parentStartTime ?? readLinuxParentStartTime, async () => await control(plan, 'cancel'))
        if (stopped === 'cancelled') { await cancelAppImageReplacement(plan); result = { status: 'cancelled' }; break }
        committing = true
        await commitAppImageReplacement(plan, operations.move)
        result = { status: 'restart-requested', pid: await (operations.launch ?? launchImage)(plan, request) }
        break
      }
      if (performance.now() >= deadline) throw new Error('Linux install command deadline exceeded')
      await sleep(request.pollIntervalMs)
    }
  } catch (error) {
    if (!committing) {
      try { await cancelAppImageReplacement(plan) }
      catch { /* A changed lock or state prevents automatic cleanup; retain all files for recovery. */ }
    }
    result = { status: committing ? 'recovery-required' : 'failed', reason: error instanceof Error ? error.message : 'Linux helper failed' }
  }
  await writeLinuxUpdateRecord(join(plan.transactionDirectory, 'result.json'), { id: plan.id, nonce: plan.nonce, result })
  return result
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  const request = process.argv[2]
  if (process.platform !== 'linux' || request === undefined) {
    process.stderr.write('Linux update helper requires Linux and its private request file\n'); process.exitCode = 1
  } else {
    void runLinuxUpdateHelper(request).then((result) => {
      if (result.status === 'failed' || result.status === 'recovery-required') process.exitCode = 1
    }, () => { process.stderr.write('Linux helper request or result could not be verified\n'); process.exitCode = 1 })
  }
}
