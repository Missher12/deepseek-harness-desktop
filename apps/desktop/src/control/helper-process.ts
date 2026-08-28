import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import { createHash, timingSafeEqual } from 'node:crypto'
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
  type HelperInputReleaseRequest,
} from '@deepseek-ai/dsh-desktop-control-protocol'

const MAX_PENDING = 32
const MAX_TOMBSTONES = 256
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
  readonly onUnexpectedExit?: () => void
  readonly lstatBinary?: (path: string) => { isFile(): boolean; isSymbolicLink(): boolean }
  readonly readBinary?: (path: string) => Uint8Array
}

/** Bounded link-level failures; child stderr and raw provider errors are never exposed. */
export class NativeHelperProcessError extends Error {
  override readonly name = 'NativeHelperProcessError'

  constructor(readonly code: 'TIMEOUT' | 'CANCELLED' | 'DISCONNECTED' | 'TOO_MANY_PENDING' | 'BINARY_MISMATCH') {
    super(code === 'TIMEOUT'
      ? 'Native Computer Use helper timed out.'
      : code === 'CANCELLED'
        ? 'Native Computer Use helper request was cancelled.'
        : code === 'BINARY_MISMATCH'
          ? 'Native Computer Use helper binary did not match.'
          : code === 'TOO_MANY_PENDING'
            ? 'Native Computer Use helper is busy.'
            : 'Native Computer Use helper disconnected.')
  }
}

interface PendingRequest {
  readonly requestId: HelperRequest['requestId']
  readonly requestKind: HelperRequest['requestKind']
  readonly sessionId: HelperRequest['sessionId']
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
  private readonly tombstones = new Map<string, HelperRequest['requestKind']>()
  private permanentlyClosed = false
  private stopping = false
  private linkFailed = false
  private spawnConfirmed = false
  private exitPromise: Promise<void> | undefined
  private resolveExit: (() => void) | undefined
  private stopPromise: Promise<void> | undefined
  private binaryIdentity: Buffer | undefined
  private recoveryPromise: Promise<DecodedDesktopControlEnvelope> | undefined

  /** Whether the exact owned helper child is currently live. */
  get running(): boolean {
    return this.child !== undefined
  }

  /** Retain verified launch dependencies without starting the helper while idle. */
  constructor(
    readonly options: NativeHelperProcessOptions,
    private readonly expectedBinaryIdentity?: Buffer,
  ) {
    if (!isAbsolute(options.binaryPath)) throw new Error('Native helper path must be absolute.')
    this.spawn = options.spawn ?? defaultSpawn
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  }

  /** Send one strict helper request, spawning the child only when first needed. */
  request(request: HelperRequest, signal?: AbortSignal): Promise<DecodedDesktopControlEnvelope> {
    if (this.permanentlyClosed || this.stopping || this.linkFailed) {
      return Promise.reject(new NativeHelperProcessError('DISCONNECTED'))
    }
    if (signal?.aborted === true) return Promise.reject(new NativeHelperProcessError('CANCELLED'))
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new NativeHelperProcessError('TOO_MANY_PENDING'))
    try {
      this.captureBinaryIdentity()
    } catch (error) {
      return Promise.reject(error instanceof NativeHelperProcessError
        ? error
        : new NativeHelperProcessError('DISCONNECTED'))
    }
    const requestId = String(request.requestId)
    if (this.pending.has(requestId) || this.tombstones.has(requestId)) {
      return Promise.reject(new NativeHelperProcessError('TOO_MANY_PENDING'))
    }
    let child: ChildProcessWithoutNullStreams
    try {
      child = this.ensureChild()
    } catch {
      return Promise.reject(new NativeHelperProcessError('DISCONNECTED'))
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cancelOne(child, requestId, 'TIMEOUT')
      }, request.timeoutMs)
      timer.unref()
      const pending: PendingRequest = {
        requestId: request.requestId,
        requestKind: request.requestKind,
        sessionId: request.sessionId,
        resolve,
        reject,
        timer,
        detachAbort: undefined,
      }
      if (signal !== undefined) {
        const abort = () => {
          this.cancelOne(child, requestId, 'CANCELLED')
        }
        signal.addEventListener('abort', abort, { once: true })
        pending.detachAbort = () => { signal.removeEventListener('abort', abort) }
      }
      this.pending.set(requestId, pending)
      this.write(child, encodeLengthPrefixedFrame(encodeJsonFrame(request)))
    })
  }

  /** Send one strict revocation/control message without opening a network endpoint. */
  sendControl(control: DesktopControlControl): void {
    if (this.permanentlyClosed || this.stopping || this.linkFailed) return
    const child = this.child
    // With no owned child there is no native state to revoke or cancel.
    if (child === undefined) return
    this.write(child, encodeLengthPrefixedFrame(encodeJsonFrame(control)))
  }

  /** End stdin normally, then use a bounded terminate/kill ladder for the exact child. */
  shutdown(): Promise<void> {
    this.permanentlyClosed = true
    return this.stopOwnedChild(true)
  }

  /** Stop an idle child without permanently closing this reusable process owner. */
  stopWhenIdle(): Promise<void> {
    if (this.permanentlyClosed || this.pending.size !== 0) return Promise.resolve()
    return this.stopOwnedChild(false)
  }

  /** Reverify identity and release a non-empty held-input journal through one fresh helper. */
  recoverInput(
    request: HelperInputReleaseRequest,
    signal?: AbortSignal,
  ): Promise<DecodedDesktopControlEnvelope> {
    if (request.keys.length + request.buttons.length === 0) {
      return Promise.reject(new NativeHelperProcessError('BINARY_MISMATCH'))
    }
    if (this.recoveryPromise !== undefined) return this.recoveryPromise
    const recovery = this.recoverInputOnce(request, signal)
    this.recoveryPromise = recovery
    void recovery.then(
      () => { if (this.recoveryPromise === recovery) this.recoveryPromise = undefined },
      () => { if (this.recoveryPromise === recovery) this.recoveryPromise = undefined },
    )
    return recovery
  }

  private async recoverInputOnce(
    request: HelperInputReleaseRequest,
    signal?: AbortSignal,
  ): Promise<DecodedDesktopControlEnvelope> {
    const identity = this.binaryIdentity
    if (identity === undefined) throw new NativeHelperProcessError('BINARY_MISMATCH')
    this.verifyCurrentBinary(identity)
    const fresh = new NativeHelperProcess({
      binaryPath: this.options.binaryPath,
      ...(this.options.spawn === undefined ? {} : { spawn: this.options.spawn }),
      shutdownTimeoutMs: this.shutdownTimeoutMs,
      ...(this.options.lstatBinary === undefined ? {} : { lstatBinary: this.options.lstatBinary }),
      ...(this.options.readBinary === undefined ? {} : { readBinary: this.options.readBinary }),
    }, identity)
    try {
      const envelope = await fresh.request(request, signal)
      const response = envelope.message
      if (response.messageKind !== 'response' || response.responseKind !== 'ok'
        || response.requestKind !== 'input.release' || response.requestId !== request.requestId) {
        throw new NativeHelperProcessError('DISCONNECTED')
      }
      return envelope
    } finally {
      if (fresh.running) await fresh.shutdown()
    }
  }

  private captureBinaryIdentity(): void {
    if (this.binaryIdentity !== undefined) return
    const lstatBinary = this.options.lstatBinary
    const readBinary = this.options.readBinary
    if (lstatBinary === undefined || readBinary === undefined) return
    const metadata = lstatBinary(this.options.binaryPath)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new NativeHelperProcessError('BINARY_MISMATCH')
    }
    const identity = createHash('sha256').update(readBinary(this.options.binaryPath)).digest()
    if (this.expectedBinaryIdentity !== undefined
      && !timingSafeEqual(identity, this.expectedBinaryIdentity)) {
      throw new NativeHelperProcessError('BINARY_MISMATCH')
    }
    this.binaryIdentity = identity
  }

  private verifyCurrentBinary(expected: Buffer): void {
    const lstatBinary = this.options.lstatBinary
    const readBinary = this.options.readBinary
    if (lstatBinary === undefined || readBinary === undefined) {
      throw new NativeHelperProcessError('BINARY_MISMATCH')
    }
    let metadata: ReturnType<NonNullable<NativeHelperProcessOptions['lstatBinary']>>
    let identity: Buffer
    try {
      metadata = lstatBinary(this.options.binaryPath)
      identity = createHash('sha256').update(readBinary(this.options.binaryPath)).digest()
    } catch {
      throw new NativeHelperProcessError('BINARY_MISMATCH')
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || !timingSafeEqual(identity, expected)) {
      throw new NativeHelperProcessError('BINARY_MISMATCH')
    }
  }

  private stopOwnedChild(cancelPending: boolean): Promise<void> {
    const child = this.child
    if (child === undefined) return Promise.resolve()
    if (this.stopPromise !== undefined) return this.stopPromise
    const exited = this.exitPromise
    if (exited === undefined) return Promise.reject(new NativeHelperProcessError('DISCONNECTED'))
    this.stopping = true
    this.write(child, encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'parent.shutdown',
    })))
    if (cancelPending) this.rejectPending('CANCELLED')
    const stopping = this.shutdownOwnedChild(child, exited).then(() => {
      if (!this.permanentlyClosed) {
        this.stopping = false
        this.stopPromise = undefined
      }
    })
    this.stopPromise = stopping
    return stopping
  }

  private async shutdownOwnedChild(
    child: ChildProcessWithoutNullStreams,
    exited: Promise<void>,
  ): Promise<void> {
    child.stdin.end()
    if (await settlesWithin(exited, this.shutdownTimeoutMs)) return
    if (this.child === child) child.kill('SIGTERM')
    if (await settlesWithin(exited, this.shutdownTimeoutMs)) return
    if (this.child === child) child.kill('SIGKILL')
    if (await settlesWithin(exited, this.shutdownTimeoutMs)) return
    throw new NativeHelperProcessError('DISCONNECTED')
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child !== undefined) return this.child
    const child = this.spawn(this.options.binaryPath, [], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    this.linkFailed = false
    this.spawnConfirmed = false
    this.lengths = new LengthPrefixedFrameDecoder()
    this.frames = new DesktopControlFrameDecoder(helperToElectron)
    this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve })
    child.stderr.resume()
    child.stdout.on('data', (chunk: Buffer) => { this.onStdout(child, new Uint8Array(chunk)) })
    child.stdout.on('error', () => { this.failLink(child) })
    child.stdin.on('error', () => { this.failLink(child) })
    child.once('spawn', () => { this.onSpawn(child) })
    child.once('error', () => { this.onChildError(child) })
    child.once('exit', () => { this.onExit(child) })
    child.once('close', () => { this.onExit(child) })
    return child
  }

  private onStdout(child: ChildProcessWithoutNullStreams, chunk: Uint8Array): void {
    if (this.child !== child || this.linkFailed) return
    try {
      const lengths = this.lengths
      const frames = this.frames
      if (lengths === undefined || frames === undefined) throw new DesktopControlProtocolError('helper link is closed')
      for (const frame of lengths.push(new Uint8Array(chunk))) {
        for (const envelope of frames.pushFrame(frame)) this.resolveEnvelope(envelope)
      }
    } catch {
      this.failLink(child)
    }
  }

  private resolveEnvelope(envelope: DecodedDesktopControlEnvelope): void {
    const message = envelope.message
    if (message.messageKind !== 'response') throw new DesktopControlProtocolError('helper response expected')
    const requestId = String(message.requestId)
    const pending = this.pending.get(requestId)
    if (pending === undefined) {
      if (this.tombstones.get(requestId) === message.requestKind) return
      throw new DesktopControlProtocolError('helper response correlation mismatch')
    }
    if (pending.requestKind !== message.requestKind) {
      throw new DesktopControlProtocolError('helper response correlation mismatch')
    }
    this.pending.delete(requestId)
    this.rememberTerminal(requestId, pending.requestKind)
    clearTimeout(pending.timer)
    pending.detachAbort?.()
    pending.resolve(envelope)
  }

  private write(child: ChildProcessWithoutNullStreams, frame: Uint8Array): void {
    child.stdin.write(Buffer.from(new Uint8Array(frame)), (error?: Error | null) => {
      if (this.child !== child) return
      if (error === undefined || error === null) return
      this.failLink(child)
    })
  }

  private rejectOne(requestId: string, code: NativeHelperProcessError['code']): void {
    const pending = this.pending.get(requestId)
    if (pending === undefined) return
    this.pending.delete(requestId)
    this.rememberTerminal(requestId, pending.requestKind)
    clearTimeout(pending.timer)
    pending.detachAbort?.()
    pending.reject(new NativeHelperProcessError(code))
  }

  private rejectPending(code: NativeHelperProcessError['code']): void {
    for (const requestId of [...this.pending.keys()]) this.rejectOne(requestId, code)
  }

  private cancelOne(
    child: ChildProcessWithoutNullStreams,
    requestId: string,
    code: 'TIMEOUT' | 'CANCELLED',
  ): void {
    const pending = this.pending.get(requestId)
    if (pending === undefined) return
    if (this.child === child && this.linkFailed) return
    this.write(child, encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'request.cancel',
      sessionId: pending.sessionId,
      requestId: pending.requestId,
    })))
    this.rejectOne(requestId, code)
  }

  private rememberTerminal(requestId: string, requestKind: HelperRequest['requestKind']): void {
    if (this.tombstones.has(requestId)) return
    this.tombstones.set(requestId, requestKind)
    if (this.tombstones.size <= MAX_TOMBSTONES) return
    const oldest = this.tombstones.keys().next().value
    if (oldest !== undefined) this.tombstones.delete(oldest)
  }

  private failLink(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child || this.linkFailed) return
    this.linkFailed = true
    child.stdout.removeAllListeners('data')
    try { this.lengths?.finish() } catch {}
    try { this.frames?.finish() } catch {}
    this.lengths = undefined
    this.frames = undefined
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }

  private onSpawn(child: ChildProcessWithoutNullStreams): void {
    if (this.child === child) this.spawnConfirmed = true
  }

  private onChildError(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    if (this.spawnConfirmed) {
      this.failLink(child)
      return
    }
    this.detachChild(child)
    this.rejectPending('DISCONNECTED')
  }

  private onExit(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    const unexpected = this.spawnConfirmed && !this.stopping
    const rejectPending = !this.stopping
    this.detachChild(child)
    if (rejectPending) this.rejectPending('DISCONNECTED')
    if (unexpected) this.reportUnexpectedExit()
  }

  private reportUnexpectedExit(): void {
    try { this.options.onUnexpectedExit?.() } catch {}
  }

  private detachChild(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    try { this.lengths?.finish() } catch {}
    try { this.frames?.finish() } catch {}
    this.child = undefined
    this.linkFailed = false
    this.spawnConfirmed = false
    this.lengths = undefined
    this.frames = undefined
    this.tombstones.clear()
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
