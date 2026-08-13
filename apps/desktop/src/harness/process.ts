import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { readHarnessUrl } from './startup-url.ts'
import { waitForHarness as probeHarness } from './readiness.ts'

const MAX_STARTUP_OUTPUT_BYTES = 64 * 1024
const DEFAULT_STOP_TIMEOUT_MS = 3_000

/** Signals used to stop an owned Harness process group. */
export type KillSignal = 'SIGTERM' | 'SIGKILL'

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
  executable?: string
  spawn?: SpawnHarness
  waitForHarness?: (url: string) => Promise<void>
  killGroup?: (pid: number, signal: KillSignal) => void
  stopTimeoutMs?: number
  onOutput?: (source: 'stdout' | 'stderr', text: string) => void
  onExit?: (state: ExitState) => void
}

/**
 * Signal one detached process group created by this application.
 * @param pid - Exact positive PID returned by spawn.
 * @param signal - Graceful or forced termination signal.
 */
export function killProcessGroup(pid: number, signal: KillSignal): void {
  process.kill(-pid, signal)
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
    'executable' | 'spawn' | 'waitForHarness' | 'killGroup' | 'stopTimeoutMs'>>
    & Pick<HarnessProcessOptions, 'cli' | 'onOutput' | 'onExit'>
  private child: ChildProcess | undefined
  private exitPromise: Promise<ExitState> | undefined
  private detachOutput: (() => void) | undefined

  /**
   * Create an idle process owner.
   * @param options - Executable, built CLI, and injected OS seams.
   */
  constructor(options: HarnessProcessOptions) {
    this.options = {
      ...options,
      executable: options.executable ?? process.execPath,
      spawn: options.spawn ?? ((executable, args, spawnOptions) =>
        nodeSpawn(executable, [...args], spawnOptions)),
      waitForHarness: options.waitForHarness ?? probeHarness,
      killGroup: options.killGroup ?? killProcessGroup,
      stopTimeoutMs: options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
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
    if (this.child !== undefined) throw new Error('Harness process is already running.')
    const child = this.options.spawn(this.options.executable, [
      this.options.cli,
      'web',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ], {
      cwd: workspace,
      detached: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
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

    const stdoutOutput = (chunk: Buffer | string): void => {
      this.options.onOutput?.('stdout', chunk.toString())
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

    try {
      const url = await Promise.race([startupUrl, exitedBeforeReady()])
      await Promise.race([this.options.waitForHarness(url), exitedBeforeReady()])
      return url
    } catch (error) {
      detachStartup()
      await this.stop()
      throw error
    }
  }

  /** Stop the exact owned process group and await its exit. */
  async stop(): Promise<void> {
    const child = this.child
    const exitPromise = this.exitPromise
    if (child === undefined || exitPromise === undefined) return
    this.detachOutput?.()
    this.detachOutput = undefined
    const pid = child.pid
    if (child.exitCode === null && pid !== undefined) {
      this.options.killGroup(pid, 'SIGTERM')
      if (!await settledWithin(exitPromise, this.options.stopTimeoutMs)) {
        this.options.killGroup(pid, 'SIGKILL')
      }
    }
    await exitPromise
  }
}
