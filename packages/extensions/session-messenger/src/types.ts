import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'

declare const deliveryIdBrand: unique symbol
declare const replyTokenBrand: unique symbol

/** Durable identity of one cross-session delivery attempt. */
export type DeliveryId = string & { readonly [deliveryIdBrand]: true }

/** One-use opaque authority bound to one delivered receipt. */
export type ReplyToken = string & { readonly [replyTokenBrand]: true }

/**
 * Create a compile-time branded delivery identity.
 * @param value - already validated durable identity string.
 * @returns the branded delivery identity.
 */
export const DeliveryId = (value: string): DeliveryId => value as DeliveryId

/**
 * Create a compile-time branded reply token.
 * @param value - already generated opaque capability string.
 * @returns the branded one-use reply token.
 */
export const ReplyToken = (value: string): ReplyToken => value as ReplyToken

/** Inbox behavior selected for one delivery. */
export type DeliveryMode = 'inject' | 'followup'

/** Model-hidden, durable source-side transcript row for an accepted relay. */
export interface OutgoingRelayEvent {
  readonly deliveryId: DeliveryId
  readonly targetSessionId: SessionId
  readonly body: string
  readonly status: 'delivered' | 'delivery-recovery-pending'
  readonly wakeRequested: boolean
  readonly replyToDeliveryId?: DeliveryId
  readonly continuationOfDeliveryId?: DeliveryId
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** UI-only sender transcript; never enters model history. */
    'session-messenger/outgoing': OutgoingRelayEvent
  }
}

/** Body retained only while an enqueue may need idempotent recovery. */
export interface RelayEnvelope {
  readonly body: string
}

/** Fields shared by every durable receipt state. */
export interface ReceiptBase {
  readonly id: DeliveryId
  readonly sourceSessionId: SessionId
  readonly targetSessionId: SessionId
  readonly messageId: MessageId
  readonly mode: DeliveryMode
  readonly createdAt: number
  readonly updatedAt: number
  readonly expiresAt: number
  readonly replyToken: ReplyToken
  readonly hop: number
  readonly wakeRequested: boolean
  /** Reverse receipt authorization link, present only for replies. */
  readonly replyToDeliveryId?: DeliveryId
  /** Trusted prior delivery when either participant continues the same chain. */
  readonly continuationOfDeliveryId?: DeliveryId
  /** Timestamp that closes this receipt's collaboration chain. */
  readonly collaborationStoppedAt?: number
}

/** Write-ahead state whose exact message has not been proven enqueued. */
export type RecoverableReceipt = ReceiptBase & (
  | { readonly status: 'prepared'; readonly envelope: RelayEnvelope }
  | {
    readonly status: 'delivery-recovery-pending'
    readonly envelope: RelayEnvelope
    readonly recoveryReason: string
  }
)

/** Successfully enqueued receipt retaining reply authority but no body. */
export type DeliveredReceipt = ReceiptBase & {
  readonly status: 'delivered'
  readonly deliveredAt: number
}

/** Enqueued message claimed by the target's driver. */
export type ClaimedReceipt = ReceiptBase & {
  readonly status: 'claimed'
  readonly deliveredAt: number
  readonly claimedAt: number
}

/** Receipt whose one-use reply authority was consumed. */
export type RepliedReceipt = ReceiptBase & {
  readonly status: 'replied'
  readonly deliveredAt: number
  readonly repliedAt: number
  readonly replyDeliveryId: DeliveryId
}

/** Terminal non-reply outcome. */
export type TerminalReceipt = ReceiptBase & {
  readonly status: 'discarded' | 'failed' | 'aborted' | 'rejected' | 'expired'
  readonly settledAt: number
  readonly errorCode: string
}

/** Complete durable receipt vocabulary. */
export type Receipt = RecoverableReceipt | DeliveredReceipt | ClaimedReceipt | RepliedReceipt | TerminalReceipt

/** One durable receipt-store transition observed by waits and notification projections. */
export type ReceiptTransition =
  | { readonly kind: 'upsert'; readonly receipt: Receipt }
  | { readonly kind: 'delete'; readonly deliveryId: DeliveryId }

/** Stable plugin error codes returned by tools and resolver boundaries. */
export type MessengerErrorCode =
  | 'caller-required'
  | 'invalid-target-id'
  | 'invalid-source-id'
  | 'source-not-found'
  | 'source-archived'
  | 'source-subagent'
  | 'source-blank'
  | 'self-target'
  | 'target-archived'
  | 'target-not-found'
  | 'target-subagent'
  | 'target-lookup-unavailable'
  | 'target-lookup-failed'
  | 'target-unavailable'
  | 'message-too-large'
  | 'rate-limited'
  | 'too-many-unresolved'
  | 'delivery-failed'
  | 'delivery-aborted'
  | 'delivery-recovery-pending'
  | 'receipt-not-found'
  | 'reply-forbidden'
  | 'reply-expired'
  | 'reply-consumed'
  | 'collaboration-stopped'
  | 'hop-limit'
  | 'invalid-timeout'
  | 'wait-timeout'
  | 'wait-aborted'
  | 'disposed'

/** Typed rejection with one non-secret stable code. */
export class MessengerError extends Error {
  constructor(public readonly code: MessengerErrorCode, message: string = code, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MessengerError'
  }
}

/**
 * Construct one typed plugin rejection.
 * @param code - stable non-secret error code exposed by Tool adapters.
 * @param message - optional internal diagnostic message.
 * @param options - optional standard Error cause metadata.
 * @returns the typed messenger rejection.
 */
export const messengerError = (
  code: MessengerErrorCode,
  message?: string,
  options?: ErrorOptions,
): MessengerError => new MessengerError(code, message, options)
