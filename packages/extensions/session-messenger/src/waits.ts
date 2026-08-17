/** Explicit, reply-bound waits with no Agent-idleness heuristics. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { DeliveryId, MessengerErrorCode, Receipt } from './types.ts'

/** Small receipt projection required by the waiter. */
export interface WaitReceiptSource {
  receipt(id: DeliveryId): Receipt | undefined
  subscribe(listener: (receipt: Receipt) => void): () => void
}

/** Canonical JSON-safe settlement returned by wait_for_session_reply. */
export interface ReplyWaitResult {
  readonly deliveryId: DeliveryId
  readonly messageId: MessageId | null
  readonly status: string
  readonly wakeRequested: boolean
  readonly errorCode: string | null
  readonly replyDeliveryId: DeliveryId | null
}

/** Minimum accepted model-requested wait. */
export const MIN_WAIT_TIMEOUT_MS = 1_000
/** Maximum accepted model-requested wait, leaving runtime cleanup headroom. */
export const MAX_WAIT_TIMEOUT_MS = 55_000
/** Default explicit wait. */
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000

type Settle = (result: ReplyWaitResult) => void

/** Owns every outstanding wait so plugin disposal resolves them deterministically. */
export class SessionReplyWaiter {
  private readonly pending = new Set<() => void>()
  private disposed = false

  constructor(private readonly source: WaitReceiptSource) {}

  wait(
    caller: Agent,
    deliveryId: DeliveryId,
    timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<ReplyWaitResult> {
    if (!Number.isSafeInteger(timeoutMs)
      || timeoutMs < MIN_WAIT_TIMEOUT_MS
      || timeoutMs > MAX_WAIT_TIMEOUT_MS) {
      return Promise.resolve(failure(deliveryId, null, false, 'invalid-timeout', 'invalid-timeout'))
    }
    if (this.disposed) {
      return Promise.resolve(failure(deliveryId, null, false, 'disposed', 'disposed'))
    }

    const initial = this.inspect(caller, deliveryId)
    if (initial !== undefined) return Promise.resolve(initial)
    if (signal?.aborted === true) {
      return Promise.resolve(failureFromReceipt(deliveryId, this.source.receipt(deliveryId), 'wait-aborted', 'wait-aborted'))
    }

    return new Promise<ReplyWaitResult>((resolve) => {
      const state = { settled: false, unsubscribe: (): void => {} }
      const onAbort = (): void => {
        settle(failureFromReceipt(
          deliveryId,
          this.source.receipt(deliveryId),
          'wait-aborted',
          'wait-aborted',
        ))
      }
      const settle: Settle = (result) => {
        if (state.settled) return
        state.settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        state.unsubscribe()
        this.pending.delete(disposeWait)
        resolve(result)
      }
      const disposeWait = (): void => {
        settle(failureFromReceipt(
          deliveryId,
          this.source.receipt(deliveryId),
          'disposed',
          'disposed',
        ))
      }
      const inspect = (): void => {
        const result = this.inspect(caller, deliveryId)
        if (result !== undefined) settle(result)
      }

      const timer = setTimeout(() => {
        settle(failureFromReceipt(
          deliveryId,
          this.source.receipt(deliveryId),
          'wait-timeout',
          'wait-timeout',
        ))
      }, timeoutMs)
      timer.unref()

      this.pending.add(disposeWait)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted === true) onAbort()
      const unsubscribe = this.source.subscribe(() => { inspect() })
      if (state.settled) {
        unsubscribe()
        return
      }
      state.unsubscribe = unsubscribe
      // The recheck closes a reply transition between the first snapshot and subscription.
      inspect()
    })
  }

  /** Resolve every outstanding wait; safe and idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const settle of [...this.pending]) settle()
  }

  private inspect(caller: Agent, deliveryId: DeliveryId): ReplyWaitResult | undefined {
    const original = this.source.receipt(deliveryId)
    if (original === undefined) return failure(deliveryId, null, false, 'rejected', 'receipt-not-found')
    if (original.sourceSessionId !== caller.id) {
      return failure(deliveryId, original.messageId, original.wakeRequested, 'rejected', 'reply-forbidden')
    }
    if (original.status === 'replied') {
      const reverse = this.source.receipt(original.replyDeliveryId)
      if (reverse === undefined
        || reverse.status === 'prepared'
        || reverse.status === 'delivery-recovery-pending') return undefined
      if (reverse.status === 'delivered' || reverse.status === 'claimed' || reverse.status === 'replied') {
        return {
          deliveryId,
          messageId: original.messageId,
          status: 'replied',
          wakeRequested: reverse.wakeRequested,
          errorCode: null,
          replyDeliveryId: reverse.id,
        }
      }
      return failure(
        deliveryId,
        original.messageId,
        reverse.wakeRequested,
        reverse.status,
        reverse.errorCode,
        reverse.id,
      )
    }
    if (original.status === 'discarded'
      || original.status === 'failed'
      || original.status === 'aborted'
      || original.status === 'rejected'
      || original.status === 'expired') {
      return failure(
        deliveryId,
        original.messageId,
        original.wakeRequested,
        original.status,
        original.errorCode,
      )
    }
    return undefined
  }
}

function failureFromReceipt(
  deliveryId: DeliveryId,
  receipt: Receipt | undefined,
  status: string,
  errorCode: MessengerErrorCode,
): ReplyWaitResult {
  return failure(
    deliveryId,
    receipt?.messageId ?? null,
    receipt?.wakeRequested ?? false,
    status,
    errorCode,
  )
}

function failure(
  deliveryId: DeliveryId,
  messageId: MessageId | null,
  wakeRequested: boolean,
  status: string,
  errorCode: string,
  replyDeliveryId: DeliveryId | null = null,
): ReplyWaitResult {
  return { deliveryId, messageId, status, wakeRequested, errorCode, replyDeliveryId }
}
