/** Write-ahead cross-session delivery, lifecycle projection, and recovery. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  createRelayMessage,
  toClaimed,
  toDelivered,
  toRecoveryPending,
  toReplied,
  toTerminal,
} from './envelope.ts'
import { openReceiptStore, type ReceiptRepository } from './receipt-store.ts'
import {
  MAX_MESSAGE_BYTES,
  MAX_HOP,
  RECEIPT_TTL_MS,
  relayEnvelopeSchema,
} from './spec.ts'
import {
  assertTargetStillOrdinaryAndUnarchived,
  resolveOrdinaryTarget,
  resolveOrdinaryTargetForSource,
} from './target-resolver.ts'
import {
  DeliveryId,
  messengerError,
  MessengerError,
  ReplyToken,
  type DeliveryMode,
  type Receipt,
  type ReceiptTransition,
  type RecoverableReceipt,
} from './types.ts'

/** Per-source accepted delivery budget in a rolling minute. */
export const MAX_DELIVERIES_PER_MINUTE = 30
/** Maximum unresolved receipts retained by one profile. */
export const MAX_UNRESOLVED_RECEIPTS = 256
/** Settled metadata retention. */
export const SETTLED_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
/** Bounded maintenance cadence. */
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1_000

/** Injectable deterministic boundaries used by tests; production uses secure UUIDs and wall time. */
export interface CoordinatorOptions {
  readonly now?: () => number
  readonly nextDeliveryId?: () => DeliveryId
  readonly nextMessageId?: () => ReturnType<typeof MessageId>
  readonly nextReplyToken?: () => ReplyToken
  readonly installLifecycle?: boolean
}

/** Request to the core coordinator; caller identity is always the explicit Agent object. */
export interface DeliveryRequest {
  readonly targetSessionId: string
  readonly message: string
  readonly mode: DeliveryMode
  readonly hop?: number
}

/** One capability-bound reverse delivery request. */
export interface ReplyRequest {
  readonly deliveryId: DeliveryId
  readonly replyToken: ReplyToken
  readonly message: string
  readonly wake: boolean
}

/** JSON-safe immediate delivery result. */
export interface DeliveryResult {
  readonly deliveryId: DeliveryId
  readonly messageId: ReturnType<typeof MessageId>
  readonly status: 'delivered' | 'delivery-recovery-pending'
  readonly wakeRequested: boolean
}

/** Receipt transition subscriber used by notifications and explicit waits. */
export type ReceiptListener = (transition: ReceiptTransition) => void

/** Owns one receipt store and every cross-service sequencing decision. */
export class SessionMessengerCoordinator {
  private readonly now: () => number
  private readonly nextDeliveryId: () => DeliveryId
  private readonly nextMessageId: () => ReturnType<typeof MessageId>
  private readonly nextReplyToken: () => ReplyToken
  private operationTail: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<ReceiptListener>()
  private readonly disposers: Array<() => void> = []
  private readonly claimsByTurn = new Map<string, Set<string>>()
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly receipts: ReceiptRepository,
    options: CoordinatorOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.nextDeliveryId = options.nextDeliveryId ?? (() => DeliveryId(globalThis.crypto.randomUUID()))
    this.nextMessageId = options.nextMessageId ?? (() => MessageId(globalThis.crypto.randomUUID()))
    this.nextReplyToken = options.nextReplyToken ?? (() => ReplyToken(globalThis.crypto.randomUUID()))
    if (options.installLifecycle !== false) this.installLifecycle()
  }

  /** Current immutable record, when retained. */
  receipt(id: DeliveryId): Receipt | undefined {
    return this.receipts.get(id)
  }

  /** Snapshot all retained receipts. */
  receiptEntries(): Array<[DeliveryId, Receipt]> {
    return this.receipts.entries()
  }

  /** Subscribe after the current snapshot; callers recheck around subscription for races. */
  subscribe(listener: ReceiptListener): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Deliver one bounded message after all zero-side-effect admission checks. */
  deliver(caller: Agent, request: DeliveryRequest, signal?: AbortSignal): Promise<DeliveryResult> {
    return this.serialize(() => this.deliverNow(caller, request, signal))
  }

  /** Consume one exact reply capability and deliver back to the recorded source. */
  reply(caller: Agent, request: ReplyRequest, signal?: AbortSignal): Promise<DeliveryResult> {
    return this.serialize(() => this.replyNow(caller, request, signal))
  }

  /** Recover crash-window records without generating replacement identities. */
  recover(): Promise<void> {
    return this.serialize(async () => {
      await this.maintainNow()
      for (const [, snapshot] of this.receipts.entries()) {
        const current = this.receipts.get(snapshot.id)
        if (current?.status !== 'prepared' && current?.status !== 'delivery-recovery-pending') continue
        try {
          if (!this.replyPreparationAuthorized(current)) {
            await this.commit(toTerminal(current, 'rejected', this.now(), 'reply-forbidden'))
            continue
          }
          if (await this.messageAlreadyExists(current)) {
            await this.commit(toDelivered(current, this.now()))
            continue
          }
          await this.recoverPrepared(current)
        } catch (error: unknown) {
          if (error instanceof MessengerError
            && (error.code === 'target-unavailable' || error.code === 'delivery-recovery-pending')) {
            this.ctx.logger.warn(`session messenger: deferred recoverable receipt (${error.code})`)
            continue
          }
          throw error
        }
      }
    })
  }

  /** Expire unresolved work and compact settled metadata. */
  maintain(): Promise<void> {
    return this.serialize(() => this.maintainNow())
  }

  /** Stop timers/listeners and drain admitted record writes. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.disposers.splice(0)) dispose()
    this.listeners.clear()
    await this.operationTail
    await this.receipts.drain()
  }

  private async deliverNow(
    caller: Agent,
    request: DeliveryRequest,
    signal?: AbortSignal,
  ): Promise<DeliveryResult> {
    this.assertActive()
    signal?.throwIfAborted()
    const envelope = relayEnvelopeSchema.safeParse({ body: request.message })
    if (!envelope.success) {
      throw messengerError(
        'message-too-large',
        `message must not exceed ${MAX_MESSAGE_BYTES} UTF-8 bytes`,
        { cause: envelope.error },
      )
    }
    this.assertAdmission(caller.id)
    const target = await resolveOrdinaryTarget(this.ctx, caller, request.targetSessionId)
    signal?.throwIfAborted()

    const at = this.now()
    const prepared: RecoverableReceipt = {
      id: this.nextDeliveryId(),
      sourceSessionId: caller.id,
      targetSessionId: target.id,
      messageId: this.nextMessageId(),
      mode: request.mode,
      status: 'prepared',
      createdAt: at,
      updatedAt: at,
      expiresAt: at + RECEIPT_TTL_MS,
      replyToken: this.nextReplyToken(),
      hop: request.hop ?? 0,
      wakeRequested: request.mode === 'followup',
      envelope: envelope.data,
    }
    await this.commit(prepared)

    return this.enqueuePrepared(target, prepared, signal)
  }

  private async replyNow(
    caller: Agent,
    request: ReplyRequest,
    signal?: AbortSignal,
  ): Promise<DeliveryResult> {
    this.assertActive()
    signal?.throwIfAborted()
    const original = this.receipts.get(request.deliveryId)
    if (original === undefined) throw messengerError('receipt-not-found', 'delivery receipt was not found')
    if (original.targetSessionId !== caller.id) {
      throw messengerError('reply-forbidden', 'reply authority is bound to the original target session')
    }
    if (original.status === 'replied') throw messengerError('reply-consumed', 'reply token was already consumed')
    if (original.status !== 'delivered' && original.status !== 'claimed') {
      throw messengerError(
        original.status === 'expired' ? 'reply-expired' : 'reply-consumed',
        'delivery is no longer replyable',
      )
    }
    const at = this.now()
    if (original.expiresAt <= at) throw messengerError('reply-expired', 'reply token expired')
    if (original.replyToken !== request.replyToken) throw messengerError('reply-forbidden', 'invalid reply token')
    if (original.hop >= MAX_HOP) throw messengerError('hop-limit', 'maximum reply chain depth reached')
    const envelope = relayEnvelopeSchema.safeParse({ body: request.message })
    if (!envelope.success) {
      throw messengerError(
        'message-too-large',
        `message must not exceed ${MAX_MESSAGE_BYTES} UTF-8 bytes`,
        { cause: envelope.error },
      )
    }
    this.assertAdmission(caller.id)
    const target = await resolveOrdinaryTarget(this.ctx, caller, original.sourceSessionId)
    signal?.throwIfAborted()

    const prepared: RecoverableReceipt = {
      id: this.nextDeliveryId(),
      sourceSessionId: caller.id,
      targetSessionId: target.id,
      messageId: this.nextMessageId(),
      mode: request.wake ? 'followup' : 'inject',
      status: 'prepared',
      createdAt: at,
      updatedAt: at,
      expiresAt: at + RECEIPT_TTL_MS,
      replyToken: this.nextReplyToken(),
      hop: original.hop + 1,
      wakeRequested: request.wake,
      replyToDeliveryId: original.id,
      envelope: envelope.data,
    }
    await this.commit(prepared)
    try {
      await this.commit(toReplied(original, this.now(), prepared.id))
    } catch (error: unknown) {
      try {
        await this.commit(toTerminal(prepared, 'rejected', this.now(), 'reply-forbidden'))
      } catch {
        // Recovery rejects an orphan preparation through replyToDeliveryId.
      }
      throw messengerError('delivery-failed', 'could not consume reply token', { cause: error })
    }

    // The original one-use token is now durably consumed. From this commit
    // point the reverse delivery must finish even if the calling tool aborts.
    return this.enqueuePrepared(target, prepared)
  }

  private async enqueuePrepared(
    target: Agent,
    prepared: RecoverableReceipt,
    signal?: AbortSignal,
  ): Promise<DeliveryResult> {
    const message = createRelayMessage(prepared)

    try {
      signal?.throwIfAborted()
      // Third archive/ordinary fence: no await or mutable operation may be
      // inserted between this assertion and the synchronous inbox enqueue.
      assertTargetStillOrdinaryAndUnarchived(this.ctx, target)
      if (prepared.mode === 'followup') target.followup(message)
      else target.inject(message)
    } catch (error: unknown) {
      const policy = error instanceof MessengerError
      const aborted = signal?.aborted === true || isAbortError(error)
      const code = policy ? error.code : aborted ? 'delivery-aborted' : 'delivery-failed'
      await this.commit(toTerminal(
        prepared,
        policy ? 'rejected' : aborted ? 'aborted' : 'failed',
        this.now(),
        code,
      ))
      if (policy) throw error
      throw messengerError(aborted ? 'delivery-aborted' : 'delivery-failed', 'target inbox rejected delivery', {
        cause: error,
      })
    }

    const delivered = toDelivered(prepared, this.now())
    try {
      await this.commit(delivered)
      return resultOf(delivered)
    } catch (_error: unknown) {
      const pending = toRecoveryPending(
        prepared,
        this.now(),
        'post-enqueue-status-write-indeterminate',
      )
      try {
        await this.commit(pending)
      } catch (pendingError: unknown) {
        this.ctx.logger.warn(
          `session messenger: could not persist recovery marker: ${String(pendingError)}`,
        )
      }
      return resultOf(pending)
    }
  }

  private replyPreparationAuthorized(receipt: RecoverableReceipt): boolean {
    if (receipt.replyToDeliveryId === undefined) return true
    const original = this.receipts.get(receipt.replyToDeliveryId)
    return original?.status === 'replied' && original.replyDeliveryId === receipt.id
  }

  private async recoverPrepared(receipt: RecoverableReceipt): Promise<void> {
    let enqueued = false
    try {
      const target = await resolveOrdinaryTargetForSource(
        this.ctx,
        receipt.sourceSessionId,
        receipt.targetSessionId,
      )
      const message = createRelayMessage(receipt)
      assertTargetStillOrdinaryAndUnarchived(this.ctx, target)
      if (receipt.mode === 'followup') target.followup(message)
      else target.inject(message)
      enqueued = true
      try {
        await this.commit(toDelivered(receipt, this.now()))
      } catch (deliveredError: unknown) {
        try {
          await this.commit(toRecoveryPending(
            receipt,
            this.now(),
            'recovery-post-enqueue-status-write-indeterminate',
          ))
        } catch (pendingError: unknown) {
          throw messengerError(
            'delivery-recovery-pending',
            'post-enqueue recovery status remains indeterminate',
            { cause: pendingError ?? deliveredError },
          )
        }
      }
    } catch (error: unknown) {
      if (enqueued) {
        this.ctx.logger.warn('session messenger: post-enqueue recovery state could not be persisted')
        throw error instanceof MessengerError
          ? error
          : messengerError('delivery-recovery-pending', 'post-enqueue recovery state remains indeterminate', {
            cause: error,
          })
      }
      if (error instanceof MessengerError) {
        await this.commit(toTerminal(receipt, 'rejected', this.now(), error.code))
        return
      }
      await this.commit(toTerminal(receipt, 'failed', this.now(), 'delivery-failed'))
    }
  }

  private async messageAlreadyExists(receipt: RecoverableReceipt): Promise<boolean> {
    const live = this.ctx.agents.get(receipt.targetSessionId)
    if (live !== undefined) {
      if ([...live.inbox.nextTurn, ...live.inbox.nextStep]
        .some(message => message.id === receipt.messageId)) return true
      return eventsContainMessage(live.session.events, receipt.messageId)
    }
    try {
      const inspected = await this.ctx.sessionPersistence.inspect(receipt.targetSessionId)
      return eventsContainMessage(inspected.events, receipt.messageId)
    } catch (error: unknown) {
      throw messengerError(
        'target-unavailable',
        'could not inspect cold target persistence for exact-message recovery',
        { cause: error },
      )
    }
  }

  private assertAdmission(sourceSessionId: SessionId): void {
    const now = this.now()
    const receipts = this.receipts.entries().map(([, receipt]) => receipt)
    const recent = receipts.filter(receipt =>
      receipt.sourceSessionId === sourceSessionId && receipt.createdAt > now - 60_000)
    if (recent.length >= MAX_DELIVERIES_PER_MINUTE) {
      throw messengerError('rate-limited', 'source session exceeded 30 deliveries per minute')
    }
    if (receipts.filter(isUnresolved).length >= MAX_UNRESOLVED_RECEIPTS) {
      throw messengerError('too-many-unresolved', 'profile has too many unresolved session deliveries')
    }
  }

  private async maintainNow(): Promise<void> {
    const now = this.now()
    for (const [id, receipt] of this.receipts.entries()) {
      if (isUnresolved(receipt) && receipt.expiresAt <= now) {
        await this.commit(toTerminal(receipt, 'expired', now, 'reply-expired'))
        continue
      }
      if (isSettled(receipt) && receipt.updatedAt <= now - SETTLED_RETENTION_MS) {
        const deleted = await this.receipts.delete(id)
        if (deleted) this.publishTransition({ kind: 'delete', deliveryId: id })
      }
    }
  }

  private installLifecycle(): void {
    this.disposers.push(this.ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      this.transitionByMessage(agent, message.id, receipt =>
        receipt.status === 'prepared' || receipt.status === 'delivery-recovery-pending'
          ? toDelivered(receipt, this.now())
          : undefined)
    }))
    this.disposers.push(this.ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      const key = turnKey(agent.id, turn)
      const ids = this.claimsByTurn.get(key) ?? new Set<string>()
      ids.add(message.id)
      this.claimsByTurn.set(key, ids)
      this.transitionByMessage(agent, message.id, receipt =>
        receipt.status === 'delivered' ? toClaimed(receipt, this.now()) : undefined)
    }))
    this.disposers.push(this.ctx.on('agent/inbox/discarded', ({ agent, message }) => {
      this.transitionByMessage(agent, message.id, receipt =>
        isUnresolved(receipt)
          ? toTerminal(receipt, 'discarded', this.now(), 'delivery-discarded')
          : undefined)
    }))
    this.disposers.push(this.ctx.on('agent/error', ({ agent, turn }) => {
      this.settleClaimedTurn(agent.id, turn, 'failed', 'delivery-failed')
    }))
    this.disposers.push(this.ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end') return
      if (event.data.reason.kind === 'aborted') {
        this.settleClaimedTurn(session.id, event.data.turn, 'aborted', 'delivery-aborted')
      } else if (event.data.reason.kind === 'error') {
        this.settleClaimedTurn(session.id, event.data.turn, 'failed', 'delivery-failed')
      } else {
        this.claimsByTurn.delete(turnKey(session.id, event.data.turn))
      }
    }))

    const timer = setInterval(() => {
      void this.recover().catch((error: unknown) => {
        this.ctx.logger.warn(`session messenger bounded recovery failed: ${String(error)}`)
      })
    }, MAINTENANCE_INTERVAL_MS)
    timer.unref()
    this.disposers.push(() => { clearInterval(timer) })
  }

  private transitionByMessage(
    agent: Agent,
    messageId: ReturnType<typeof MessageId>,
    transition: (receipt: Receipt) => Receipt | undefined,
  ): void {
    void this.serialize(async () => {
      const match = this.receipts.entries().map(([, receipt]) => receipt)
        .find(receipt => receipt.targetSessionId === agent.id && receipt.messageId === messageId)
      if (match === undefined) return
      const next = transition(match)
      if (next !== undefined) await this.commit(next)
    }).catch((error: unknown) => {
      this.ctx.logger.warn(`session messenger lifecycle update failed: ${String(error)}`)
    })
  }

  private settleClaimedTurn(
    sessionId: SessionId,
    turn: number,
    status: 'failed' | 'aborted',
    errorCode: string,
  ): void {
    const key = turnKey(sessionId, turn)
    const messageIds = this.claimsByTurn.get(key)
    this.claimsByTurn.delete(key)
    if (messageIds === undefined) return
    for (const messageId of messageIds) {
      const agent = this.ctx.agents.get(sessionId)
      if (agent !== undefined) {
        this.transitionByMessage(agent, MessageId(messageId), receipt =>
          receipt.status === 'claimed'
            ? toTerminal(receipt, status, this.now(), errorCode)
            : undefined)
      }
    }
  }

  private async commit(receipt: Receipt): Promise<void> {
    await this.receipts.put(receipt)
    this.publishTransition({ kind: 'upsert', receipt })
  }

  private publishTransition(transition: ReceiptTransition): void {
    for (const listener of this.listeners) {
      try {
        listener(transition)
      } catch (error: unknown) {
        this.ctx.logger.warn(`session messenger listener failed: ${String(error)}`)
      }
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(messengerError('disposed'))
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  private assertActive(): void {
    if (this.disposed) throw messengerError('disposed')
  }
}

/** Open, recover, and lifecycle-bind the coordinator to one plugin Context. */
export async function createSessionMessengerCoordinator(
  ctx: Context,
  options: CoordinatorOptions = {},
): Promise<SessionMessengerCoordinator> {
  const opened = await openReceiptStore(ctx)
  const coordinator = new SessionMessengerCoordinator(ctx, opened.store, options)
  ctx.effect(() => async () => {
    await coordinator.dispose()
    await opened.close()
  }, 'session-messenger: coordinator and receipt domain')
  await coordinator.recover()
  return coordinator
}

function resultOf(receipt: RecoverableReceipt | ReturnType<typeof toDelivered>): DeliveryResult {
  return {
    deliveryId: receipt.id,
    messageId: receipt.messageId,
    status: receipt.status === 'delivered' ? 'delivered' : 'delivery-recovery-pending',
    wakeRequested: receipt.wakeRequested,
  }
}

function isUnresolved(receipt: Receipt): boolean {
  return receipt.status === 'prepared'
    || receipt.status === 'delivery-recovery-pending'
    || receipt.status === 'delivered'
    || receipt.status === 'claimed'
}

function isSettled(receipt: Receipt): boolean {
  return !isUnresolved(receipt)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'This operation was aborted')
}

function turnKey(sessionId: SessionId, turn: number): string {
  return `${sessionId}:${turn}`
}

function eventsContainMessage(
  events: readonly { readonly type: string; readonly data: unknown }[],
  messageId: ReturnType<typeof MessageId>,
): boolean {
  for (const event of events) {
    if (event.type === 'user/message') {
      const data = event.data as { id?: unknown }
      if (data.id === messageId) return true
    }
    if (event.type === 'agent/inbox/spliced') {
      const data = event.data as { inserted?: readonly { id?: unknown }[] }
      if (data.inserted?.some(message => message.id === messageId) === true) return true
    }
  }
  return false
}
