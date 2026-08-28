import {
  BRIDGE_REQUEST_KINDS,
  DesktopControlFrameDecoder,
  DesktopControlProtocolError,
  PROTOCOL_LIMITS,
  encodeJsonFrame,
  encodePngFrame,
  type BridgeRequest,
  type DecodedDesktopControlEnvelope,
  type DesktopControlControl,
  type DesktopControlErrorCode,
  type DesktopControlMessage,
  type DesktopControlResultMap,
  type ControlLeaseId,
  type ImmutablePng,
  type SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type { HarnessControlChannel, HarnessControlLifecycle } from '../harness/process.ts'

const MAX_PENDING = 32
const MAX_TOMBSTONES = 256
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000
const BRIDGE_KINDS = new Set<string>(BRIDGE_REQUEST_KINDS)

/** Bounded context passed to the later authoritative Task 6 coordinator seam. */
export interface DesktopControlDispatchContext {
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly generation: number
  registerAcquisition(completion: DesktopControlAcquisitionCompletion): boolean
}

/** Exact provisional-acquire lifecycle retained until the bridge accepts its response. */
export interface DesktopControlAcquisitionCompletion {
  accept(): void
  cancel(): Promise<void>
}

/** Task 6 injection seam; this bridge owns transport but never mints authority. */
export interface DesktopControlBackend {
  dispatch(
    request: BridgeRequest,
    context: DesktopControlDispatchContext,
  ): Promise<DecodedDesktopControlEnvelope>
  revokeSession(sessionId: SessionId, signal: AbortSignal): Promise<void>
  transportAttached?(): void
  transportClosed?(reason: string): void
}

/** Content-free diagnostics allowed from this privileged bridge. */
export interface DesktopControlBridgeLog {
  readonly direction: 'harness-to-electron' | 'electron-to-harness'
  readonly generation: number
  readonly pending: number
  readonly reason: string
}

interface PendingDispatch {
  readonly request: BridgeRequest
  readonly generation: number
  readonly deadlineUnixMs: number
  readonly lease?: { readonly leaseId: ControlLeaseId; readonly leaseRevision: number }
  readonly controller: AbortController
  readonly timer: ReturnType<typeof setTimeout>
  acquisition?: DesktopControlAcquisitionCompletion
}

interface Tombstone {
  readonly sessionId: SessionId
  readonly requestKind: BridgeRequest['requestKind']
}

interface SendEntry {
  readonly frames: readonly Uint8Array[]
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  index: number
}

class CallbackFrameQueue {
  private readonly queue: SendEntry[] = []
  private active = false
  private closed: Error | undefined

  constructor(
    private readonly channel: HarnessControlChannel,
    private readonly generation: number,
  ) {}

  enqueue(frames: readonly Uint8Array[]): Promise<void> {
    if (this.closed !== undefined) return Promise.reject(this.closed)
    const copies = Object.freeze(frames.map(frame => new Uint8Array(frame)))
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ frames: copies, index: 0, resolve, reject })
      this.pump()
    })
  }

  close(error: Error): void {
    if (this.closed !== undefined) return
    this.closed = error
    this.active = false
    for (const entry of this.queue.splice(0)) entry.reject(error)
  }

  private pump(): void {
    if (this.active || this.closed !== undefined) return
    const entry = this.queue[0]
    if (entry === undefined) return
    const frame = entry.frames[entry.index]
    if (frame === undefined) {
      this.queue.shift()
      entry.resolve()
      this.pump()
      return
    }
    this.active = true
    this.channel.send(frame, (error) => {
      if (this.closed !== undefined || this.channel.generation !== this.generation) return
      this.active = false
      if (error !== undefined) {
        this.close(error)
        return
      } else {
        entry.index += 1
        if (entry.index >= entry.frames.length) {
          this.queue.shift()
          entry.resolve()
        }
      }
      this.pump()
    })
  }
}

interface BridgeState {
  readonly channel: HarnessControlChannel
  readonly generation: number
  readonly decoder: DesktopControlFrameDecoder
  readonly sender: CallbackFrameQueue
  readonly pending: Map<string, PendingDispatch>
  readonly tombstones: Map<string, Tombstone>
  detachMessage: () => void
  detachDisconnect: () => void
  admission: boolean
  closed: boolean
}

function harnessToElectron(message: DesktopControlMessage): undefined {
  if (message.messageKind === 'request' && BRIDGE_KINDS.has(message.requestKind)) return undefined
  if (message.messageKind === 'control'
    && (message.controlKind === 'request.cancel' || message.controlKind === 'session.revoke')) return undefined
  throw new DesktopControlProtocolError('message is forbidden from Harness to Electron')
}

function electronToHarness(message: DesktopControlMessage): undefined {
  if (message.messageKind === 'response') return undefined
  if (message.messageKind === 'control'
    && (message.controlKind === 'lease.revoke' || message.controlKind === 'parent.shutdown')) return undefined
  throw new DesktopControlProtocolError('message is forbidden from Electron to Harness')
}

function errorResponse(
  request: BridgeRequest,
  code: DesktopControlErrorCode,
  message: string,
): DesktopControlMessage {
  return {
    protocolVersion: 1,
    messageKind: 'response',
    responseKind: 'error',
    requestId: request.requestId,
    requestKind: request.requestKind,
    error: { code, message, retryable: false },
  }
}

function imageMetadata(message: DesktopControlMessage): {
  readonly transferId: Parameters<typeof encodePngFrame>[0]
} | undefined {
  if (message.messageKind !== 'response' || message.responseKind !== 'ok') return undefined
  if (message.requestKind !== 'browser.snapshot' && message.requestKind !== 'computer.snapshot') return undefined
  return message.result.image
}

function encodedEnvelope(envelope: DecodedDesktopControlEnvelope): readonly Uint8Array[] {
  electronToHarness(envelope.message)
  const json = encodeJsonFrame(envelope.message)
  const image = imageMetadata(envelope.message)
  if ((image === undefined) !== (envelope.png === undefined)) {
    throw new DesktopControlProtocolError('response image metadata and PNG must be present together')
  }
  if (image === undefined || envelope.png === undefined) return Object.freeze([json])
  const png = encodePngFrame(image.transferId, envelope.png.read())
  const verifier = new DesktopControlFrameDecoder(electronToHarness)
  if (verifier.pushFrame(json).length !== 0 || verifier.pushFrame(png).length !== 1) {
    throw new DesktopControlProtocolError('response PNG envelope did not correlate')
  }
  return Object.freeze([json, png])
}

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('Desktop control shutdown timed out.')) }, timeoutMs)
    timer.unref()
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error('Desktop control shutdown failed.', { cause: error }))
      },
    )
  })
}

function leaseTuple(request: BridgeRequest): PendingDispatch['lease'] {
  if (!('leaseId' in request) || !('leaseRevision' in request)) return undefined
  return Object.freeze({ leaseId: request.leaseId, leaseRevision: request.leaseRevision })
}

/** Electron-main peer for the dedicated raw-frame channel to the owned Harness child. */
export class DesktopControlBridgeServer implements HarnessControlLifecycle {
  private state: BridgeState | undefined
  private readonly now: () => number
  private readonly shutdownTimeoutMs: number
  private readonly log: ((event: DesktopControlBridgeLog) => void) | undefined
  private readonly beforeControlShutdown: (signal: AbortSignal) => Promise<void>

  /** Create a bridge over an injected Task 6 backend and cleanup seam. */
  constructor(private readonly options: {
    readonly backend: DesktopControlBackend
    readonly now?: () => number
    readonly shutdownTimeoutMs?: number
    readonly beforeControlShutdown?: (signal: AbortSignal) => Promise<void>
    readonly log?: (event: DesktopControlBridgeLog) => void
  }) {
    this.now = options.now ?? Date.now
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    this.beforeControlShutdown = options.beforeControlShutdown ?? (() => Promise.resolve())
    this.log = options.log
  }

  /** Attach one exact child generation after detaching any stale generation. */
  attach(channel: HarnessControlChannel): void {
    const previous = this.state
    if (previous !== undefined) this.close(previous, 'generation-replaced', false)
    const state: BridgeState = {
      channel,
      generation: channel.generation,
      decoder: new DesktopControlFrameDecoder(harnessToElectron),
      sender: new CallbackFrameQueue(channel, channel.generation),
      pending: new Map(),
      tombstones: new Map(),
      detachMessage: () => undefined,
      detachDisconnect: () => undefined,
      admission: true,
      closed: false,
    }
    this.state = state
    this.options.backend.transportAttached?.()
    state.detachMessage = channel.onMessage((frame) => {
      if (this.state !== state || channel.generation !== state.generation) return
      this.acceptFrame(state, frame)
    })
    state.detachDisconnect = channel.onDisconnect(() => {
      if (this.state === state) this.close(state, 'peer-disconnected', false)
    })
  }

  /** Detach listeners and pending work for the exact owned generation. */
  detach(channel: HarnessControlChannel): void {
    const state = this.state
    if (state === undefined || state.channel !== channel) return
    this.close(state, 'detached', false)
  }

  /**
   * Stop admission, await the injected Task 6 cleanup, send parent shutdown,
   * then disconnect only this IPC channel. HarnessProcess terminates the tree afterward.
   */
  async beforeStop(channel: HarnessControlChannel): Promise<void> {
    const state = this.state
    if (state === undefined || state.channel !== channel || state.closed) return
    state.admission = false
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort(new Error('Desktop control authority cleanup timed out.'))
    }, this.shutdownTimeoutMs)
    timer.unref()
    try {
      await timeoutPromise(this.beforeControlShutdown(controller.signal), this.shutdownTimeoutMs).catch(() => undefined)
      const shutdown: DesktopControlControl = {
        protocolVersion: 1,
        messageKind: 'control',
        controlKind: 'parent.shutdown',
      }
      await timeoutPromise(state.sender.enqueue([encodeJsonFrame(shutdown)]), this.shutdownTimeoutMs).catch(() => undefined)
    } finally {
      clearTimeout(timer)
      this.close(state, 'parent-shutdown', true)
    }
  }

  /** Emit one exact lease revocation and cancel only its matching active work. */
  revokeLease(control: Extract<DesktopControlControl, { controlKind: 'lease.revoke' }>): void {
    const state = this.state
    if (state === undefined || state.closed) return
    // Queue revocation first so the Host invalidates its shared descriptor
    // cache before any matching request receives its terminal error.
    void state.sender.enqueue([encodeJsonFrame(control)]).catch(() => { this.close(state, 'send-failed', true) })
    for (const pending of [...state.pending.values()]) {
      if (pending.request.sessionId === control.sessionId
        && pending.lease?.leaseId === control.leaseId
        && pending.lease.leaseRevision === control.leaseRevision) {
        this.settleError(state, pending, 'LEASE_REVOKED', 'Desktop control lease was revoked.')
      }
    }
  }

  private acceptFrame(state: BridgeState, frame: Uint8Array): void {
    try {
      const envelopes = state.decoder.pushFrame(new Uint8Array(frame))
      if (this.state !== state || state.closed) return
      for (const envelope of envelopes) this.acceptEnvelope(state, envelope)
    } catch {
      this.close(state, 'protocol-error', true)
    }
  }

  private acceptEnvelope(state: BridgeState, envelope: DecodedDesktopControlEnvelope): void {
    const message = envelope.message
    if (message.messageKind === 'control') {
      this.acceptControl(state, message)
      return
    }
    if (message.messageKind !== 'request' || !BRIDGE_KINDS.has(message.requestKind)) {
      this.close(state, 'wrong-direction', true)
      return
    }
    this.acceptRequest(state, message as BridgeRequest)
  }

  private acceptControl(state: BridgeState, control: DesktopControlControl): void {
    if (control.controlKind === 'request.cancel') {
      const id = String(control.requestId)
      const pending = state.pending.get(id)
      if (pending !== undefined) {
        if (pending.request.sessionId !== control.sessionId) {
          this.close(state, 'cancel-mismatch', true)
          return
        }
        this.settleError(state, pending, 'CANCELLED', 'Desktop control request was cancelled.')
        return
      }
      const terminal = state.tombstones.get(id)
      if (terminal !== undefined && terminal.sessionId === control.sessionId) return
      this.close(state, 'cancel-mismatch', true)
      return
    }
    if (control.controlKind === 'session.revoke') {
      for (const pending of [...state.pending.values()]) {
        if (pending.request.sessionId === control.sessionId) {
          this.settleError(state, pending, 'CANCELLED', 'Desktop control session was disposed.')
        }
      }
      const controller = new AbortController()
      void this.options.backend.revokeSession(control.sessionId, controller.signal).catch(() => {
        this.logEvent(state, 'backend-session-revoke-failed')
      })
      return
    }
    this.close(state, 'wrong-direction', true)
  }

  private acceptRequest(state: BridgeState, request: BridgeRequest): void {
    if (!state.admission) {
      this.sendError(state, request, 'DISCONNECTED', 'Desktop control admission is closed.')
      return
    }
    const id = String(request.requestId)
    if (state.pending.has(id) || state.tombstones.has(id)) {
      this.rejectRequest(state, request, 'DUPLICATE_REQUEST', 'Desktop control request id was already used.')
      return
    }
    if (state.pending.size >= MAX_PENDING) {
      this.rejectRequest(state, request, 'TOO_MANY_PENDING', 'Desktop control pending limit reached.')
      return
    }
    const nowUnixMs = this.now()
    if (request.deadlineUnixMs <= nowUnixMs
      || request.deadlineUnixMs > nowUnixMs + PROTOCOL_LIMITS.maxDeadlineAheadMs) {
      this.rejectRequest(state, request, 'TIMEOUT', 'Desktop control deadline is invalid.')
      return
    }
    const timeoutMs = request.deadlineUnixMs - nowUnixMs
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const pending = state.pending.get(id)
      if (pending !== undefined) this.settleError(state, pending, 'TIMEOUT', 'Desktop control request timed out.')
    }, timeoutMs)
    timer.unref()
    const lease = leaseTuple(request)
    const pending: PendingDispatch = {
      request,
      generation: state.generation,
      deadlineUnixMs: request.deadlineUnixMs,
      ...(lease === undefined ? {} : { lease }),
      controller,
      timer,
    }
    state.pending.set(id, pending)
    void this.options.backend.dispatch(request, {
      signal: controller.signal,
      timeoutMs,
      generation: state.generation,
      registerAcquisition: (completion) => {
        if (request.requestKind !== 'control.lease.acquire'
          || this.state !== state || state.closed
          || state.pending.get(id) !== pending || controller.signal.aborted
          || pending.acquisition !== undefined) return false
        pending.acquisition = completion
        return true
      },
    }).then(
      (envelope) => { this.complete(state, pending, envelope) },
      () => {
        if (state.pending.get(id) === pending) {
          this.settleError(state, pending, 'INTERNAL', 'Desktop control backend failed.')
          this.logEvent(state, 'backend-failed')
        }
      },
    )
  }

  private complete(
    state: BridgeState,
    pending: PendingDispatch,
    envelope: DecodedDesktopControlEnvelope,
  ): void {
    const id = String(pending.request.requestId)
    if (this.state !== state
      || state.closed
      || state.generation !== pending.generation
      || state.pending.get(id) !== pending) return
    const message = envelope.message
    if (message.messageKind !== 'response'
      || message.requestId !== pending.request.requestId
      || message.requestKind !== pending.request.requestKind) {
      this.settleError(state, pending, 'INTERNAL', 'Desktop control backend response mismatch.')
      return
    }
    let frames: readonly Uint8Array[]
    try {
      frames = encodedEnvelope(envelope)
    } catch {
      this.settleError(state, pending, 'INTERNAL', 'Desktop control backend envelope is invalid.')
      return
    }
    if (message.responseKind === 'ok' && message.requestKind === 'control.lease.acquire') {
      if (pending.acquisition === undefined) {
        this.settleError(state, pending, 'INTERNAL', 'Desktop control acquisition was not registered.')
        return
      }
      pending.acquisition.accept()
      delete pending.acquisition
    } else {
      this.cancelAcquisition(pending)
    }
    this.finishPending(state, pending)
    void state.sender.enqueue(frames).catch(() => { this.close(state, 'send-failed', true) })
  }

  private settleError(
    state: BridgeState,
    pending: PendingDispatch,
    code: DesktopControlErrorCode,
    message: string,
  ): void {
    const id = String(pending.request.requestId)
    if (state.pending.get(id) !== pending) return
    pending.controller.abort(new Error(code))
    this.cancelAcquisition(pending)
    this.finishPending(state, pending)
    this.sendError(state, pending.request, code, message)
  }

  private finishPending(state: BridgeState, pending: PendingDispatch): void {
    const id = String(pending.request.requestId)
    if (state.pending.get(id) !== pending) return
    state.pending.delete(id)
    clearTimeout(pending.timer)
    this.addTombstone(state, id, {
      sessionId: pending.request.sessionId,
      requestKind: pending.request.requestKind,
    })
  }

  private cancelAcquisition(pending: PendingDispatch): void {
    const acquisition = pending.acquisition
    if (acquisition === undefined) return
    delete pending.acquisition
    void acquisition.cancel().catch(() => undefined)
  }

  private sendError(
    state: BridgeState,
    request: BridgeRequest,
    code: DesktopControlErrorCode,
    message: string,
  ): void {
    const frame = encodeJsonFrame(errorResponse(request, code, message))
    void state.sender.enqueue([frame]).catch(() => { this.close(state, 'send-failed', true) })
  }

  private rejectRequest(
    state: BridgeState,
    request: BridgeRequest,
    code: DesktopControlErrorCode,
    message: string,
  ): void {
    const id = String(request.requestId)
    if (!state.pending.has(id) && !state.tombstones.has(id)) {
      this.addTombstone(state, id, {
        sessionId: request.sessionId,
        requestKind: request.requestKind,
      })
    }
    this.sendError(state, request, code, message)
  }

  private addTombstone(state: BridgeState, id: string, tombstone: Tombstone): void {
    if (state.tombstones.has(id)) return
    state.tombstones.set(id, Object.freeze(tombstone))
    while (state.tombstones.size > MAX_TOMBSTONES) {
      const oldest = state.tombstones.keys().next().value
      if (oldest === undefined) break
      state.tombstones.delete(oldest)
    }
  }

  private close(state: BridgeState, reason: string, disconnect: boolean): void {
    if (state.closed) return
    state.closed = true
    state.admission = false
    state.detachMessage()
    state.detachDisconnect()
    for (const pending of [...state.pending.values()]) {
      pending.controller.abort(new Error('DISCONNECTED'))
      this.cancelAcquisition(pending)
      clearTimeout(pending.timer)
      this.addTombstone(state, String(pending.request.requestId), {
        sessionId: pending.request.sessionId,
        requestKind: pending.request.requestKind,
      })
    }
    state.pending.clear()
    state.sender.close(new Error('Desktop control bridge disconnected.'))
    if (this.state === state) this.state = undefined
    try { this.options.backend.transportClosed?.(reason) } catch { /* transport is already closed */ }
    this.logEvent(state, reason)
    if (disconnect && state.channel.connected) state.channel.disconnect()
  }

  private logEvent(state: BridgeState, reason: string): void {
    this.log?.({
      direction: 'harness-to-electron',
      generation: state.generation,
      pending: state.pending.size,
      reason,
    })
  }
}

/** Fail-closed placeholder used until Task 6 installs authoritative control coordination. */
export const unavailableDesktopControlBackend: DesktopControlBackend = Object.freeze({
  dispatch(request: BridgeRequest): Promise<DecodedDesktopControlEnvelope> {
    return Promise.resolve(Object.freeze({
      message: errorResponse(request, 'NOT_SUPPORTED', 'Desktop control authority is not installed.'),
    }))
  },
  revokeSession: () => Promise.resolve(),
})

/** Type-level assertion that every backend result remains protocol-owned. */
export type DesktopControlBackendResult<K extends keyof DesktopControlResultMap> = DesktopControlResultMap[K]
/** Type-level assertion that image bytes remain protocol-owned and immutable. */
export type DesktopControlBackendPng = ImmutablePng
