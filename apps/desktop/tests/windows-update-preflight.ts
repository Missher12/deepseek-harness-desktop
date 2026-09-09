/** Owned resources and independent failure results for the Windows update preflight. */
import type { ChildProcess } from 'node:child_process'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { isWindowsBootstrapReady } from '../src/update/windows-installer.ts'
import type { WindowsUpdateSignal } from '../src/update/windows-signal.ts'

/**
 * Select the runner-owned temporary root for the native command's bounded path budget.
 * @param environment Current runner environment, without mutating it.
 * @param fallback OS temporary root for local execution outside Actions.
 * @returns Parent directory for an atomically allocated, test-owned working directory.
 */
export function preflightTempRoot(environment: NodeJS.ProcessEnv, fallback: string): string {
  const root = environment.RUNNER_TEMP
  return root === undefined || root.length === 0 ? fallback : root
}

/** Separate outcomes; callers must not print the private original error object. */
export interface PreflightResult {
  primary?: { error: unknown }
  cleanupFailures: string[]
}

/**
 * Run the preflight and retain its first failure separately from cleanup failures.
 * @param body Actual native preflight, not a replacement launch path.
 * @param cleanup Ordered cleanup of resources acquired by that preflight.
 * @returns Independent primary and cleanup outcomes, with original errors kept private.
 */
export async function settlePreflight(body: () => Promise<void>, cleanup: ReadonlyArray<{
  code: string
  run: () => Promise<void>
}>): Promise<PreflightResult> {
  let primary: PreflightResult['primary']
  try { await body() } catch (error) { primary = { error } }
  const cleanupFailures: string[] = []
  for (const step of cleanup) {
    try { await step.run() } catch { cleanupFailures.push(step.code) }
  }
  return { ...(primary === undefined ? {} : { primary }), cleanupFailures }
}

/** Fixed phase names; these records confer no readiness or installation authority. */
export const nativeUpdatePhases = [
  'bootstrap-entered', 'bootstrap-before-worker', 'bootstrap-after-worker', 'bootstrap-ready',
  'bootstrap-decision', 'bootstrap-failed', 'bootstrap-finally',
  'worker-entered', 'worker-parent', 'worker-payload', 'worker-ready', 'worker-decision', 'worker-failed', 'worker-finally',
] as const

/** Private kernel identity, never included in the public preflight report. */
export interface NativePhaseIdentity { pid: number; started: string; path: string }

/**
 * Read one small, exclusive, physical diagnostic record from the owned transaction.
 * @param signal Private transaction directory and nonce.
 * @param phase Fixed native phase filename.
 * @returns Private identity or null for an absent, partial, linked or malformed record.
 */
export async function readNativePhase(
  signal: WindowsUpdateSignal, phase: typeof nativeUpdatePhases[number],
): Promise<NativePhaseIdentity | null> {
  try {
    const directory = await lstat(signal.directory)
    if (!directory.isDirectory() || directory.isSymbolicLink()) return null
    const path = join(signal.directory, phase + '.json')
    const before = await lstat(path, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > 2048n) return null
    const file = await open(path, 'r')
    try {
      const opened = await file.stat({ bigint: true })
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return null
      const buffer = Buffer.alloc(2049)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      if (bytesRead !== Number(before.size)) return null
      const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
      if (value === null || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'nonce,path,pid,started') return null
      if (!('nonce' in value) || value.nonce !== signal.nonce || !('pid' in value) || typeof value.pid !== 'number'
        || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !('started' in value) || typeof value.started !== 'string'
        || !/^[0-9]{1,19}$/u.test(value.started) || !('path' in value) || typeof value.path !== 'string') return null
      return { pid: value.pid, started: value.started, path: value.path }
    } finally { await file.close() }
  } catch {
    // Diagnostic writes are best-effort and may still hold an exclusive handle. Never authorize from an unreadable record.
    return null
  }
}

/**
 * Interpret only fixed bootstrap stderr markers; no diagnostic frame grants readiness.
 * @param stderr Bounded private stderr accumulated from the retained bootstrap.
 * @returns Observed fixed codes and whether stderr is empty or contains only permitted progress frames.
 */
export function bootstrapProgress(stderr: string) {
  const lines = stderr.split(/\r?\n/u)
  let stderrAllowed = lines.pop() === ''
  const progress: string[] = []
  let previous = -1
  for (const line of lines) {
    const code = /^DSHB:([EUVJIPMNSWRF])$/u.exec(line)?.[1]
    if (code === undefined) { stderrAllowed = false; continue }
    const position = 'EUVJIPMNSWRF'.indexOf(code)
    if (position <= previous || code === 'F') stderrAllowed = false
    progress.push(code)
    previous = position
  }
  return { progress, stderrAllowed }
}

/**
 * Observe only the retained child, draining output without exposing source or private paths.
 * @param child Process created by this test; no PID lookup or process discovery.
 * @returns Bounded readiness/close waits, owned stop and fixed public process facts.
 */
export function observePreflightChild(child: ChildProcess) {
  const facts = { spawned: false, error: false, exited: false, closed: false,
    status: null as number | null, signal: null as NodeJS.Signals | null,
    stdoutBytes: 0, stderrBytes: 0, stdoutOverflow: false, stderrOverflow: false, ...bootstrapProgress('') }
  let output = ''
  let stderr = ''
  let readyResolve: () => void = () => {}
  let readyReject: (error: Error) => void = () => {}
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  void ready.catch(() => { /* Rejection remains observable by waitReady, including a spawn error before the caller awaits it. */ })
  let closeResolve: () => void = () => {}
  const closed = new Promise<void>((resolve) => { closeResolve = resolve })
  child.once('spawn', () => { facts.spawned = true })
  child.on('error', () => { facts.error = true; readyReject(new Error('BOOTSTRAP_SPAWN_ERROR')) })
  child.once('exit', (code, signal) => { facts.exited = true; facts.status = code; facts.signal = signal })
  child.once('close', (code, signal) => {
    facts.closed = true; facts.status = code; facts.signal = signal
    if (!isWindowsBootstrapReady(output)) readyReject(new Error('BOOTSTRAP_CLOSED_BEFORE_READY'))
    closeResolve()
  })
  child.stdout?.on('data', (chunk: Buffer) => {
    facts.stdoutOverflow ||= facts.stdoutBytes + chunk.length > 128
    facts.stdoutBytes = Math.min(128, facts.stdoutBytes + chunk.length)
    if (facts.stdoutOverflow) { readyReject(new Error('BOOTSTRAP_STDOUT_LIMIT')); return }
    output += chunk.toString('utf8')
    if (isWindowsBootstrapReady(output)) readyResolve()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.subarray(0, 128 - facts.stderrBytes).toString('utf8')
    facts.stderrOverflow ||= facts.stderrBytes + chunk.length > 128
    facts.stderrBytes = Math.min(128, facts.stderrBytes + chunk.length)
    Object.assign(facts, bootstrapProgress(stderr))
    facts.stderrAllowed &&= !facts.stderrOverflow
  })
  const bounded = async (pending: Promise<void>, timeout: number, code: string): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([pending, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error(code)) }, timeout)
      })])
    } finally { clearTimeout(timer) }
  }
  return {
    facts,
    exactReady: () => isWindowsBootstrapReady(output) && !facts.stdoutOverflow,
    waitReady: () => bounded(ready, 20_000, 'BOOTSTRAP_READY_TIMEOUT'),
    waitClosed: (timeout = 5000) => bounded(closed, timeout, 'CHILD_CLOSE_TIMEOUT'),
    stop: async () => {
      if (!facts.closed && child.exitCode === null && child.signalCode === null) child.kill()
      await bounded(closed, 5000, 'CHILD_STOP_TIMEOUT')
    },
  }
}
