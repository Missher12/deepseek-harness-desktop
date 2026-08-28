import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { readHarnessUrl } from './startup-url.ts'
import { waitForHarness as probeHarness } from './readiness.ts'
import { terminateProcessTree, type TerminationMode } from './process-tree.ts'
import type { DesktopStartupMilestone } from '../startup-timeline.ts'

const MAX_STARTUP_OUTPUT_BYTES = 64 * 1024
const DEFAULT_STOP_TIMEOUT_MS = 3_000

/** Settlement reported when the exact owned child exits. */
export interface ExitState {
  code: number | null
  signal: NodeJS.Signals | null
  error?: Error
}

type SpawnHarness = (executable: string, args: readonly string[], options: SpawnOptions) => ChildProcess

/** Narrow raw-frame IPC surface for the exact child owned by {@link HarnessProcess}. */
export interface HarnessControlChannel {
  /** Monotonic process generation assigned before listeners become active. */
  readonly generation: number
  /** Whether Node still reports the exact child IPC channel as connected. */
  readonly connected: boolean
  /** Send one copied, unprefixed protocol frame and settle from Node's send callback. */
  send(frame: Uint8Array, callback: (error?: Error) => void): void
  /** Subscribe to copied raw frames received from the exact child. */
  onMessage(listener: (frame: Uint8Array) => void): () => void
  /** Subscribe to loss of the exact child IPC channel. */
  onDisconnect(listener: () => void): () => void
  /** Disconnect only the exact owned IPC channel without terminating the child. */
  disconnect(): void
}

/** Lifecycle consumer attached to each exact Harness child generation. */
export interface HarnessControlLifecycle {
  /** Attach transport listeners after the new generation has been assigned. */
  attach(channel: HarnessControlChannel): void
  /** Await bounded control shutdown before process-tree termination. */
  beforeStop(channel: HarnessControlChannel): Promise<void>
  /** Drop listeners for the exact generation before the process tree is signalled. */
  detach(channel: HarnessControlChannel): void
}

/** Dependencies required to own one Harness child process. */
export interface HarnessProcessOptions {
  cli: string
  patch?: string
  prepare?: () => void
  executable?: string
  spawn?: SpawnHarness
  waitForHarness?: (url: string) => Promise<void>
  platform?: NodeJS.Platform
  terminateTree?: (pid: number, mode: TerminationMode, platform: NodeJS.Platform) => void
  stopTimeoutMs?: number
  onOutput?: (source: 'stdout' | 'stderr', text: string) => void
  onExit?: (state: ExitState) => void
  markStartup?: (milestone: DesktopStartupMilestone) => void
  controlLifecycle?: HarnessControlLifecycle
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

interface HarnessProcessGeneration {
  readonly generation: number
  readonly child: ChildProcess
  readonly controlChannel: HarnessControlChannel
  exitPromise: Promise<ExitState>
  detachOutput: (() => void) | undefined
  stopPromise: Promise<void> | undefined
  lifecycleError: unknown
  controlAttached: boolean
  controlDetached: boolean
  exited: boolean
}

/** Owns startup, readiness, and quiescent shutdown for one Harness child. */
export class HarnessProcess {
  private readonly options: Required<Pick<HarnessProcessOptions,
    'executable' | 'spawn' | 'waitForHarness' | 'platform' | 'terminateTree' | 'stopTimeoutMs'>>
    & Pick<HarnessProcessOptions,
      'cli' | 'patch' | 'prepare' | 'onOutput' | 'onExit' | 'markStartup' | 'controlLifecycle'>
  private active: HarnessProcessGeneration | undefined
  private lastStop: { readonly record: HarnessProcessGeneration; readonly promise: Promise<void> } | undefined
  private controlGeneration = 0

  /**
   * Create an idle process owner.
   * @param options - Executable, built CLI, and injected OS seams.
   */
  constructor(options: HarnessProcessOptions) {
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
    }
  }

  /** Return the exact currently owned PID, if the child is still alive. */
  get pid(): number | undefined {
    return this.active?.child.pid
  }

  /**
   * Start the built CLI once and wait for its loopback Web Host.
   * @param workspace - Initial working directory exposed to Harness.
   * @returns The validated, ready loopback URL.
   */
  async start(workspace: string): Promise<string> {
    if (this.active !== undefined) throw new Error('Harness process is already running.')
    this.options.prepare?.()
    this.options.markStartup?.('fallback-ready')
    const childEnv = { ...process.env }
    delete childEnv.NODE_CHANNEL_FD
    delete childEnv.NODE_CHANNEL_SERIALIZATION_MODE
    childEnv.ELECTRON_RUN_AS_NODE = '1'
    const child = this.options.spawn(this.options.executable, [
      // Electron's Node mode does not expose the internal ESM resolver through
      // node-addon-require-builtin. Loader needs this flag so bare plugin names
      // resolve from the active profile instead of the packaged app directory.
      '--expose-internals',
      this.options.cli,
      'web',
      ...this.options.patch === undefined ? [] : ['--patch', this.options.patch],
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ], {
      cwd: workspace,
      detached: this.options.platform !== 'win32',
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced',
    })
    if (child.pid === undefined || child.pid <= 0 || child.stdout === null || child.stderr === null) {
      throw new Error('Harness child did not expose a valid PID and output streams.')
    }
    const stdout = child.stdout
    const stderr = child.stderr

    const generation = ++this.controlGeneration
    const controlChannel = createHarnessControlChannel(child, generation)
    const rawExitPromise = new Promise<ExitState>((resolve) => {
      child.once('exit', (code, signal) => { resolve({ code, signal }) })
      child.once('error', (error) => { resolve({ code: null, signal: null, error }) })
    })
    const record: HarnessProcessGeneration = {
      generation,
      child,
      controlChannel,
      exitPromise: rawExitPromise,
      detachOutput: undefined,
      stopPromise: undefined,
      lifecycleError: undefined,
      controlAttached: false,
      controlDetached: false,
      exited: false,
    }
    record.exitPromise = rawExitPromise.then((state) => {
      record.exited = true
      this.detachControl(record)
      record.detachOutput?.()
      record.detachOutput = undefined
      if (this.active === record) this.active = undefined
      this.options.onExit?.(state)
      return state
    })
    this.active = record
    try {
      this.options.controlLifecycle?.attach(controlChannel)
      record.controlAttached = this.options.controlLifecycle !== undefined
    } catch (error) {
      await this.stopGeneration(record)
      throw error
    }

    const stdoutOutput = (chunk: Buffer | string): void => {
      this.options.onOutput?.('stdout', chunk.toString())
    }
    const stderrOutput = (chunk: Buffer | string): void => {
      this.options.onOutput?.('stderr', chunk.toString())
    }
    stdout.on('data', stdoutOutput)
    stderr.on('data', stderrOutput)
    record.detachOutput = () => {
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

    const exitedBeforeReady = (): Promise<never> => record.exitPromise.then((state) => {
      throw new Error(`Harness exited before startup completed (${describeExit(state)}).`)
    })

    try {
      const url = await Promise.race([startupUrl, exitedBeforeReady()])
      this.options.markStartup?.('url-reported')
      await Promise.race([this.options.waitForHarness(url), exitedBeforeReady()])
      this.options.markStartup?.('harness-ready')
      return url
    } catch (error) {
      detachStartup()
      await this.stopGeneration(record)
      throw error
    }
  }

  /** Stop the exact owned generation once and share its terminal with concurrent callers. */
  stop(): Promise<void> {
    const record = this.active
    if (record !== undefined) return this.stopGeneration(record)
    return this.lastStop?.promise ?? Promise.resolve()
  }

  private stopGeneration(record: HarnessProcessGeneration): Promise<void> {
    if (record.stopPromise !== undefined) return record.stopPromise
    // Defer the hook until after publishing the promise so even a re-entrant
    // stop call from lifecycle code observes this exact generation terminal.
    const promise = Promise.resolve().then(async () => { await this.performStop(record) })
    record.stopPromise = promise
    this.lastStop = { record, promise }
    void promise.then(
      () => { if (this.lastStop?.record === record) this.lastStop = undefined },
      () => { if (this.lastStop?.record === record) this.lastStop = undefined },
    )
    return promise
  }

  private async performStop(record: HarnessProcessGeneration): Promise<void> {
    try {
      if (record.controlAttached && !record.controlDetached) {
        await this.options.controlLifecycle?.beforeStop(record.controlChannel)
      }
    } catch (error) {
      record.lifecycleError = error
    } finally {
      this.detachControl(record)
    }
    record.detachOutput?.()
    record.detachOutput = undefined
    const pid = record.child.pid
    if (!record.exited && record.child.exitCode === null && pid !== undefined) {
      const initialMode = this.options.platform === 'win32' ? 'force' : 'graceful'
      this.options.terminateTree(pid, initialMode, this.options.platform)
      if (!await settledWithin(record.exitPromise, this.options.stopTimeoutMs)) {
        this.options.terminateTree(pid, 'force', this.options.platform)
        if (!await settledWithin(record.exitPromise, this.options.stopTimeoutMs)) {
          throw new Error(`Harness process tree ${String(pid)} did not exit after forced termination.`)
        }
      }
    }
    await record.exitPromise
    if (record.lifecycleError !== undefined) {
      throw record.lifecycleError instanceof Error
        ? record.lifecycleError
        : new Error('Harness control shutdown failed.', { cause: record.lifecycleError })
    }
  }

  private detachControl(record: HarnessProcessGeneration): void {
    if (record.controlDetached) return
    record.controlDetached = true
    record.controlAttached = false
    try {
      this.options.controlLifecycle?.detach(record.controlChannel)
    } catch (error) {
      if (record.lifecycleError === undefined) record.lifecycleError = error
    }
  }
}

function createHarnessControlChannel(child: ChildProcess, generation: number): HarnessControlChannel {
  return Object.freeze({
    generation,
    get connected() { return child.connected },
    send(frame: Uint8Array, callback: (error?: Error) => void): void {
      const copy = new Uint8Array(frame)
      if (!child.connected) {
        callback(new Error('Harness child IPC channel is disconnected.'))
        return
      }
      child.send(copy, (error) => { callback(error ?? undefined) })
    },
    onMessage(listener: (frame: Uint8Array) => void): () => void {
      const handle = (message: unknown): void => {
        listener(message instanceof Uint8Array ? new Uint8Array(message) : new Uint8Array())
      }
      child.on('message', handle)
      return () => { child.off('message', handle) }
    },
    onDisconnect(listener: () => void): () => void {
      child.on('disconnect', listener)
      return () => { child.off('disconnect', listener) }
    },
    disconnect(): void {
      if (child.connected) child.disconnect()
    },
  })
}
