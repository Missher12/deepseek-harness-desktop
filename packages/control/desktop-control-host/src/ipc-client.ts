import { randomUUID } from 'node:crypto'
import {
  DesktopControlFrameDecoder,
  DesktopControlProtocolError,
  PROTOCOL_LIMITS,
  RequestId,
  assertBridgeDeadline,
  decodeJsonFrame,
  encodeJsonFrame,
  type BridgeRequest,
  type ControlLeaseAcquireResult,
  type ControlLeaseId,
  type DecodedDesktopControlEnvelope,
  type DesktopControlControl,
  type DesktopControlErrorCode,
  type DesktopControlMessage,
  type SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'

/** Exact maximum number of live requests on one Host control link. */
export const MAX_PENDING_CONTROL_REQUESTS = 32
/** Exact insertion-ordered terminal request-id history retained per generation. */
export const MAX_CONTROL_TOMBSTONES = 256
/** Default bounded cleanup tail used independently of a cancelled model turn. */
export const DEFAULT_CONTROL_CLEANUP_TIMEOUT_MS = 2_000

/** Narrow child-side raw-frame IPC surface; no renderer or socket relay is accepted. */
export interface DesktopControlIpcLink {
  readonly generation: number
  readonly connected: boolean
  send(frame: Uint8Array, callback: (error?: Error) => void): void
  onMessage(listener: (frame: Uint8Array) => void): () => void
  onDisconnect(listener: () => void): () => void
  disconnect(): void
}

/** Content-free metadata permitted at the privileged transport logger. */
export interface DesktopControlTransportLog {
  readonly direction: 'harness-to-electron' | 'electron-to-harness'
  readonly generation: number
  readonly pending: number
  readonly reason: string
}

/** Request surface shared by both Host providers and lifecycle cleanup. */
export interface DesktopControlRequester {
  request(request: BridgeRequest, signal: AbortSignal): Promise<DecodedDesktopControlEnvelope>
  revokeSession(sessionId: SessionId): Promise<void>
}

/** Closed transport failure surfaced by the Host providers. */
export class DesktopControlIpcError extends Error {
  /** Create one bounded protocol error without retaining request content. */
  constructor(readonly code: DesktopControlErrorCode, message: string) {
    super(message)
    this.name = 'DesktopControlIpcError'
  }
}

interface CachedLease {
  readonly sessionId: SessionId
  readonly result: ControlLeaseAcquireResult
}

function freezeLease(result: ControlLeaseAcquireResult): ControlLeaseAcquireResult {
  return Object.freeze({
    leaseId: result.leaseId,
    leaseRevision: result.leaseRevision,
    surfaceKind: result.surfaceKind,
    targets: Object.freeze(result.targets.map(target => Object.freeze({
      appId: target.appId,
      windowIds: Object.freeze([...target.windowIds]),
    }))),
    capabilities: Object.freeze([...result.capabilities]),
    idleExpiresAfterMs: result.idleExpiresAfterMs,
    hardExpiresAfterMs: result.hardExpiresAfterMs,
  })
}

/** One process-wide descriptor cache shared by Browser and Computer providers. */
export class ControlLeaseCache {
  private readonly leases = new Map<SessionId, CachedLease>()

  /**
   * Retain only the detached Electron-authored descriptor for one official session.
   * @param sessionId - Canonical session that owns the descriptor.
   * @param result - Strictly decoded lease descriptor returned by Electron.
   * @returns The detached and deeply frozen descriptor stored in this cache.
   */
  remember(sessionId: SessionId, result: ControlLeaseAcquireResult): ControlLeaseAcquireResult {
    const frozen = freezeLease(result)
    this.leases.set(sessionId, Object.freeze({ sessionId, result: frozen }))
    return frozen
  }

  /**
   * Read the immutable descriptor without transferring cleanup ownership.
   * @param sessionId - Canonical session whose descriptor is requested.
   * @returns The cached descriptor when present, otherwise undefined.
   */
  peek(sessionId: SessionId): ControlLeaseAcquireResult | undefined {
    return this.leases.get(sessionId)?.result
  }

  /**
   * Synchronously invalidate and return one descriptor for an awaited cleanup tail.
   * @param sessionId - Canonical session whose descriptor must be removed.
   * @returns The removed descriptor when present, otherwise undefined.
   */
  take(sessionId: SessionId): ControlLeaseAcquireResult | undefined {
    const cached = this.leases.get(sessionId)
    if (cached === undefined) return undefined
    this.leases.delete(sessionId)
    return cached.result
  }

  /**
   * Invalidate only an exact Electron revocation tuple.
   * @param sessionId - Canonical session named by the revocation.
   * @param leaseId - Branded lease identifier named by the revocation.
   * @param leaseRevision - Exact lease revision named by the revocation.
   * @returns True only when one matching descriptor was removed.
   */
  revoke(sessionId: SessionId, leaseId: ControlLeaseId, leaseRevision: number): boolean {
    const cached = this.leases.get(sessionId)
    if (cached === undefined
      || cached.result.leaseId !== leaseId
      || cached.result.leaseRevision !== leaseRevision) return false
    this.leases.delete(sessionId)
    return true
  }

  /** Remove every descriptor after parent/link teardown. */
  clear(): void {
    this.leases.clear()
  }
}

interface PendingRequest {
  readonly request: BridgeRequest
  readonly generation: number
  readonly deadlineUnixMs: number
  readonly lease?: { readonly leaseId: ControlLeaseId; readonly leaseRevision: number }
  readonly resolve: (envelope: DecodedDesktopControlEnvelope) => void
  readonly reject: (error: DesktopControlIpcError) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly signal: AbortSignal
  readonly abort: () => void
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
    private readonly link: DesktopControlIpcLink,
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
    const queued = this.queue.splice(0)
    this.active = false
    for (const entry of queued) entry.reject(error)
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
    this.link.send(frame, (error) => {
      if (this.closed !== undefined) return
      if (this.link.generation !== this.generation) return
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

function inboundHarnessMessage(message: DesktopControlMessage): undefined {
  if (message.messageKind === 'response') return undefined
  if (message.messageKind === 'control'
    && (message.controlKind === 'lease.revoke' || message.controlKind === 'parent.shutdown')) return undefined
  throw new DesktopControlProtocolError('message is forbidden from Electron to Harness')
}

function leaseTuple(request: BridgeRequest): PendingRequest['lease'] {
  if (!('leaseId' in request) || !('leaseRevision' in request)) return undefined
  return Object.freeze({ leaseId: request.leaseId, leaseRevision: request.leaseRevision })
}

function timeoutError(code: 'TIMEOUT' | 'CANCELLED' | 'DISCONNECTED' | 'LEASE_REVOKED'): DesktopControlIpcError {
  const descriptions = {
    TIMEOUT: 'Desktop control request timed out.',
    CANCELLED: 'Desktop control request was cancelled.',
    DISCONNECTED: 'Desktop control IPC is disconnected.',
    LEASE_REVOKED: 'Desktop control lease was revoked.',
  } as const
  return new DesktopControlIpcError(code, descriptions[code])
}

/** Stateful request ledger and decoder for the Harness side of the owned-child link. */
export class DesktopControlIpcClient implements DesktopControlRequester {
  /** One immutable descriptor cache shared by both control providers. */
  readonly leaseCache: ControlLeaseCache
  private readonly pending = new Map<string, PendingRequest>()
  private readonly tombstones = new Set<string>()
  private readonly decoder = new DesktopControlFrameDecoder(inboundHarnessMessage)
  private readonly sender: CallbackFrameQueue
  private readonly detachMessage: () => void
  private readonly detachDisconnect: () => void
  private readonly now: () => number
  private readonly log: ((event: DesktopControlTransportLog) => void) | undefined
  private closed = false

  /** Attach one process-wide client to one exact child generation. */
  constructor(
    private readonly link: DesktopControlIpcLink,
    options: {
      readonly now?: () => number
      readonly leaseCache?: ControlLeaseCache
      readonly log?: (event: DesktopControlTransportLog) => void
    } = {},
  ) {
    this.now = options.now ?? Date.now
    this.leaseCache = options.leaseCache ?? new ControlLeaseCache()
    this.log = options.log
    this.sender = new CallbackFrameQueue(link, link.generation)
    this.detachMessage = link.onMessage((frame) => { this.acceptFrame(frame) })
    this.detachDisconnect = link.onDisconnect(() => { this.close('peer-disconnected', false) })
  }

  /** Send one strictly validated request and correlate its exact response envelope. */
  request(request: BridgeRequest, signal: AbortSignal): Promise<DecodedDesktopControlEnvelope> {
    if (this.closed || !this.link.connected) return Promise.reject(timeoutError('DISCONNECTED'))
    if (signal.aborted) return Promise.reject(timeoutError('CANCELLED'))
    const frame = encodeJsonFrame(request)
    const canonical = decodeJsonFrame(frame)
    if (canonical.messageKind !== 'request' || !('deadlineUnixMs' in canonical)) {
      return Promise.reject(new DesktopControlIpcError('INTERNAL', 'Desktop control request was not canonical.'))
    }
    const nowUnixMs = this.now()
    try {
      assertBridgeDeadline(canonical, nowUnixMs)
    } catch {
      return Promise.reject(timeoutError('TIMEOUT'))
    }
    const id = String(canonical.requestId)
    if (this.pending.has(id) || this.tombstones.has(id)) {
      return Promise.reject(new DesktopControlIpcError('DUPLICATE_REQUEST', 'Desktop control request id was already used.'))
    }
    if (this.pending.size >= MAX_PENDING_CONTROL_REQUESTS) {
      return Promise.reject(new DesktopControlIpcError('TOO_MANY_PENDING', 'Desktop control pending limit reached.'))
    }

    return new Promise<DecodedDesktopControlEnvelope>((resolve, reject) => {
      const abort = (): void => {
        const entry = this.pending.get(id)
        if (entry === undefined) return
        this.settle(entry, undefined, timeoutError('CANCELLED'))
        const cancel: DesktopControlControl = {
          protocolVersion: 1,
          messageKind: 'control',
          controlKind: 'request.cancel',
          sessionId: entry.request.sessionId,
          requestId: entry.request.requestId,
        }
        void this.sendMessage(cancel).catch(() => { this.close('send-failed') })
      }
      const remaining = canonical.deadlineUnixMs - nowUnixMs
      const timer = setTimeout(() => {
        const entry = this.pending.get(id)
        if (entry === undefined) return
        this.settle(entry, undefined, timeoutError('TIMEOUT'))
        const cancel: DesktopControlControl = {
          protocolVersion: 1,
          messageKind: 'control',
          controlKind: 'request.cancel',
          sessionId: entry.request.sessionId,
          requestId: entry.request.requestId,
        }
        void this.sendMessage(cancel).catch(() => { this.close('send-failed') })
      }, remaining)
      timer.unref()
      const lease = leaseTuple(canonical)
      const entry: PendingRequest = {
        request: canonical,
        generation: this.link.generation,
        deadlineUnixMs: canonical.deadlineUnixMs,
        ...(lease === undefined ? {} : { lease }),
        resolve,
        reject,
        timer,
        signal,
        abort,
      }
      this.pending.set(id, entry)
      signal.addEventListener('abort', abort, { once: true })
      void this.sender.enqueue([frame]).catch(() => { this.close('send-failed') })
    })
  }

  /** Send a session disposal control and await only its send callback. */
  async revokeSession(sessionId: SessionId): Promise<void> {
    this.leaseCache.take(sessionId)
    await this.sendMessage({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'session.revoke',
      sessionId,
    })
  }

  /** Close listeners and reject pending requests without terminating Harness. */
  dispose(): void {
    this.close('disposed')
  }

  private sendMessage(message: DesktopControlMessage): Promise<void> {
    if (this.closed || !this.link.connected) return Promise.reject(timeoutError('DISCONNECTED'))
    return this.sender.enqueue([encodeJsonFrame(message)])
  }

  private acceptFrame(frame: Uint8Array): void {
    if (this.closed) return
    const generation = this.link.generation
    try {
      const envelopes = this.decoder.pushFrame(new Uint8Array(frame))
      if (generation !== this.link.generation) return
      for (const envelope of envelopes) this.acceptEnvelope(envelope)
    } catch {
      this.close('protocol-error')
    }
  }

  private acceptEnvelope(envelope: DecodedDesktopControlEnvelope): void {
    const message = envelope.message
    if (message.messageKind === 'control') {
      if (message.controlKind === 'parent.shutdown') {
        this.close('parent-shutdown')
        return
      }
      if (message.controlKind === 'lease.revoke') {
        this.leaseCache.revoke(message.sessionId, message.leaseId, message.leaseRevision)
        for (const entry of [...this.pending.values()]) {
          if (entry.request.sessionId === message.sessionId
            && entry.lease?.leaseId === message.leaseId
            && entry.lease.leaseRevision === message.leaseRevision) {
            this.settle(entry, undefined, timeoutError('LEASE_REVOKED'))
          }
        }
      }
      return
    }
    if (message.messageKind !== 'response') {
      this.close('wrong-direction')
      return
    }
    const id = String(message.requestId)
    const entry = this.pending.get(id)
    if (entry === undefined) {
      if (this.tombstones.has(id)) return
      this.close('unknown-response')
      return
    }
    if (entry.generation !== this.link.generation || message.requestKind !== entry.request.requestKind) {
      this.close('response-mismatch')
      return
    }
    if (message.responseKind === 'error') {
      this.settle(entry, undefined, new DesktopControlIpcError(message.error.code, message.error.message))
      return
    }
    this.settle(entry, envelope)
  }

  private settle(
    entry: PendingRequest,
    envelope?: DecodedDesktopControlEnvelope,
    error?: DesktopControlIpcError,
  ): void {
    const id = String(entry.request.requestId)
    if (this.pending.get(id) !== entry) return
    this.pending.delete(id)
    clearTimeout(entry.timer)
    entry.signal.removeEventListener('abort', entry.abort)
    this.addTombstone(id)
    if (error !== undefined) entry.reject(error)
    else if (envelope !== undefined) entry.resolve(envelope)
  }

  private addTombstone(requestId: string): void {
    if (this.tombstones.has(requestId)) return
    this.tombstones.add(requestId)
    while (this.tombstones.size > MAX_CONTROL_TOMBSTONES) {
      const oldest = this.tombstones.values().next().value
      if (oldest === undefined) break
      this.tombstones.delete(oldest)
    }
  }

  private close(reason: string, disconnect = true): void {
    if (this.closed) return
    this.closed = true
    this.detachMessage()
    this.detachDisconnect()
    const error = timeoutError('DISCONNECTED')
    this.sender.close(error)
    for (const entry of [...this.pending.values()]) this.settle(entry, undefined, error)
    this.leaseCache.clear()
    this.log?.({
      direction: 'electron-to-harness',
      generation: this.link.generation,
      pending: this.pending.size,
      reason,
    })
    if (disconnect && this.link.connected) this.link.disconnect()
  }
}

/**
 * Derive the exact child-side link only when Node created a real IPC channel.
 * @returns A copied-frame process link, or undefined outside the Electron-owned child.
 */
export function createProcessControlLink(): DesktopControlIpcLink | undefined {
  if (typeof process.send !== 'function' || typeof process.disconnect !== 'function' || !process.connected) return undefined
  const generation = 1
  return Object.freeze({
    generation,
    get connected() { return process.connected },
    send(frame: Uint8Array, callback: (error?: Error) => void): void {
      const copy = new Uint8Array(frame)
      process.send?.(copy, (error) => { callback(error ?? undefined) })
    },
    onMessage(listener: (frame: Uint8Array) => void): () => void {
      const handle = (message: unknown): void => {
        listener(message instanceof Uint8Array ? new Uint8Array(message) : new Uint8Array())
      }
      process.on('message', handle)
      return () => { process.off('message', handle) }
    },
    onDisconnect(listener: () => void): () => void {
      process.on('disconnect', listener)
      return () => { process.off('disconnect', listener) }
    },
    disconnect(): void {
      if (process.connected) process.disconnect()
    },
  })
}

/** Per-session release/revoke tails wired to real awaited and fallback lifecycle boundaries. */
export class ControlLifecycleCoordinator {
  private readonly tails = new Map<SessionId, Promise<void>>()
  private readonly disposedSessions = new Set<SessionId>()
  private readonly now: () => number
  private readonly requestId: () => ReturnType<typeof RequestId>
  private readonly cleanupTimeoutMs: number

  /** Create cleanup tails over the one shared requester and lease cache. */
  constructor(
    private readonly requester: DesktopControlRequester,
    private readonly leaseCache: ControlLeaseCache,
    options: {
      readonly now?: () => number
      readonly requestId?: () => ReturnType<typeof RequestId>
      readonly cleanupTimeoutMs?: number
    } = {},
  ) {
    this.now = options.now ?? Date.now
    this.requestId = options.requestId ?? (() => RequestId(randomUUID()))
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CONTROL_CLEANUP_TIMEOUT_MS
  }

  /**
   * Await normal-path release while deliberately ignoring the turn's possibly aborted signal.
   * @param sessionId - Canonical session whose current lease must be released.
   * @param turnSignal - Original turn signal, accepted only to make its non-use explicit.
   */
  async turnStopping(sessionId: SessionId, turnSignal: AbortSignal): Promise<void> {
    void turnSignal
    const lease = this.leaseCache.take(sessionId)
    if (lease !== undefined) this.enqueueRelease(sessionId, lease)
    await this.flush(sessionId)
  }

  /**
   * Synchronously invalidate and enqueue the fire-and-forget turn/end fallback.
   * @param sessionId - Canonical session observed in the committed turn event.
   */
  observeTurnEnd(sessionId: SessionId): void {
    const lease = this.leaseCache.take(sessionId)
    if (lease !== undefined) this.enqueueRelease(sessionId, lease)
  }

  /**
   * Drain the exact session's idempotent cleanup tail at the awaited flush barrier.
   * @param sessionId - Canonical session whose queued cleanup must settle.
   */
  async flush(sessionId: SessionId): Promise<void> {
    await this.tails.get(sessionId)
  }

  /**
   * Synchronously invalidate, then queue release followed by one session revoke.
   * @param sessionId - Canonical session being disposed.
   */
  disposeSession(sessionId: SessionId): void {
    if (this.disposedSessions.has(sessionId)) return
    this.disposedSessions.add(sessionId)
    const lease = this.leaseCache.take(sessionId)
    if (lease !== undefined) this.enqueueRelease(sessionId, lease)
    this.enqueue(sessionId, async () => { await this.requester.revokeSession(sessionId) })
  }

  /** Drain all release/revoke tails before the plugin removes its listeners. */
  async dispose(): Promise<void> {
    await Promise.all([...this.tails.values()])
  }

  private enqueueRelease(sessionId: SessionId, lease: ControlLeaseAcquireResult): void {
    this.enqueue(sessionId, async () => {
      const nowUnixMs = this.now()
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort(new Error('Desktop control cleanup deadline expired.'))
      }, this.cleanupTimeoutMs)
      timer.unref()
      try {
        const envelope = await this.requester.request({
          protocolVersion: 1,
          messageKind: 'request',
          requestKind: 'control.lease.release',
          requestId: this.requestId(),
          sessionId,
          deadlineUnixMs: nowUnixMs + Math.min(this.cleanupTimeoutMs, PROTOCOL_LIMITS.maxDeadlineAheadMs),
          leaseId: lease.leaseId,
          leaseRevision: lease.leaseRevision,
        }, controller.signal)
        const message = envelope.message
        if (message.messageKind !== 'response'
          || message.responseKind !== 'ok'
          || message.requestKind !== 'control.lease.release') {
          throw new DesktopControlIpcError('INTERNAL', 'Desktop control release acknowledgement is invalid.')
        }
      } finally {
        clearTimeout(timer)
      }
    })
  }

  private enqueue(sessionId: SessionId, task: () => Promise<void>): void {
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const operation = previous.then(task, task).catch(() => undefined)
    this.tails.set(sessionId, operation)
    void operation.finally(() => {
      if (this.tails.get(sessionId) === operation) this.tails.delete(sessionId)
    })
  }
}
