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
  snapshot(): Promise<MessengerSnapshot>
  events(
    afterId: number,
    listener: (event: MessengerEvent) => void,
    signal: AbortSignal,
  ): Promise<void>
  acknowledge(sessionId: SessionId, deliveryIds: readonly string[]): Promise<number>
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
    value.capabilityHeader,
    value.capability,
  ]) {
    if (!safeString(candidate, 512)) throw new Error('invalid session messenger bootstrap')
  }
  return value
}

/** Read the immutable page-generation bootstrap, when the Host half is mounted. */
export function readSessionMessengerBootstrap(): SessionMessengerBootstrap | undefined {
  if (typeof window === 'undefined' || window.__DSH_SESSION_MESSENGER__ === undefined) return undefined
  return checkedBootstrap(window.__DSH_SESSION_MESSENGER__)
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${label} failed (${String(response.status)})`)
  return response.json() as Promise<unknown>
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

/** Build the POST-only same-origin transport; the capability never enters a URL. */
export function createHttpMessengerTransport(
  rawBootstrap: SessionMessengerBootstrap,
  fetcher: typeof fetch = fetch,
): MessengerTransport {
  const bootstrap = checkedBootstrap(rawBootstrap)
  const capabilityHeaders = { [bootstrap.capabilityHeader]: bootstrap.capability }
  return {
    async snapshot(): Promise<MessengerSnapshot> {
      const response = await fetcher(bootstrap.snapshotPath, {
        method: 'POST',
        headers: capabilityHeaders,
        credentials: 'same-origin',
        cache: 'no-store',
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
    async acknowledge(sessionId, deliveryIds): Promise<number> {
      const response = await fetcher(bootstrap.ackPath, {
        method: 'POST',
        headers: { ...capabilityHeaders, 'content-type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: acknowledgementBody(sessionId, deliveryIds),
      })
      const value = await responseJson(response, 'session messenger acknowledgement')
      if (!isRecord(value) || !Number.isSafeInteger(value.acknowledged) || Number(value.acknowledged) < 0) {
        throw new Error('invalid messenger acknowledgement response')
      }
      return Number(value.acknowledged)
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
  private stopActive: (() => void) | undefined

  constructor(private readonly transport: MessengerTransport = unavailableTransport()) {}

  readonly getSnapshot = (): MessengerStoreSnapshot => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Replace all metadata from one cursor-paired Host snapshot. */
  replaceSnapshot(snapshot: MessengerSnapshot): void {
    this.publish({
      phase: 'connected',
      lastEventId: snapshot.lastEventId,
      receipts: new Map(snapshot.receipts.map(receipt => [receipt.deliveryId, receipt])),
      connectionError: null,
    })
  }

  /** Apply only a newer monotonic stream event. */
  accept(event: MessengerEvent): void {
    if (event.id <= this.state.lastEventId) return
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

  /** Ack current reply notices after the Host accepts the request; keep metadata locally. */
  async acknowledge(sessionId: SessionId, deliveryIds: readonly string[]): Promise<number> {
    let total = 0
    for (const batch of acknowledgementBatches(sessionId, deliveryIds)) {
      const count = await this.transport.acknowledge(sessionId, batch)
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

  /** Start snapshot-first reconnect cycles; returns an idempotent abort disposer. */
  start(): () => void {
    this.stopActive?.()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const active = (): boolean => !controller.signal.aborted
    const stop = (): void => {
      if (!active()) return
      controller.abort()
      if (timer !== undefined) clearTimeout(timer)
      if (this.stopActive === stop) this.stopActive = undefined
    }
    this.stopActive = stop
    this.publish({ ...this.state, phase: 'connecting', connectionError: null })

    const cycle = async (): Promise<void> => {
      if (!active()) return
      try {
        const snapshot = await this.transport.snapshot()
        if (!active()) return
        this.replaceSnapshot(snapshot)
        await this.transport.events(snapshot.lastEventId, (event) => { this.accept(event) }, controller.signal)
      } catch (error: unknown) {
        if (!active()) return
        this.publish({
          ...this.state,
          phase: 'error',
          connectionError: error instanceof Error ? error.message : String(error),
        })
      }
      if (active()) timer = setTimeout(() => { void cycle() }, RECONNECT_DELAY_MS)
    }
    void cycle()
    return stop
  }

  /** Stop network work and release subscribers. */
  dispose(): void {
    this.stopActive?.()
    this.listeners.clear()
  }

  private publish(next: MessengerStoreSnapshot): void {
    this.state = next
    for (const listener of [...this.listeners]) listener()
  }
}

/** Current-session aggregate used by the compact footer entry. */
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
