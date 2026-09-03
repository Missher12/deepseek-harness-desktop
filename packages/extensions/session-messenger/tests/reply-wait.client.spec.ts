import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionMessengerCoordinator, type CoordinatorOptions } from '../src/coordinator.ts'
import {
  createContextTargetAvailabilityPolicy,
  SessionReplyWaiter,
  type TargetAvailability,
  type TargetAvailabilityPolicy,
} from '../src/waits.ts'
import { MAX_HOP, RECEIPT_TTL_MS } from '../src/spec.ts'
import {
  DeliveryId,
  ReplyToken,
  type DeliveredReceipt,
  type Receipt,
  type ReceiptTransition,
} from '../src/types.ts'
import { fakeAgent, fakeContext, MemoryReceiptStore } from './helpers.client.ts'

function options(now: () => number): CoordinatorOptions {
  let delivery = 1
  let message = 1
  let token = 1
  return {
    now,
    nextDeliveryId: () => DeliveryId(`reply-delivery-${delivery++}`),
    nextMessageId: () => MessageId(`reply-message-${message++}`),
    nextReplyToken: () => ReplyToken(`reply-token-${token++}`),
    installLifecycle: false,
  }
}

function delivered(overrides: Partial<DeliveredReceipt> = {}): DeliveredReceipt {
  return {
    id: DeliveryId('original'),
    sourceSessionId: SessionId('source'),
    targetSessionId: SessionId('target'),
    messageId: MessageId('original-message'),
    mode: 'inject', status: 'delivered',
    createdAt: 1_000, updatedAt: 1_001, deliveredAt: 1_001,
    expiresAt: 1_000 + RECEIPT_TTL_MS,
    replyToken: ReplyToken('secret-token'),
    hop: 0, wakeRequested: false,
    ...overrides,
  }
}

afterEach(() => { vi.useRealTimers() })

describe('reply authority', () => {
  it.each([
    ['wrong caller', fakeAgent('intruder'), ReplyToken('secret-token'), {}, 'reply-forbidden'],
    ['forged token', fakeAgent('target'), ReplyToken('forged'), {}, 'reply-forbidden'],
    ['expired token', fakeAgent('target'), ReplyToken('secret-token'), { expiresAt: 999 }, 'reply-expired'],
    ['hop limit', fakeAgent('target'), ReplyToken('secret-token'), { hop: MAX_HOP }, 'hop-limit'],
  ] as const)('rejects %s without creating a reverse receipt', async (_label, caller, token, overrides, code) => {
    const source = fakeAgent('source')
    const target = caller.id === SessionId('target') ? caller : fakeAgent('target')
    const h = fakeContext([source, target, caller])
    const store = new MemoryReceiptStore()
    store.records.set(DeliveryId('original'), delivered(overrides))
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options(() => 2_000))

    await expect(coordinator.reply(caller, {
      deliveryId: DeliveryId('original'), replyToken: token, message: 'answer', wake: false,
    })).rejects.toMatchObject({ code })
    expect(store.writes).toHaveLength(0)
    expect(source.inject).not.toHaveBeenCalled()
    expect(source.followup).not.toHaveBeenCalled()
  })

  it.each([[false, 'inject'], [true, 'followup']] as const)(
    'consumes Host-owned reply authority once and uses wake=%s through %s', async (wake, method) => {
      const source = fakeAgent('source')
      const target = fakeAgent('target')
      const h = fakeContext([source, target])
      const store = new MemoryReceiptStore()
      store.records.set(DeliveryId('original'), delivered())
      const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options(() => 2_000))

      const result = await coordinator.replyToDelivery(target, {
        deliveryId: DeliveryId('original'), message: 'answer', wake,
      })

      expect(result).toMatchObject({
        deliveryId: DeliveryId('reply-delivery-1'),
        messageId: MessageId('reply-message-1'),
        status: 'delivered', wakeRequested: wake,
      })
      expect(source[method]).toHaveBeenCalledTimes(1)
      expect(source[method === 'inject' ? 'followup' : 'inject']).not.toHaveBeenCalled()
      expect(source.whenIdle).not.toHaveBeenCalled()
      expect(store.get(DeliveryId('original'))).toMatchObject({
        status: 'replied', replyDeliveryId: DeliveryId('reply-delivery-1'),
      })
      expect(store.get(DeliveryId('reply-delivery-1'))).toMatchObject({
        sourceSessionId: SessionId('target'), targetSessionId: SessionId('source'), hop: 1,
      })
      await expect(coordinator.replyToDelivery(target, {
        deliveryId: DeliveryId('original'), message: 'again', wake,
      })).rejects.toMatchObject({ code: 'reply-consumed' })
      expect(source[method]).toHaveBeenCalledTimes(1)
    },
  )

  it('recovery refuses an unconsumed orphan reply preparation', async () => {
    const source = fakeAgent('source')
    const h = fakeContext([source])
    const store = new MemoryReceiptStore()
    store.records.set(DeliveryId('original'), delivered())
    store.records.set(DeliveryId('orphan'), {
      ...delivered({
        id: DeliveryId('orphan'), sourceSessionId: SessionId('target'), targetSessionId: SessionId('source'),
        messageId: MessageId('orphan-message'), replyToken: ReplyToken('orphan-token'),
      }),
      status: 'prepared', envelope: { body: 'must not deliver' },
      replyToDeliveryId: DeliveryId('original'),
    })
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options(() => 2_000))

    await coordinator.recover()

    expect(source.inject).not.toHaveBeenCalled()
    expect(store.get(DeliveryId('orphan'))).toMatchObject({ status: 'rejected', errorCode: 'reply-forbidden' })
  })
})

describe('explicit reply wait', () => {
  it('settles an active receipt-bound wait immediately when either participant stops the collaboration', async () => {
    const source = fakeAgent('source')
    const target = fakeAgent('target')
    const h = fakeContext([source, target])
    const store = new MemoryReceiptStore()
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options(() => 2_000))
    const delivery = await coordinator.deliver(source, {
      targetSessionId: 'target', message: 'please check', mode: 'followup',
    })
    const waiter = new SessionReplyWaiter(coordinator)
    const pending = waiter.wait(source, delivery.deliveryId, 55_000)

    await coordinator.stopCollaboration(target, delivery.deliveryId)

    await expect(pending).resolves.toMatchObject({
      deliveryId: delivery.deliveryId,
      status: 'aborted',
      errorCode: 'collaboration-stopped',
      replyDeliveryId: null,
    })
  })

  it('closes the subscribe/recheck race and ignores unrelated updates', async () => {
    const original = delivered()
    const reverse = delivered({
      id: DeliveryId('reply'), sourceSessionId: SessionId('target'), targetSessionId: SessionId('source'),
      messageId: MessageId('reply-message'), replyToken: ReplyToken('next-token'),
    })
    const replied: Receipt = {
      ...original, status: 'replied', repliedAt: 2_000, updatedAt: 2_000,
      replyDeliveryId: DeliveryId('reply'),
    }
    const records = new Map<DeliveryId, Receipt>([[DeliveryId('original'), original]])
    let listener: ((transition: ReceiptTransition) => void) | undefined
    const source = {
      receipt: (id: DeliveryId) => records.get(id),
      subscribe: (next: (transition: ReceiptTransition) => void) => {
        listener = next
        records.set(DeliveryId('original'), replied)
        records.set(DeliveryId('reply'), reverse)
        return vi.fn()
      },
    }
    const waiter = new SessionReplyWaiter(source)

    listener?.({ kind: 'upsert', receipt: delivered({ id: DeliveryId('unrelated') }) })
    await expect(waiter.wait(fakeAgent('source'), DeliveryId('original'), 1_000, new AbortController().signal))
      .resolves.toMatchObject({
        deliveryId: DeliveryId('original'), messageId: MessageId('original-message'),
        status: 'replied', errorCode: null, replyDeliveryId: DeliveryId('reply'),
      })
  })

  it('validates timeout bounds and defaults to 30 seconds', async () => {
    vi.useFakeTimers()
    const original = delivered()
    const source = {
      receipt: (id: DeliveryId) => id === original.id ? original : undefined,
      subscribe: () => vi.fn(),
    }
    const waiter = new SessionReplyWaiter(source)
    const caller = fakeAgent('source')
    await expect(waiter.wait(caller, original.id, 999)).resolves.toMatchObject({ errorCode: 'invalid-timeout' })
    await expect(waiter.wait(caller, original.id, 55_001)).resolves.toMatchObject({ errorCode: 'invalid-timeout' })

    const pending = waiter.wait(caller, original.id)
    await vi.advanceTimersByTimeAsync(29_999)
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toMatchObject({ status: 'wait-timeout', errorCode: 'wait-timeout' })
  })

  it('settles on abort and plugin disposal without polling agent idleness', async () => {
    const original = delivered()
    const source = {
      receipt: (id: DeliveryId) => id === original.id ? original : undefined,
      subscribe: () => vi.fn(),
    }
    const waiter = new SessionReplyWaiter(source)
    const caller = fakeAgent('source')
    const abort = new AbortController()
    const aborted = waiter.wait(caller, original.id, 55_000, abort.signal)
    abort.abort()
    await expect(aborted).resolves.toMatchObject({ status: 'wait-aborted', errorCode: 'wait-aborted' })

    const disposed = waiter.wait(caller, original.id, 55_000)
    waiter.dispose()
    await expect(disposed).resolves.toMatchObject({ status: 'disposed', errorCode: 'disposed' })
    expect(caller.whenIdle).not.toHaveBeenCalled()
  })

  it('returns target-unavailable immediately for an archived accepted target without mutation', async () => {
    const original = delivered()
    const records = new Map<DeliveryId, Receipt>([[original.id, original]])
    const availability = fakeAvailability('unavailable')
    const waiter = new SessionReplyWaiter({
      receipt: id => records.get(id),
      subscribe: () => vi.fn(),
    }, availability)
    const caller = fakeAgent('source')

    await expect(waiter.wait(caller, original.id, 55_000)).resolves.toEqual({
      deliveryId: original.id,
      messageId: original.messageId,
      status: 'target-unavailable',
      wakeRequested: false,
      errorCode: 'target-unavailable',
      replyDeliveryId: null,
    })
    expect(records).toEqual(new Map([[original.id, original]]))
    expect(caller.whenIdle).not.toHaveBeenCalled()
  })

  it('rechecks availability after deletion notification instead of timing out', async () => {
    const original = delivered()
    const availability = fakeAvailability('available')
    const waiter = new SessionReplyWaiter({
      receipt: id => id === original.id ? original : undefined,
      subscribe: () => vi.fn(),
    }, availability)
    const caller = fakeAgent('source')
    const pending = waiter.wait(caller, original.id, 55_000)
    await vi.waitFor(() => { expect(availability.listenerCount()).toBe(1) })

    availability.set('unavailable')

    await expect(pending).resolves.toMatchObject({
      deliveryId: original.id,
      status: 'target-unavailable',
      errorCode: 'target-unavailable',
    })
    expect(caller.whenIdle).not.toHaveBeenCalled()
  })

  it('uses only read-only registry/agent/persistence seams for archive and deletion checks', async () => {
    const source = fakeAgent('source')
    const target = fakeAgent('target')
    const h = fakeContext([source, target])
    const policy = createContextTargetAvailabilityPolicy(h.ctx as never)
    h.ctx.workspaceRegistry.archivedSessionIds.push(target.id)

    await expect(policy.check(target.id)).resolves.toBe('unavailable')
    h.ctx.workspaceRegistry.archivedSessionIds.length = 0
    const domainListeners = h.listeners.get('domain/changed') ?? []
    const publishWorkspace = (archivedSessionIds: string[]): void => {
      const change: DomainChanged = {
        domain: 'workspace', table: '', key: '', operation: 'put',
        value: { archivedSessionIds },
      }
      for (const listener of domainListeners) {
        (listener as unknown as (event: DomainChanged) => void)(change)
      }
    }
    publishWorkspace([target.id])
    await expect(policy.check(target.id)).resolves.toBe('unavailable')
    // The policy observes restore even while no wait is subscribed.
    publishWorkspace([])
    h.byId.delete(target.id)
    h.list.mockResolvedValue([])
    await expect(policy.check(target.id)).resolves.toBe('unavailable')

    expect(h.ctx.typert.lookups.get).not.toHaveBeenCalled()
    expect(h.ctx.agents.resume).not.toHaveBeenCalled()
    expect(target.whenIdle).not.toHaveBeenCalled()
  })
})

function fakeAvailability(initial: TargetAvailability): TargetAvailabilityPolicy & {
  set(value: TargetAvailability): void
  listenerCount(): number
} {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    check: vi.fn(async () => current),
    subscribe(_targetSessionId, listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(value) {
      current = value
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size,
  }
}
