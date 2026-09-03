/** Browser notification state and authenticated streaming-fetch transport. */

import type { MessageId, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { MAX_ACK_BODY_BYTES, MAX_ACK_DELIVERY_IDS } from '../protocol.ts'

/** Browser-safe receipt metadata. No message body or reply capability exists here. */
export interface NotificationReceipt {
  readonly deliveryId: string
  readonly sourceSessionId: SessionId
  readonly targetSessionId: SessionId
  readonly messageId: MessageId
  readonly status:
    | 'prepared'
    | 'delivery-recovery-pending'
    | 'delivered'
    | 'claimed'
    | 'replied'
    | 'discarded'
    | 'failed'
    | 'aborted'
    | 'rejected'
    | 'expired'
  readonly wakeRequested: boolean
  readonly updatedAt: number
  readonly acknowledged: boolean
  readonly replyToDeliveryId?: string
  readonly continuationOfDeliveryId?: string
  readonly collaborationStoppedAt?: number
  readonly errorCode?: string
}

/** Authoritative metadata response. */
export interface MessengerSnapshot {
  readonly lastEventId: number
  readonly receipts: readonly NotificationReceipt[]
}

/** One replay/live stream event. */
export type MessengerEvent =
  | { readonly id: number; readonly kind: 'receipt'; readonly receipt: NotificationReceipt }
  | {
    readonly id: number
    readonly kind: 'ack'
    readonly sessionId: SessionId
    readonly deliveryIds: readonly string[]
  }
  | { readonly id: number; readonly kind: 'remove'; readonly deliveryId: string }

/** Index-injected same-origin route facts. */
export interface SessionMessengerBootstrap {
  readonly snapshotPath: string
  readonly ackPath: string
  readonly eventsPath: string
  readonly sendPath: string
  readonly replyPath: string
  readonly stopPath: string
  readonly capabilityHeader: string
  readonly capability: string
}

declare global {
  interface Window {
    __DSH_SESSION_MESSENGER__?: SessionMessengerBootstrap
  }
}

/** Injectable transport face used by the store and browser tests. */
export interface MessengerTransport {
  snapshot(signal: AbortSignal): Promise<MessengerSnapshot>
  events(
    afterId: number,
    listener: (event: MessengerEvent) => void,
    signal: AbortSignal,
  ): Promise<void>
  acknowledge(
    sessionId: SessionId,
    deliveryIds: readonly string[],
    signal: AbortSignal,
  ): Promise<number>
  send?(
    sourceSessionId: SessionId,
    targetSessionId: SessionId,
    message: string,
    wake: boolean,
    signal: AbortSignal,
  ): Promise<MessengerDeliveryResult>
  reply?(
    sourceSessionId: SessionId,
    deliveryId: string,
    message: string,
    wake: boolean,
    signal: AbortSignal,
  ): Promise<MessengerDeliveryResult>
  stop?(
    sourceSessionId: SessionId,
    deliveryId: string,
    signal: AbortSignal,
  ): Promise<MessengerStopResult>
}

/** Browser-safe result returned by both operator routes. */
export interface MessengerDeliveryResult {
  readonly deliveryId: string
  readonly messageId: string
  readonly status: 'delivered' | 'delivery-recovery-pending'
  readonly wakeRequested: boolean
}

/** Browser-safe result returned by the stop route. */
export interface MessengerStopResult {
  readonly deliveryId: string
  readonly rootDeliveryId: string
  readonly status: 'stopped'
  readonly stoppedAt: number
}

/** Immutable external-store snapshot. */
export interface MessengerStoreSnapshot {
  readonly phase: 'idle' | 'connecting' | 'connected' | 'error'
  readonly lastEventId: number
  readonly receipts: ReadonlyMap<string, NotificationReceipt>
  readonly connectionError: string | null
}

const RECEIPT_STATUSES = new Set<NotificationReceipt['status']>([
  'prepared',
  'delivery-recovery-pending',
  'delivered',
  'claimed',
  'replied',
  'discarded',
  'failed',
  'aborted',
  'rejected',
  'expired',
])

const MAX_STREAM_FRAME_BYTES = 64 * 1024
const RECONNECT_DELAY_MS = 1_000

function reconnectDelay(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, RECONNECT_DELAY_MS)
    signal.addEventListener('abort', finish, { once: true })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeString(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

/** Apply the already-validated wire brand without pulling Host runtime code into the Client bundle. */
function sessionIdOf(value: string): SessionId {
  return value as SessionId
}

function parseReceipt(value: unknown): NotificationReceipt | undefined {
  if (!isRecord(value)
    || !safeString(value.deliveryId)
    || !safeString(value.sourceSessionId)
    || !safeString(value.targetSessionId)
    || !safeString(value.messageId)
    || typeof value.status !== 'string'
    || !RECEIPT_STATUSES.has(value.status as NotificationReceipt['status'])
    || typeof value.wakeRequested !== 'boolean'
    || !Number.isSafeInteger(value.updatedAt)
    || Number(value.updatedAt) < 0
    || typeof value.acknowledged !== 'boolean'
    || (value.replyToDeliveryId !== undefined && !safeString(value.replyToDeliveryId))
    || (value.continuationOfDeliveryId !== undefined && !safeString(value.continuationOfDeliveryId))
    || (value.collaborationStoppedAt !== undefined
      && (!Number.isSafeInteger(value.collaborationStoppedAt) || Number(value.collaborationStoppedAt) < 0))
    || (value.errorCode !== undefined && !safeString(value.errorCode, 128))) return undefined

  return {
    deliveryId: value.deliveryId,
    sourceSessionId: value.sourceSessionId as SessionId,
    targetSessionId: value.targetSessionId as SessionId,
    messageId: value.messageId as MessageId,
    status: value.status as NotificationReceipt['status'],
    wakeRequested: value.wakeRequested,
    updatedAt: Number(value.updatedAt),
    acknowledged: value.acknowledged,
    ...(value.replyToDeliveryId === undefined ? {} : { replyToDeliveryId: value.replyToDeliveryId }),
    ...(value.continuationOfDeliveryId === undefined ? {} : { continuationOfDeliveryId: value.continuationOfDeliveryId }),
    ...(value.collaborationStoppedAt === undefined ? {} : { collaborationStoppedAt: Number(value.collaborationStoppedAt) }),
    ...(value.errorCode === undefined ? {} : { errorCode: value.errorCode }),
  }
}

function parseSnapshot(value: unknown): MessengerSnapshot {
  if (!isRecord(value) || typeof value.lastEventId !== 'number'
    || !Number.isSafeInteger(value.lastEventId) || value.lastEventId < 0
    || !Array.isArray(value.receipts)) throw new Error('invalid messenger snapshot')
  const receipts = value.receipts.map(parseReceipt)
  if (receipts.some(receipt => receipt === undefined)) throw new Error('invalid messenger receipt metadata')
  return { lastEventId: value.lastEventId, receipts: receipts.filter(receipt => receipt !== undefined) }
}

function parseEvent(value: unknown, frameId: number, frameKind: string | undefined): MessengerEvent {
  if (!isRecord(value)
    || value.id !== frameId
    || value.kind !== frameKind
    || typeof value.id !== 'number'
    || !Number.isSafeInteger(value.id)
    || value.id < 1) throw new Error('invalid messenger event envelope')
  if (value.kind === 'receipt') {
    const receipt = parseReceipt(value.receipt)
    if (receipt === undefined) throw new Error('invalid messenger receipt event')
    return { id: value.id, kind: 'receipt', receipt }
  }
  if (value.kind === 'ack'
    && safeString(value.sessionId)
    && Array.isArray(value.deliveryIds)
    && value.deliveryIds.every(item => safeString(item))) {
    return {
      id: value.id,
      kind: 'ack',
      sessionId: sessionIdOf(value.sessionId),
      deliveryIds: value.deliveryIds,
    }
  }
  if (value.kind === 'remove' && safeString(value.deliveryId)) {
    return { id: value.id, kind: 'remove', deliveryId: value.deliveryId }
  }
  throw new Error('invalid messenger event')
}

function acknowledgementBody(sessionId: SessionId, deliveryIds: readonly string[]): string {
  return JSON.stringify({ sessionId, deliveryIds })
}

function acknowledgementBatches(
  sessionId: SessionId,
  deliveryIds: readonly string[],
): readonly (readonly string[])[] {
  const batches: string[][] = []
  let current: string[] = []
  for (const deliveryId of deliveryIds) {
    const candidate = [...current, deliveryId]
    const fits = candidate.length <= MAX_ACK_DELIVERY_IDS
      && new TextEncoder().encode(acknowledgementBody(sessionId, candidate)).byteLength
        <= MAX_ACK_BODY_BYTES
    if (fits) {
      current = candidate
      continue
    }
    if (current.length === 0) throw new Error('session messenger acknowledgement item exceeded limit')
    batches.push(current)
    current = [deliveryId]
    if (new TextEncoder().encode(acknowledgementBody(sessionId, current)).byteLength
      > MAX_ACK_BODY_BYTES) {
      throw new Error('session messenger acknowledgement item exceeded limit')
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function checkedBootstrap(value: SessionMessengerBootstrap): SessionMessengerBootstrap {
  for (const candidate of [
    value.snapshotPath,
    value.ackPath,
    value.eventsPath,
    value.sendPath,
    value.replyPath,
    value.stopPath,
    value.capabilityHeader,
    value.capability,
  ]) {
    if (!safeString(candidate, 512)) throw new Error('invalid session messenger bootstrap')
  }
  return value
}

/**
 * Read the immutable page-generation bootstrap, when the Host half is mounted.
 * @returns validated same-origin transport facts, or undefined outside a mounted browser generation.
 */
export function readSessionMessengerBootstrap(): SessionMessengerBootstrap | undefined {
  if (typeof window === 'undefined' || window.__DSH_SESSION_MESSENGER__ === undefined) return undefined
  return checkedBootstrap(window.__DSH_SESSION_MESSENGER__)
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${label} failed (${String(response.status)})`)
  return response.json() as Promise<unknown>
}

async function deliveryResponse(response: Response, label: string): Promise<MessengerDeliveryResult> {
  let value: unknown
  try {
    value = await response.json() as unknown
  } catch {
    throw new Error(`${label} failed (${String(response.status)})`)
  }
  if (!response.ok) {
    if (isRecord(value) && safeString(value.errorCode, 128)) throw new Error(value.errorCode)
    throw new Error(`${label} failed (${String(response.status)})`)
  }
  if (!isRecord(value)
    || !safeString(value.deliveryId)
    || !safeString(value.messageId)
    || (value.status !== 'delivered' && value.status !== 'delivery-recovery-pending')
    || typeof value.wakeRequested !== 'boolean') throw new Error(`invalid ${label} response`)
  return {
    deliveryId: value.deliveryId,
    messageId: value.messageId,
    status: value.status,
    wakeRequested: value.wakeRequested,
  }
}

/** Parse metadata SSE frames from a bounded streaming-fetch body. */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  listener: (event: MessengerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      // Normalize after concatenation so a CR/LF pair split across chunks is
      // treated exactly like one arriving in a single read.
      buffer = buffer.replaceAll('\r\n', '\n')
      if (new TextEncoder().encode(buffer).byteLength > MAX_STREAM_FRAME_BYTES) {
        throw new Error('messenger event frame exceeded limit')
      }
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
        if (block === '' || block.startsWith(':') || block.startsWith('retry:')) continue
        let id: number | undefined
        let kind: string | undefined
        const data: string[] = []
        for (const line of block.split('\n')) {
          if (line.startsWith('id:')) id = Number(line.slice(3).trim())
          else if (line.startsWith('event:')) kind = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
        }
        if (!Number.isSafeInteger(id) || id === undefined || id < 1 || data.length === 0) {
          throw new Error('invalid messenger event frame')
        }
        listener(parseEvent(JSON.parse(data.join('\n')) as unknown, id, kind))
      }
      if (chunk.done) break
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Build the POST-only same-origin transport; the capability never enters a URL.
 * @param rawBootstrap - index-injected route and capability facts to validate.
 * @param fetcher - fetch implementation used for authenticated same-origin requests.
 * @returns a transport for snapshots, event streams, and acknowledgements.
 */
export function createHttpMessengerTransport(
  rawBootstrap: SessionMessengerBootstrap,
  fetcher: typeof fetch = fetch,
): MessengerTransport {
  const bootstrap = checkedBootstrap(rawBootstrap)
  const capabilityHeaders = { [bootstrap.capabilityHeader]: bootstrap.capability }
  return {
    async snapshot(signal): Promise<MessengerSnapshot> {
      const response = await fetcher(bootstrap.snapshotPath, {
        method: 'POST',
        headers: capabilityHeaders,
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      })
      return parseSnapshot(await responseJson(response, 'session messenger snapshot'))
    },
    async events(afterId, listener, signal): Promise<void> {
      const response = await fetcher(bootstrap.eventsPath, {
        method: 'POST',
        headers: {
          ...capabilityHeaders,
          accept: 'text/event-stream',
          'last-event-id': String(afterId),
        },
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      })
      if (!response.ok) throw new Error(`session messenger events failed (${String(response.status)})`)
      if (response.body === null) throw new Error('session messenger event stream is unavailable')
      await readEventStream(response.body, listener, signal)
    },
    async acknowledge(sessionId, deliveryIds, signal): Promise<number> {
      const response = await fetcher(bootstrap.ackPath, {
        method: 'POST',
        headers: { ...capabilityHeaders, 'content-type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: acknowledgementBody(sessionId, deliveryIds),
        signal,
      })
      const value = await responseJson(response, 'session messenger acknowledgement')
      if (!isRecord(value) || !Number.isSafeInteger(value.acknowledged) || Number(value.acknowledged) < 0) {
        throw new Error('invalid messenger acknowledgement response')
      }
      return Number(value.acknowledged)
    },
    async send(sourceSessionId, targetSessionId, message, wake, signal) {
      const response = await fetcher(bootstrap.sendPath, {
        method: 'POST',
        headers: { ...capabilityHeaders, 'content-type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ sourceSessionId, targetSessionId, message, wake }),
        signal,
      })
      return deliveryResponse(response, 'session messenger send')
    },
    async reply(sourceSessionId, deliveryId, message, wake, signal) {
      const response = await fetcher(bootstrap.replyPath, {
        method: 'POST',
        headers: { ...capabilityHeaders, 'content-type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ sourceSessionId, deliveryId, message, wake }),
        signal,
      })
      return deliveryResponse(response, 'session messenger reply')
    },
    async stop(sourceSessionId, deliveryId, signal) {
      const response = await fetcher(bootstrap.stopPath, {
        method: 'POST',
        headers: { ...capabilityHeaders, 'content-type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ sourceSessionId, deliveryId }),
        signal,
      })
      const value = await responseJson(response, 'session messenger stop')
      if (!isRecord(value) || !safeString(value.deliveryId) || !safeString(value.rootDeliveryId)
        || value.status !== 'stopped' || !Number.isSafeInteger(value.stoppedAt)) {
        throw new Error('invalid session messenger stop response')
      }
      return {
        deliveryId: value.deliveryId,
        rootDeliveryId: value.rootDeliveryId,
        status: 'stopped',
        stoppedAt: Number(value.stoppedAt),
      }
    },
  }
}

function unavailableTransport(): MessengerTransport {
  const unavailable = (): Error => new Error('session messenger Host bridge is unavailable')
  return {
    snapshot: () => Promise.reject(unavailable()),
    events: () => Promise.reject(unavailable()),
    acknowledge: () => Promise.reject(unavailable()),
  }
}

/** Small immutable external store fed by authoritative snapshots and monotonic events. */
export class MessengerStore {
  private state: MessengerStoreSnapshot = {
    phase: 'idle',
    lastEventId: 0,
    receipts: new Map(),
    connectionError: null,
  }
  private readonly listeners = new Set<() => void>()
  private readonly lifetimeController = new AbortController()
  private readonly acknowledgementTasks = new Set<Promise<number>>()
  private readonly operatorTasks = new Set<Promise<unknown>>()
  private active: {
    readonly controller: AbortController
    readonly done: Promise<void>
    readonly stop: () => Promise<void>
  } | undefined
  private disposed = false
  private disposalTask: Promise<void> | undefined

  constructor(private readonly transport: MessengerTransport = unavailableTransport()) {}

  /**
   * Read the current external-store state without mutation.
   * @returns the current immutable external-store snapshot.
   */
  readonly getSnapshot: () => MessengerStoreSnapshot = () => this.state

  /**
   * Subscribe to immutable snapshot replacements.
   * @param listener - callback invoked after each published state change.
   * @returns a disposer that removes the callback.
   */
  readonly subscribe: (listener: () => void) => (() => void) = (listener) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Replace all metadata from one cursor-paired Host snapshot.
   * @param snapshot - authoritative receipt metadata and matching event cursor.
   */
  replaceSnapshot(snapshot: MessengerSnapshot): void {
    this.publish({
      phase: 'connected',
      lastEventId: snapshot.lastEventId,
      receipts: new Map(snapshot.receipts.map(receipt => [receipt.deliveryId, receipt])),
      connectionError: null,
    })
  }

  /**
   * Apply only a newer monotonic stream event.
   * @param event - next contiguous event from the authenticated Host stream.
   */
  accept(event: MessengerEvent): void {
    if (event.id <= this.state.lastEventId) return
    if (event.id !== this.state.lastEventId + 1) {
      throw new Error('session messenger event cursor gap')
    }
    const receipts = new Map(this.state.receipts)
    if (event.kind === 'receipt') {
      receipts.set(event.receipt.deliveryId, event.receipt)
    } else if (event.kind === 'remove') {
      receipts.delete(event.deliveryId)
    } else {
      for (const deliveryId of event.deliveryIds) {
        const current = receipts.get(deliveryId)
        if (current?.targetSessionId === event.sessionId) {
          receipts.set(deliveryId, { ...current, acknowledged: true })
        }
      }
    }
    this.publish({ ...this.state, phase: 'connected', lastEventId: event.id, receipts })
  }

  /**
   * Ack current reply notices after the Host accepts the request; keep metadata locally.
   * @param sessionId - ordinary session whose addressed reply notices are being read.
   * @param deliveryIds - exact delivery identities to acknowledge.
   * @returns the number of notices acknowledged by the Host.
   */
  acknowledge(sessionId: SessionId, deliveryIds: readonly string[]): Promise<number> {
    const task = this.acknowledgeNow(sessionId, deliveryIds)
    this.acknowledgementTasks.add(task)
    const forget = (): void => { this.acknowledgementTasks.delete(task) }
    void task.then(forget, forget)
    return task
  }

  private async acknowledgeNow(sessionId: SessionId, deliveryIds: readonly string[]): Promise<number> {
    const signal = this.lifetimeController.signal
    signal.throwIfAborted()
    let total = 0
    for (const batch of acknowledgementBatches(sessionId, deliveryIds)) {
      const count = await this.transport.acknowledge(sessionId, batch, signal)
      signal.throwIfAborted()
      if (count !== batch.length) {
        throw new Error('session messenger acknowledgement mismatch')
      }
      const receipts = new Map(this.state.receipts)
      for (const deliveryId of batch) {
        const current = receipts.get(deliveryId)
        if (current?.targetSessionId === sessionId) {
          receipts.set(deliveryId, { ...current, acknowledged: true })
        }
      }
      this.publish({ ...this.state, receipts, connectionError: null })
      total += count
    }
    return total
  }

  /**
   * Send from the currently displayed ordinary session through the Host authority boundary.
   * @param sourceSessionId - displayed ordinary session authorizing the request.
   * @param targetSessionId - exact copied ordinary target Session ID.
   * @param message - operator-authored bounded message body.
   * @param wake - whether the delivery should begin the target's next turn.
   * @returns the durable delivery identity and immediate enqueue status.
   */
  send(sourceSessionId: SessionId, targetSessionId: SessionId, message: string, wake: boolean): Promise<MessengerDeliveryResult> {
    if (this.transport.send === undefined) return Promise.reject(new Error('session messenger Host bridge is unavailable'))
    return this.trackOperator(this.transport.send(
      sourceSessionId, targetSessionId, message, wake, this.lifetimeController.signal,
    ))
  }

  /**
   * Reply once to a durable delivery without exposing its retained reply token.
   * @param sourceSessionId - displayed ordinary session authorizing the reply.
   * @param deliveryId - exact durable delivery identity being answered.
   * @param message - operator-authored bounded reply body.
   * @param wake - whether the reverse delivery should wake its target.
   * @returns the reverse delivery identity and immediate enqueue status.
   */
  reply(sourceSessionId: SessionId, deliveryId: string, message: string, wake: boolean): Promise<MessengerDeliveryResult> {
    if (this.transport.reply === undefined) return Promise.reject(new Error('session messenger Host bridge is unavailable'))
    return this.trackOperator(this.transport.reply(
      sourceSessionId, deliveryId, message, wake, this.lifetimeController.signal,
    ))
  }

  /**
   * Stop the chain containing one displayed outgoing delivery.
   * @param sourceSessionId - displayed ordinary session authorizing the stop.
   * @param deliveryId - exact durable delivery identity anchoring the chain.
   * @returns the durable stop result for the whole collaboration chain.
   */
  stop(sourceSessionId: SessionId, deliveryId: string): Promise<MessengerStopResult> {
    if (this.transport.stop === undefined) return Promise.reject(new Error('session messenger Host bridge is unavailable'))
    const task = this.transport.stop(sourceSessionId, deliveryId, this.lifetimeController.signal)
    this.operatorTasks.add(task)
    const forget = (): void => { this.operatorTasks.delete(task) }
    void task.then(forget, forget)
    return task
  }

  private trackOperator(task: Promise<MessengerDeliveryResult>): Promise<MessengerDeliveryResult> {
    this.operatorTasks.add(task)
    const forget = (): void => { this.operatorTasks.delete(task) }
    void task.then(forget, forget)
    return task
  }

  /**
   * Start snapshot-first reconnect cycles after the previous generation reaches quiescence.
   * @returns an asynchronous disposer for this connection generation.
   */
  async start(): Promise<() => Promise<void>> {
    if (this.hasBeenDisposed()) return () => Promise.resolve()
    await this.active?.stop()
    if (this.hasBeenDisposed()) return () => Promise.resolve()
    const controller = new AbortController()
    this.publish({ ...this.state, phase: 'connecting', connectionError: null })
    const done = this.run(controller)
    let stopping = false
    const stop = async (): Promise<void> => {
      if (!stopping) {
        stopping = true
        controller.abort()
      }
      await done
      if (this.active?.controller === controller) this.active = undefined
    }
    this.active = { controller, done, stop }
    return stop
  }

  private async run(controller: AbortController): Promise<void> {
    const signal = controller.signal
    const active = (): boolean => !this.disposed && !signal.aborted
    while (active()) {
      try {
        const snapshot = await this.transport.snapshot(signal)
        if (!active()) return
        this.replaceSnapshot(snapshot)
        await this.transport.events(snapshot.lastEventId, (event) => {
          if (active()) this.accept(event)
        }, signal)
      } catch (error: unknown) {
        if (!active()) return
        this.publish({
          ...this.state,
          phase: 'error',
          connectionError: error instanceof Error ? error.message : String(error),
        })
      }
      if (active()) await reconnectDelay(signal)
    }
  }

  /** Abort and join every admitted network operation; safe and idempotent. */
  dispose(): Promise<void> {
    if (this.disposalTask !== undefined) return this.disposalTask
    this.disposed = true
    this.listeners.clear()
    this.lifetimeController.abort()
    const active = this.active
    return this.disposalTask = (async () => {
      await active?.stop()
      await Promise.allSettled([...this.acknowledgementTasks, ...this.operatorTasks])
    })()
  }

  private publish(next: MessengerStoreSnapshot): void {
    if (this.disposed) return
    this.state = next
    for (const listener of [...this.listeners]) listener()
  }

  private hasBeenDisposed(): boolean {
    return this.disposed
  }
}

/**
 * Compute the current-session aggregate used by the compact footer entry.
 * @param snapshot - immutable notification-store snapshot to summarize.
 * @param sessionId - active ordinary session, when one is open.
 * @returns pending and unread counts, unread identities, and the latest error code.
 */
export function summarizeMessenger(
  snapshot: MessengerStoreSnapshot,
  sessionId: SessionId | undefined,
): {
  pending: number
  unread: number
  unreadDeliveryIds: string[]
  latestError: string | null
} {
  if (sessionId === undefined) {
    return { pending: 0, unread: 0, unreadDeliveryIds: [], latestError: null }
  }
  let pending = 0
  const unreadDeliveryIds: string[] = []
  let latestError: NotificationReceipt | undefined
  for (const receipt of snapshot.receipts.values()) {
    if (receipt.sourceSessionId === sessionId
      && ['prepared', 'delivery-recovery-pending', 'delivered', 'claimed'].includes(receipt.status)) {
      pending += 1
    }
    if (receipt.targetSessionId === sessionId
      && receipt.replyToDeliveryId !== undefined
      && !receipt.acknowledged
      && (receipt.status === 'delivered' || receipt.status === 'claimed')) {
      unreadDeliveryIds.push(receipt.deliveryId)
    }
    if (receipt.sourceSessionId === sessionId && receipt.errorCode !== undefined
      && (latestError === undefined || receipt.updatedAt >= latestError.updatedAt)) latestError = receipt
  }
  return {
    pending,
    unread: unreadDeliveryIds.length,
    unreadDeliveryIds,
    latestError: latestError?.errorCode ?? null,
  }
}
