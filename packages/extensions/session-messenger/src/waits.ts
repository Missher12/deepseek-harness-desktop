/** Explicit, reply-bound waits with read-only target-availability checks. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import type { DeliveryId, MessengerErrorCode, Receipt, ReceiptTransition } from './types.ts'

/** Small receipt projection required by the waiter. */
export interface WaitReceiptSource {
  receipt(id: DeliveryId): Receipt | undefined
  subscribe(listener: (transition: ReceiptTransition) => void): () => void
}

/** Read-only policy result: uncertain storage never masquerades as deletion. */
export type TargetAvailability = 'available' | 'unavailable' | 'unknown'

/** Availability boundary used by waits; it must never resolve, resume, or wake a target. */
export interface TargetAvailabilityPolicy {
  check(targetSessionId: SessionIdType): Promise<TargetAvailability>
  subscribe(targetSessionId: SessionIdType, listener: () => void): () => void
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
type ReceiptInspection =
  | { readonly kind: 'settled'; readonly result: ReplyWaitResult }
  | { readonly kind: 'waiting'; readonly targetSessionId: SessionIdType }
  | { readonly kind: 'reply-pending' }

const ALWAYS_AVAILABLE: TargetAvailabilityPolicy = {
  check: () => Promise.resolve('available'),
  subscribe: () => () => {},
}

/**
 * Build the production read-only policy. It reads current registries and the
 * persistence catalog only; no Typert lookup, Agent resume, inbox mutation,
 * or driver operation is reachable from this boundary.
 * @param ctx - Cordis context exposing read-only workspace and persistence state.
 * @returns the target-availability policy bound to this context generation.
 */
export function createContextTargetAvailabilityPolicy(ctx: Context): TargetAvailabilityPolicy {
  let eventArchivedSessionIds: readonly SessionIdType[] | undefined
  const listeners = new Set<{ readonly targetSessionId: SessionIdType; readonly listener: () => void }>()

  const archivedSessionIds = (): readonly SessionIdType[] =>
    eventArchivedSessionIds ?? ctx.workspaceRegistry.archivedSessionIds

  ctx.on('domain/changed', (change: DomainChanged) => {
    if (change.domain !== 'workspace' || change.table !== '' || change.operation !== 'put') return
    const next = archivedIdsOf(change.value)
    if (next === undefined) return
    eventArchivedSessionIds = next
    for (const entry of listeners) entry.listener()
  })
  ctx.on('agent/disposed', ({ agent }) => {
    for (const entry of listeners) {
      if (agent.id === entry.targetSessionId) entry.listener()
    }
  })
  ctx.on('session/disposed', (session) => {
    for (const entry of listeners) {
      if (session.id === entry.targetSessionId) entry.listener()
    }
  })

  return {
    async check(targetSessionId) {
      if (archivedSessionIds().includes(targetSessionId)) return 'unavailable'
      if (ctx.agents.get(targetSessionId) !== undefined) return 'available'
      try {
        const headers = await ctx.sessionPersistence.list()
        // Both registries may change while the persistence read is pending.
        if (archivedSessionIds().includes(targetSessionId)) return 'unavailable'
        if (ctx.agents.get(targetSessionId) !== undefined) return 'available'
        return headers.some(header => header.id === targetSessionId) ? 'available' : 'unavailable'
      } catch {
        return 'unknown'
      }
    },
    subscribe(targetSessionId, listener) {
      const entry = { targetSessionId, listener }
      listeners.add(entry)
      return () => { listeners.delete(entry) }
    },
  }
}

/** Owns every outstanding wait so plugin disposal resolves them deterministically. */
export class SessionReplyWaiter {
  private readonly pending = new Set<() => void>()
  private disposed = false

  constructor(
    private readonly source: WaitReceiptSource,
    private readonly availability: TargetAvailabilityPolicy = ALWAYS_AVAILABLE,
  ) {}

  /**
   * Wait for the reply bound to one source-owned delivery receipt.
   * @param caller - ordinary source Agent authorized to observe the receipt.
   * @param deliveryId - exact original delivery identity.
   * @param timeoutMs - bounded explicit wait duration in milliseconds.
   * @param signal - optional cancellation signal for the wait only.
   * @returns a JSON-safe reply settlement without message contents or capabilities.
   */
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
    if (signal?.aborted === true) {
      return Promise.resolve(failureFromReceipt(deliveryId, this.source.receipt(deliveryId), 'wait-aborted', 'wait-aborted'))
    }

    const initial = this.inspectReceipt(caller, deliveryId)
    if (initial.kind === 'settled') return Promise.resolve(initial.result)

    return new Promise<ReplyWaitResult>((resolve) => {
      const state = { settled: false, checking: false, recheck: false, unsubscribe: (): void => {} }
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
        if (state.settled) return
        if (state.checking) {
          state.recheck = true
          return
        }
        state.checking = true
        void this.inspect(caller, deliveryId)
          .then((result) => {
            if (result !== undefined) settle(result)
          })
          .catch(() => {
            // An injected policy failure is uncertainty, never fabricated deletion.
          })
          .finally(() => {
            state.checking = false
            if (state.recheck && !state.settled) {
              state.recheck = false
              inspect()
            }
          })
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

      const receiptUnsubscribe = this.source.subscribe(() => { inspect() })
      const availabilityUnsubscribe = initial.kind === 'waiting'
        ? this.availability.subscribe(initial.targetSessionId, inspect)
        : () => {}
      if (state.settled) {
        receiptUnsubscribe()
        availabilityUnsubscribe()
        return
      }
      state.unsubscribe = () => {
        receiptUnsubscribe()
        availabilityUnsubscribe()
      }
      // Recheck after both subscriptions to close receipt and availability races.
      inspect()
    })
  }

  /** Resolve every outstanding wait; safe and idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const settle of [...this.pending]) settle()
  }

  private async inspect(caller: Agent, deliveryId: DeliveryId): Promise<ReplyWaitResult | undefined> {
    const before = this.inspectReceipt(caller, deliveryId)
    if (before.kind === 'settled') return before.result
    if (before.kind === 'reply-pending') return undefined

    const availability = await this.availability.check(before.targetSessionId)
    const after = this.inspectReceipt(caller, deliveryId)
    if (after.kind === 'settled') return after.result
    if (after.kind === 'reply-pending') return undefined
    if (availability === 'unavailable' && after.targetSessionId === before.targetSessionId) {
      const receipt = this.source.receipt(deliveryId)
      return failure(
        deliveryId,
        receipt?.messageId ?? null,
        receipt?.wakeRequested ?? false,
        'target-unavailable',
        'target-unavailable',
      )
    }
    return undefined
  }

  private inspectReceipt(caller: Agent, deliveryId: DeliveryId): ReceiptInspection {
    const original = this.source.receipt(deliveryId)
    if (original === undefined) {
      return { kind: 'settled', result: failure(deliveryId, null, false, 'rejected', 'receipt-not-found') }
    }
    if (original.sourceSessionId !== caller.id) {
      return {
        kind: 'settled',
        result: failure(deliveryId, original.messageId, original.wakeRequested, 'rejected', 'reply-forbidden'),
      }
    }
    if (original.status === 'replied') {
      const reverse = this.source.receipt(original.replyDeliveryId)
      if (reverse === undefined
        || reverse.status === 'prepared'
        || reverse.status === 'delivery-recovery-pending') return { kind: 'reply-pending' }
      if (reverse.status === 'delivered' || reverse.status === 'claimed' || reverse.status === 'replied') {
        return {
          kind: 'settled',
          result: {
            deliveryId,
            messageId: original.messageId,
            status: 'replied',
            wakeRequested: reverse.wakeRequested,
            errorCode: null,
            replyDeliveryId: reverse.id,
          },
        }
      }
      return {
        kind: 'settled',
        result: failure(
          deliveryId,
          original.messageId,
          reverse.wakeRequested,
          reverse.status,
          reverse.errorCode,
          reverse.id,
        ),
      }
    }
    if (original.status === 'discarded'
      || original.status === 'failed'
      || original.status === 'aborted'
      || original.status === 'rejected'
      || original.status === 'expired') {
      return {
        kind: 'settled',
        result: failure(
          deliveryId,
          original.messageId,
          original.wakeRequested,
          original.status,
          original.errorCode,
        ),
      }
    }
    return { kind: 'waiting', targetSessionId: original.targetSessionId }
  }
}

function archivedIdsOf(value: unknown): readonly SessionIdType[] | undefined {
  if (typeof value !== 'object' || value === null || !('archivedSessionIds' in value)) return undefined
  const ids = (value as { archivedSessionIds?: unknown }).archivedSessionIds
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) return undefined
  return ids.map(SessionId)
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
