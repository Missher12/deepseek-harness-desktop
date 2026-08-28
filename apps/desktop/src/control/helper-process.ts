import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import { isAbsolute } from 'node:path'
import {
  DesktopControlFrameDecoder,
  DesktopControlProtocolError,
  HELPER_REQUEST_KINDS,
  LengthPrefixedFrameDecoder,
  encodeJsonFrame,
  encodeLengthPrefixedFrame,
  type DecodedDesktopControlEnvelope,
  type DesktopControlControl,
  type DesktopControlMessage,
  type HelperRequest,
} from '@deepseek-ai/dsh-desktop-control-protocol'

const MAX_PENDING = 32
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000
const HELPER_KINDS: ReadonlySet<string> = new Set(HELPER_REQUEST_KINDS)

/** Closed spawn seam used by focused lifecycle tests. */
export type SpawnNativeHelper = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams

const defaultSpawn: SpawnNativeHelper = (executable, args, options) =>
  nodeSpawn(executable, [...args], options) as ChildProcessWithoutNullStreams

/** Process launcher dependencies owned by Electron main. */
export interface NativeHelperProcessOptions {
  readonly binaryPath: string
  readonly spawn?: SpawnNativeHelper
  readonly shutdownTimeoutMs?: number
}

/** Bounded link-level failures; child stderr and raw provider errors are never exposed. */
export class NativeHelperProcessError extends Error {
  override readonly name = 'NativeHelperProcessError'

  constructor(readonly code: 'TIMEOUT' | 'CANCELLED' | 'DISCONNECTED' | 'TOO_MANY_PENDING') {
    super(code === 'TIMEOUT'
      ? 'Native Computer Use helper timed out.'
      : code === 'CANCELLED'
        ? 'Native Computer Use helper request was cancelled.'
        : code === 'TOO_MANY_PENDING'
          ? 'Native Computer Use helper is busy.'
          : 'Native Computer Use helper disconnected.')
  }
}

interface PendingRequest {
  readonly requestKind: HelperRequest['requestKind']
  readonly resolve: (value: DecodedDesktopControlEnvelope) => void
  readonly reject: (error: NativeHelperProcessError) => void
  readonly timer: NodeJS.Timeout
  detachAbort: (() => void) | undefined
}

function helperToElectron(message: DesktopControlMessage): undefined {
  if (message.messageKind === 'response' && HELPER_KINDS.has(message.requestKind)) return undefined
  throw new DesktopControlProtocolError('message is forbidden from helper to Electron')
}

/** On-demand, no-port owner of the exact packaged native helper child. */
export class NativeHelperProcess {
  private readonly spawn: SpawnNativeHelper
  private readonly shutdownTimeoutMs: number
  private child: ChildProcessWithoutNullStreams | undefined
  private lengths: LengthPrefixedFrameDecoder | undefined
  private frames: DesktopControlFrameDecoder | undefined
  private readonly pending = new Map<string, PendingRequest>()
  private closing = false
  private exitPromise: Promise<void> | undefined
  private resolveExit: (() => void) | undefined

  /** Whether the exact owned helper child is currently live. */
  get running(): boolean {
    return this.child !== undefined
  }

  /** Retain verified launch dependencies without starting the helper while idle. */
  constructor(readonly options: NativeHelperProcessOptions) {
    if (!isAbsolute(options.binaryPath)) throw new Error('Native helper path must be absolute.')
    this.spawn = options.spawn ?? defaultSpawn
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  }

  /** Send one strict helper request, spawning the child only when first needed. */
  request(request: HelperRequest, signal?: AbortSignal): Promise<DecodedDesktopControlEnvelope> {
    if (this.closing) return Promise.reject(new NativeHelperProcessError('DISCONNECTED'))
    if (signal?.aborted === true) return Promise.reject(new NativeHelperProcessError('CANCELLED'))
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new NativeHelperProcessError('TOO_MANY_PENDING'))
    const requestId = String(request.requestId)
    if (this.pending.has(requestId)) return Promise.reject(new NativeHelperProcessError('TOO_MANY_PENDING'))
    const child = this.ensureChild()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestId)
        if (pending === undefined) return
        this.pending.delete(requestId)
        pending.detachAbort?.()
        reject(new NativeHelperProcessError('TIMEOUT'))
      }, request.timeoutMs)
      timer.unref()
      const pending: PendingRequest = {
        requestKind: request.requestKind,
        resolve,
        reject,
        timer,
        detachAbort: undefined,
      }
      if (signal !== undefined) {
        const abort = () => {
          if (!this.pending.delete(requestId)) return
          clearTimeout(timer)
          reject(new NativeHelperProcessError('CANCELLED'))
        }
        signal.addEventListener('abort', abort, { once: true })
        pending.detachAbort = () => { signal.removeEventListener('abort', abort) }
      }
      this.pending.set(requestId, pending)
      this.write(child, encodeLengthPrefixedFrame(encodeJsonFrame(request)), requestId)
    })
  }

  /** Send one strict revocation/control message without opening a network endpoint. */
  sendControl(control: DesktopControlControl): void {
    if (this.closing) return
    const child = this.child
    // With no owned child there is no native state to revoke or cancel.
    if (child === undefined) return
    this.write(child, encodeLengthPrefixedFrame(encodeJsonFrame(control)))
  }

  /** End stdin normally, then use a bounded terminate/kill ladder for the exact child. */
  async shutdown(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    if (this.closing && this.exitPromise !== undefined) return this.exitPromise
    this.closing = true
    this.rejectPending('CANCELLED')
    child.stdin.end()
    const exited = this.exitPromise ?? Promise.resolve()
    if (await settlesWithin(exited, this.shutdownTimeoutMs)) return
    child.kill('SIGTERM')
    if (await settlesWithin(exited, this.shutdownTimeoutMs)) return
    child.kill('SIGKILL')
    await settlesWithin(exited, this.shutdownTimeoutMs)
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child !== undefined) return this.child
    const child = this.spawn(this.options.binaryPath, [], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    this.lengths = new LengthPrefixedFrameDecoder()
    this.frames = new DesktopControlFrameDecoder(helperToElectron)
    this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve })
    child.stderr.resume()
    child.stdout.on('data', (chunk: Buffer) => { this.onStdout(new Uint8Array(chunk)) })
    child.stdout.on('error', () => { this.failLink() })
    child.stdin.on('error', () => { this.failLink() })
    child.once('error', () => { this.failLink() })
    child.once('exit', () => { this.onExit(child) })
    return child
  }

  private onStdout(chunk: Uint8Array): void {
    try {
      const lengths = this.lengths
      const frames = this.frames
      if (lengths === undefined || frames === undefined) throw new DesktopControlProtocolError('helper link is closed')
      for (const frame of lengths.push(new Uint8Array(chunk))) {
        for (const envelope of frames.pushFrame(frame)) this.resolveEnvelope(envelope)
      }
    } catch {
      this.failLink()
    }
  }

  private resolveEnvelope(envelope: DecodedDesktopControlEnvelope): void {
    const message = envelope.message
    if (message.messageKind !== 'response') throw new DesktopControlProtocolError('helper response expected')
    const requestId = String(message.requestId)
    const pending = this.pending.get(requestId)
    if (pending === undefined || pending.requestKind !== message.requestKind) {
      throw new DesktopControlProtocolError('helper response correlation mismatch')
    }
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    pending.detachAbort?.()
    pending.resolve(envelope)
  }

  private write(child: ChildProcessWithoutNullStreams, frame: Uint8Array, requestId?: string): void {
    child.stdin.write(Buffer.from(new Uint8Array(frame)), (error?: Error | null) => {
      if (error === undefined || error === null) return
      if (requestId !== undefined) this.rejectOne(requestId, 'DISCONNECTED')
      this.failLink()
    })
  }

  private rejectOne(requestId: string, code: NativeHelperProcessError['code']): void {
    const pending = this.pending.get(requestId)
    if (pending === undefined) return
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    pending.detachAbort?.()
    pending.reject(new NativeHelperProcessError(code))
  }

  private rejectPending(code: NativeHelperProcessError['code']): void {
    for (const requestId of [...this.pending.keys()]) this.rejectOne(requestId, code)
  }

  private failLink(): void {
    const child = this.child
    if (child === undefined) return
    this.rejectPending('DISCONNECTED')
    this.detachChild(child)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }

  private onExit(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    if (!this.closing) this.rejectPending('DISCONNECTED')
    this.detachChild(child)
  }

  private detachChild(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    try { this.lengths?.finish() } catch {}
    try { this.frames?.finish() } catch {}
    this.child = undefined
    this.lengths = undefined
    this.frames = undefined
    this.resolveExit?.()
    this.resolveExit = undefined
    this.exitPromise = undefined
  }
}

function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { resolve(false) }, timeoutMs)
    timer.unref()
    void promise.then(
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
