/** Metadata-only receipt projection and bounded replay journal for browser notices. */

import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { DeliveryId, Receipt, ReceiptTransition } from './types.ts'

/** Maximum metadata events retained for reconnect replay. */
export const EVENT_RING_SIZE = 256
/** Maximum concurrently open browser streams for one plugin generation. */
export const MAX_EVENT_CLIENTS = 8

/** Structural coordinator face consumed by the notification surface. */
export interface ReceiptEventSource {
  receiptEntries(): Array<[DeliveryId, Receipt]>
  subscribe(listener: ReceiptTransitionListener): () => void
}

/** Receipt transition callback shared with the coordinator. */
export type ReceiptTransitionListener = (transition: ReceiptTransition) => void

/** Browser-safe receipt metadata. Bodies and reply authority never cross this boundary. */
export interface NotificationReceipt {
  readonly deliveryId: DeliveryId
  readonly sourceSessionId: SessionId
  readonly targetSessionId: SessionId
  readonly messageId: MessageId
  readonly status: Receipt['status']
  readonly wakeRequested: boolean
  readonly updatedAt: number
  readonly acknowledged: boolean
  readonly replyToDeliveryId?: DeliveryId
  readonly continuationOfDeliveryId?: DeliveryId
  readonly collaborationStoppedAt?: number
  readonly errorCode?: string
}

/** One monotonic journal event; every variant contains metadata only. */
export type NotificationEvent =
  | {
    readonly id: number
    readonly kind: 'receipt'
    readonly receipt: NotificationReceipt
  }
  | {
    readonly id: number
    readonly kind: 'ack'
    readonly sessionId: SessionId
    readonly deliveryIds: readonly DeliveryId[]
  }
  | {
    readonly id: number
    readonly kind: 'remove'
    readonly deliveryId: DeliveryId
  }

/** Authoritative current projection returned before each stream connection. */
export interface NotificationSnapshot {
  readonly lastEventId: number
  readonly receipts: readonly NotificationReceipt[]
}

/**
 * Convert a durable receipt into the deliberately narrow browser shape.
 * @param receipt - authoritative durable receipt to project.
 * @param acknowledged - whether the addressed browser notice was marked read.
 * @returns metadata safe to expose to the same-origin Client surface.
 */
export function notificationReceiptOf(
  receipt: Receipt,
  acknowledged: boolean,
): NotificationReceipt {
  return {
    deliveryId: receipt.id,
    sourceSessionId: receipt.sourceSessionId,
    targetSessionId: receipt.targetSessionId,
    messageId: receipt.messageId,
    status: receipt.status,
    wakeRequested: receipt.wakeRequested,
    updatedAt: receipt.updatedAt,
    acknowledged,
    ...(receipt.replyToDeliveryId === undefined
      ? {}
      : { replyToDeliveryId: receipt.replyToDeliveryId }),
    ...(receipt.continuationOfDeliveryId === undefined
      ? {}
      : { continuationOfDeliveryId: receipt.continuationOfDeliveryId }),
    ...(receipt.collaborationStoppedAt === undefined
      ? {}
      : { collaborationStoppedAt: receipt.collaborationStoppedAt }),
    ...('errorCode' in receipt ? { errorCode: receipt.errorCode } : {}),
  }
}

/**
 * Owns process-generation notification state. Acknowledgement marks a local
 * notice read; it never mutates or deletes the coordinator's durable receipt.
 */
export class SessionMessengerEventHub {
  private readonly receipts = new Map<DeliveryId, NotificationReceipt>()
  private readonly acknowledged = new Map<SessionId, Set<DeliveryId>>()
  private readonly ring: NotificationEvent[] = []
  private readonly listeners = new Set<(event: NotificationEvent) => void>()
  private readonly unsubscribe: () => void
  private lastEventId = 0
  private disposed = false

  constructor(source: ReceiptEventSource) {
    for (const [id, receipt] of source.receiptEntries()) {
      this.receipts.set(id, notificationReceiptOf(receipt, false))
    }
    this.unsubscribe = source.subscribe((transition) => { this.recordTransition(transition) })
  }

  /**
   * Read the complete metadata view paired with the journal cursor.
   * @returns a sorted authoritative projection and its latest event identity.
   */
  snapshot(): NotificationSnapshot {
    const receipts = [...this.receipts.values()]
      .sort((left, right) => left.updatedAt - right.updatedAt
        || left.deliveryId.localeCompare(right.deliveryId))
    return { lastEventId: this.lastEventId, receipts }
  }

  /**
   * Test whether the bounded ring still covers every event newer than a cursor.
   * @param lastSeenId - last event identity accepted by the reconnecting Client.
   * @returns true when gap-free replay is still possible.
   */
  canReplayAfter(lastSeenId: number): boolean {
    const oldest = this.ring[0]
    return oldest === undefined || lastSeenId >= oldest.id - 1
  }

  /**
   * Mark only receipt-bound replies addressed to the claimed session as read.
   * Returns the number newly acknowledged; receipt storage remains untouched.
   * @param sessionId - ordinary target session claiming these notices.
   * @param deliveryIds - exact delivery identities requested by the Client.
   * @returns the number of newly acknowledged reply notices.
   */
  acknowledge(sessionId: SessionId, deliveryIds: readonly DeliveryId[]): number {
    if (this.disposed) return 0
    const bucket = this.acknowledged.get(sessionId) ?? new Set<DeliveryId>()
    const accepted: DeliveryId[] = []
    for (const deliveryId of deliveryIds) {
      const receipt = this.receipts.get(deliveryId)
      if (receipt?.targetSessionId !== sessionId || receipt.replyToDeliveryId === undefined) continue
      if (bucket.has(deliveryId)) continue
      bucket.add(deliveryId)
      this.receipts.set(deliveryId, { ...receipt, acknowledged: true })
      accepted.push(deliveryId)
    }
    if (accepted.length === 0) return 0
    this.acknowledged.set(sessionId, bucket)
    this.publish({
      id: this.nextId(),
      kind: 'ack',
      sessionId,
      deliveryIds: accepted,
    })
    return accepted.length
  }

  /**
   * Replay newer journal entries, then subscribe to live transitions without a gap.
   * @param lastSeenId - last event identity already accepted by the Client.
   * @param listener - callback receiving replayed and subsequent live events.
   * @returns a disposer that removes the live callback.
   */
  subscribeAfter(
    lastSeenId: number,
    listener: (event: NotificationEvent) => void,
  ): () => void {
    if (this.disposed) return () => {}
    for (const event of this.ring) {
      if (event.id > lastSeenId) listener(event)
    }
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Stop source observation and every live stream listener. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.listeners.clear()
  }

  private recordTransition(transition: ReceiptTransition): void {
    if (transition.kind === 'delete') {
      this.recordRemoval(transition.deliveryId)
      return
    }
    this.recordReceipt(transition.receipt)
  }

  private recordReceipt(receipt: Receipt): void {
    if (this.disposed) return
    const metadata = notificationReceiptOf(receipt, this.isAcknowledged(
      receipt.targetSessionId,
      receipt.id,
    ))
    this.receipts.set(receipt.id, metadata)
    this.publish({
      id: this.nextId(),
      kind: 'receipt',
      receipt: metadata,
    })
  }

  private recordRemoval(deliveryId: DeliveryId): void {
    if (this.disposed) return
    const previous = this.receipts.get(deliveryId)
    this.receipts.delete(deliveryId)
    if (previous !== undefined) {
      const bucket = this.acknowledged.get(previous.targetSessionId)
      bucket?.delete(deliveryId)
      if (bucket?.size === 0) this.acknowledged.delete(previous.targetSessionId)
    }
    this.publish({ id: this.nextId(), kind: 'remove', deliveryId })
  }

  private isAcknowledged(targetSessionId: SessionId, deliveryId: DeliveryId): boolean {
    return this.acknowledged.get(targetSessionId)?.has(deliveryId) === true
  }

  private nextId(): number {
    this.lastEventId += 1
    return this.lastEventId
  }

  private publish(event: NotificationEvent): void {
    this.ring.push(event)
    if (this.ring.length > EVENT_RING_SIZE) this.ring.splice(0, this.ring.length - EVENT_RING_SIZE)
    for (const listener of [...this.listeners]) listener(event)
  }
}
