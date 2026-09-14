import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { readHarnessUrl } from './startup-url.ts'
import { waitForHarness as probeHarness } from './readiness.ts'
import { terminateProcessTree, type TerminationMode } from './process-tree.ts'
import {
  parseHarnessStartupTimingLine,
  type DesktopStartupMilestone,
  type HarnessStartupTimingPhase,
} from '../startup-timeline.ts'

const MAX_STARTUP_OUTPUT_BYTES = 64 * 1024
const DEFAULT_STOP_TIMEOUT_MS = 3_000

/** Settlement reported when the exact owned child exits. */
export interface ExitState {
  code: number | null
  signal: NodeJS.Signals | null
  error?: Error
}

type SpawnHarness = (executable: string, args: readonly string[], options: SpawnOptions) => ChildProcess

/** Dependencies required to own one Harness child process. */
export interface HarnessProcessOptions {
  cli: string
  /** Explicit profile for an isolated composition; absent preserves the Web alias. */
  profile?: string
  /** Base native adapter announces only after the official launcher's successful startup commit. */
  requireHostReady?: boolean
  /** Resolve a shipped template only for a missing profile, including subsequent retries. */
  fromDefaultProfile?: 'web' | (() => 'web' | undefined)
  patch?: string
  prepare?: () => void | Promise<void>
  executable?: string
  spawn?: SpawnHarness
  waitForHarness?: (url: string) => Promise<void>
  platform?: NodeJS.Platform
  terminateTree?: (pid: number, mode: TerminationMode, platform: NodeJS.Platform) => void
  stopTimeoutMs?: number
  /** Total deadline for the URL/Host-ready handshake and HTTP probe after spawn. */
  startupTimeoutMs?: number
  onOutput?: (source: 'stdout' | 'stderr', text: string) => void
  onExit?: (state: ExitState) => void
  markStartup?: (milestone: DesktopStartupMilestone) => void
  onStartupTiming?: (phase: HarnessStartupTimingPhase, milliseconds: number) => void
}

function describeExit(state: ExitState): string {
  if (state.error !== undefined) return state.error.message
  if (state.signal !== null) return `signal ${state.signal}`
  return `code ${String(state.code)}`
}

function settledWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { resolve(false) }, timeoutMs)
    promise.then(
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      () => {
        clearTimeout(timer)
        resolve(true)
      },
    )
  })
}

/** Owns startup, readiness, and quiescent shutdown for one Harness child. */
export class HarnessProcess {
  private readonly options: Required<Pick<HarnessProcessOptions,
    'executable' | 'spawn' | 'waitForHarness' | 'platform' | 'terminateTree' | 'stopTimeoutMs' | 'startupTimeoutMs'>>
    & Pick<HarnessProcessOptions,
      'cli' | 'profile' | 'requireHostReady' | 'fromDefaultProfile' | 'patch' | 'prepare' | 'onOutput' | 'onExit' | 'markStartup' | 'onStartupTiming'>
  private child: ChildProcess | undefined
  private exitPromise: Promise<ExitState> | undefined
  private detachOutput: (() => void) | undefined
  private stopping: Promise<void> | undefined
  private preparation: { promise: Promise<void>; cancellation: AbortController } | undefined

  /**
   * Create an idle process owner.
   * @param options - Executable, built CLI, and injected OS seams.
   */
  constructor(options: HarnessProcessOptions) {
    if (options.startupTimeoutMs !== undefined && (!Number.isSafeInteger(options.startupTimeoutMs) || options.startupTimeoutMs <= 0)) {
      throw new Error('Harness startup deadline must be a positive integer.')
    }
    if (options.patch !== undefined && (!isAbsolute(options.patch) || options.patch.includes('\0'))) {
      throw new Error('Harness Desktop patch must be an absolute path without NUL.')
    }
    this.options = {
      ...options,
      executable: options.executable ?? process.execPath,
      spawn: options.spawn ?? ((executable, args, spawnOptions) =>
        nodeSpawn(executable, [...args], spawnOptions)),
      waitForHarness: options.waitForHarness ?? probeHarness,
      platform: options.platform ?? process.platform,
      terminateTree: options.terminateTree ?? terminateProcessTree,
      stopTimeoutMs: options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
      startupTimeoutMs: options.startupTimeoutMs ?? 60_000,
    }
  }

  /** Return the exact currently owned PID, if the child is still alive. */
  get pid(): number | undefined {
    return this.child?.pid
  }

  /**
   * Start the built CLI once and wait for its loopback Web Host.
   * @param workspace - Initial working directory exposed to Harness.
   * @returns The validated, ready loopback URL.
   */
  async start(workspace: string): Promise<string> {
    if (this.child !== undefined || this.preparation !== undefined || this.stopping !== undefined) throw new Error('Harness process is already running.')
    const preparation = this.options.prepare?.()
    if (preparation !== undefined) {
      const pending = { promise: preparation, cancellation: new AbortController() }
      this.preparation = pending
      try {
        await preparation
      } finally {
        this.preparation = undefined
      }
      if (pending.cancellation.signal.aborted) throw new Error('Harness startup was cancelled during preparation.')
    }
    this.options.markStartup?.('fallback-ready')
    const fromDefaultProfile = typeof this.options.fromDefaultProfile === 'function'
      ? this.options.fromDefaultProfile() : this.options.fromDefaultProfile
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_DESKTOP_STARTUP_TIMING: '1',
    }
    const child = this.options.spawn(this.options.executable, [
      // Electron's Node mode does not expose the internal ESM resolver through
      // node-addon-require-builtin. Loader needs this flag so bare plugin names
      // resolve from the active profile instead of the packaged app directory.
      '--expose-internals',
      this.options.cli,
      ...this.options.profile === undefined ? ['web'] : ['--profile', this.options.profile],
      ...fromDefaultProfile === undefined ? [] : ['--from-default-profile', fromDefaultProfile],
      ...this.options.patch === undefined ? [] : ['--patch', this.options.patch],
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ], {
      cwd: workspace,
      detached: this.options.platform !== 'win32',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (child.pid === undefined || child.pid <= 0 || child.stdout === null || child.stderr === null) {
      throw new Error('Harness child did not expose a valid PID and output streams.')
    }
    const stdout = child.stdout
    const stderr = child.stderr

    this.child = child
    const exitPromise = new Promise<ExitState>((resolve) => {
      child.once('exit', (code, signal) => { resolve({ code, signal }) })
      child.once('error', (error) => { resolve({ code: null, signal: null, error }) })
    }).then((state) => {
      if (this.child === child) {
        this.detachOutput?.()
        this.detachOutput = undefined
        this.child = undefined
        this.exitPromise = undefined
      }
      this.options.onExit?.(state)
      return state
    })
    this.exitPromise = exitPromise

    let timingOutput = ''
    const timingPhases = new Set<HarnessStartupTimingPhase>()
    const stdoutOutput = (chunk: Buffer | string): void => {
      const text = chunk.toString()
      this.options.onOutput?.('stdout', text)
      timingOutput += text
      if (Buffer.byteLength(timingOutput) > MAX_STARTUP_OUTPUT_BYTES) {
        timingOutput = ''
        this.options.onOutput?.('stderr', 'Harness startup timing rejected: safe limit exceeded.\n')
        return
      }
      const lines = timingOutput.split(/\n/u)
      timingOutput = lines.pop() ?? ''
      for (const rawLine of lines) {
        try {
          const timing = parseHarnessStartupTimingLine(rawLine.replace(/\r$/u, ''))
          if (timing === undefined) continue
          if (timingPhases.has(timing.phase)) {
            this.options.onOutput?.('stderr', 'Harness startup timing rejected: duplicate phase.\n')
            continue
          }
          timingPhases.add(timing.phase)
          this.options.onStartupTiming?.(timing.phase, timing.milliseconds)
        } catch {
          this.options.onOutput?.('stderr', 'Harness startup timing rejected: malformed phase.\n')
        }
      }
    }
    const stderrOutput = (chunk: Buffer | string): void => {
      this.options.onOutput?.('stderr', chunk.toString())
    }
    stdout.on('data', stdoutOutput)
    stderr.on('data', stderrOutput)
    this.detachOutput = () => {
      stdout.off('data', stdoutOutput)
      stderr.off('data', stderrOutput)
    }

    let startupOutput = ''
    let detachStartup = (): void => undefined
    const startupUrl = new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer | string): void => {
        startupOutput += chunk.toString()
        if (Buffer.byteLength(startupOutput) > MAX_STARTUP_OUTPUT_BYTES) {
          detachStartup()
          reject(new Error('Harness startup output exceeded the safe limit.'))
          return
        }
        if (!startupOutput.includes('\n')) return
        if (this.options.requireHostReady === true
          && !startupOutput.split(/\r?\n/u).includes('dsh desktop: host-ready')) return
        const startupLines = startupOutput.split(/\r?\n/u)
          .filter(line => line.startsWith('dsh web: '))
        if (startupLines.length === 0) return
        try {
          const url = readHarnessUrl(startupOutput)
          detachStartup()
          resolve(url)
        } catch (error) {
          detachStartup()
          reject(error instanceof Error ? error : new Error('Harness startup parsing failed.', { cause: error }))
        }
      }
      detachStartup = () => { stdout.off('data', onData) }
      stdout.on('data', onData)
    })

    const exitedBeforeReady = (): Promise<never> => exitPromise.then((state) => {
      throw new Error(`Harness exited before startup completed (${describeExit(state)}).`)
    })
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error('Harness startup handshake deadline exceeded.')) }, this.options.startupTimeoutMs)
      timer.unref()
    })

    try {
      const url = await Promise.race([startupUrl, exitedBeforeReady(), timedOut])
      this.options.markStartup?.('url-reported')
      await Promise.race([this.options.waitForHarness(url), exitedBeforeReady(), timedOut])
      this.options.markStartup?.('harness-ready')
      return url
    } catch (error) {
      detachStartup()
      await this.stop()
      throw error
    } finally {
      clearTimeout(timer)
      detachStartup()
    }
  }

  /** Stop the exact owned process tree and await its exit. */
  stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping
    const pending = this.stopOnce().finally(() => { this.stopping = undefined })
    this.stopping = pending
    return pending
  }

  private async stopOnce(): Promise<void> {
    if (this.preparation !== undefined) {
      this.preparation.cancellation.abort()
      try {
        await this.preparation.promise
      } catch {
        // start() reports preparation failure; stop() waits only for its writes to settle.
      }
    }
    const child = this.child
    const exitPromise = this.exitPromise
    if (child === undefined || exitPromise === undefined) return
    this.detachOutput?.()
    this.detachOutput = undefined
    const pid = child.pid
    if (child.exitCode === null && pid !== undefined) {
      const initialMode = this.options.platform === 'win32' ? 'force' : 'graceful'
      this.options.terminateTree(pid, initialMode, this.options.platform)
      if (!await settledWithin(exitPromise, this.options.stopTimeoutMs)) {
        this.options.terminateTree(pid, 'force', this.options.platform)
        if (!await settledWithin(exitPromise, this.options.stopTimeoutMs)) {
          throw new Error(`Harness process tree ${String(pid)} did not exit after forced termination.`)
        }
      }
    }
    await exitPromise
  }
}
