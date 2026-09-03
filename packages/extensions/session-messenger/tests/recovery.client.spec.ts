import { freezeMessage, MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAINTENANCE_INTERVAL_MS,
  SessionMessengerCoordinator,
  type CoordinatorOptions,
} from '../src/coordinator.ts'
import { RECEIPT_TTL_MS } from '../src/spec.ts'
import { DeliveryId, ReplyToken, type Receipt } from '../src/types.ts'
import { fakeAgent, fakeContext, MemoryReceiptStore } from './helpers.client.ts'

const now = 10_000
const options: CoordinatorOptions = {
  now: () => now,
  nextDeliveryId: () => DeliveryId('unused-delivery'),
  nextMessageId: () => MessageId('unused-message'),
  nextReplyToken: () => ReplyToken('unused-token'),
  installLifecycle: false,
}

afterEach(() => { vi.useRealTimers() })

function recoverable(status: 'prepared' | 'delivery-recovery-pending' = 'prepared'): Receipt {
  const common = {
    id: DeliveryId('delivery-1'),
    sourceSessionId: SessionId('source'),
    targetSessionId: SessionId('target'),
    messageId: MessageId('fixed-message'),
    mode: 'inject' as const,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + RECEIPT_TTL_MS,
    replyToken: ReplyToken('token'),
    hop: 0,
    wakeRequested: false,
    envelope: { body: 'recover me' },
  }
  return status === 'prepared'
    ? { ...common, status }
    : { ...common, status, recoveryReason: 'post-enqueue-status-write-indeterminate' }
}

function persistedInsertion() {
  const message = freezeMessage({
    id: MessageId('fixed-message'),
    role: 'user' as const,
    source: { kind: 'plugin' as const, plugin: 'dsh-session-messenger', form: 'relay' as const },
    content: [{ type: 'text' as const, text: 'persisted' }],
  })
  return {
    type: 'agent/inbox/spliced',
    seq: 0,
    time: now,
    data: { target: 'next-step', start: 0, inserted: [message] },
  }
}

describe('write-ahead recovery', () => {
  it('rebuilds an absent prepared message with the exact Message ID and never calls createUserMessage', async () => {
    const target = fakeAgent('target')
    const h = fakeContext([target])
    const store = new MemoryReceiptStore()
    store.records.set(DeliveryId('delivery-1'), recoverable())
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options)

    await coordinator.recover()

    expect(target.inject).toHaveBeenCalledTimes(1)
    const message = target.inject.mock.calls[0]![0] as UserMessage
    expect(message.id).toBe(MessageId('fixed-message'))
    const metadata = message.content[0]
    const body = message.content[1]
    expect(metadata?.type).toBe('text')
    expect(body).toEqual({ type: 'text', text: 'recover me' })
    expect(JSON.stringify(message)).not.toContain('reply-token')
    expect(Object.isFrozen(message)).toBe(true)
    expect(store.get(DeliveryId('delivery-1'))).toMatchObject({ status: 'delivered' })
    expect(store.get(DeliveryId('delivery-1'))).not.toHaveProperty('envelope')
  })

  it.each([
    ['live inbox', 'inbox'],
    ['live session event', 'live-event'],
    ['cold persistence', 'cold-event'],
  ] as const)('finds the exact ID in %s before deciding whether to enqueue', async (_label, location) => {
    const target = fakeAgent('target', {
      events: location === 'live-event' ? [persistedInsertion()] : [],
    })
    if (location === 'inbox') {
      target.inbox.nextStep.push({ id: MessageId('fixed-message') })
    }
    const h = fakeContext(location === 'cold-event' ? [] : [target])
    if (location === 'cold-event') {
      h.inspect.mockResolvedValue({
        meta: { version: 0, id: SessionId('target'), createdAt: 1 },
        events: [persistedInsertion()],
      })
    }
    const store = new MemoryReceiptStore()
    store.records.set(DeliveryId('delivery-1'), recoverable())
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options)

    await coordinator.recover()

    expect(target.inject).not.toHaveBeenCalled()
    expect(store.get(DeliveryId('delivery-1'))).toMatchObject({ status: 'delivered' })
    expect(store.get(DeliveryId('delivery-1'))).not.toHaveProperty('envelope')
  })

  it('re-enqueues an absent delivery-recovery-pending receipt once with its original exact ID', async () => {
    const target = fakeAgent('target')
    const h = fakeContext([target])
    const store = new MemoryReceiptStore()
    store.records.set(DeliveryId('delivery-1'), recoverable('delivery-recovery-pending'))
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options)

    await coordinator.recover()

    expect(target.inject).toHaveBeenCalledTimes(1)
    expect((target.inject.mock.calls[0]![0] as UserMessage).id).toBe(MessageId('fixed-message'))
    expect(store.get(DeliveryId('delivery-1'))).toMatchObject({ status: 'delivered' })
    expect(store.get(DeliveryId('delivery-1'))).not.toHaveProperty('envelope')
  })

  it('preserves recoverable work when cold persistence cannot prove the exact Message ID absent', async () => {
    const h = fakeContext([])
    h.inspect.mockRejectedValue(new Error('persistence temporarily unavailable'))
    const store = new MemoryReceiptStore()
    store.records.set(DeliveryId('delivery-1'), recoverable())
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options)

    await expect(coordinator.recover()).resolves.toBeUndefined()

    expect(store.writes).toHaveLength(0)
    expect(store.get(DeliveryId('delivery-1'))).toMatchObject({
      status: 'prepared', envelope: { body: 'recover me' },
    })
  })

  it('never terminalizes or drops the envelope when both post-enqueue recovery writes fail', async () => {
    const target = fakeAgent('target')
    const h = fakeContext([target])
    const store = new MemoryReceiptStore()
    store.records.set(DeliveryId('delivery-1'), recoverable())
    store.failPut = receipt => receipt.status === 'delivered'
      || receipt.status === 'delivery-recovery-pending'
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options)

    await expect(coordinator.recover()).resolves.toBeUndefined()

    expect(target.inject).toHaveBeenCalledTimes(1)
    expect(store.get(DeliveryId('delivery-1'))).toMatchObject({
      status: 'prepared', envelope: { body: 'recover me' },
    })
    expect(store.writes.every(receipt => receipt.status !== 'failed')).toBe(true)
  })

  it('uses one bounded recovery timer and stops retrying after disposal', async () => {
    vi.useFakeTimers()
    const h = fakeContext([])
    const store = new MemoryReceiptStore()
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, {
      ...options, installLifecycle: true,
    })
    const recover = vi.spyOn(coordinator, 'recover').mockResolvedValue()

    await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS)
    expect(recover).toHaveBeenCalledTimes(1)

    await coordinator.dispose()
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS * 2)
    expect(recover).toHaveBeenCalledTimes(1)
  })

  it('expires recoverable work before any lookup or enqueue and compacts old settled records', async () => {
    const target = fakeAgent('target')
    const h = fakeContext([target])
    const store = new MemoryReceiptStore()
    const expired = { ...recoverable(), createdAt: now - RECEIPT_TTL_MS, expiresAt: now, updatedAt: now - 1 }
    const oldTerminal: Receipt = {
      id: DeliveryId('old'),
      sourceSessionId: SessionId('source'),
      targetSessionId: SessionId('target'),
      messageId: MessageId('old-message'),
      mode: 'inject',
      status: 'failed' as const,
      settledAt: now - 8 * 24 * 60 * 60 * 1_000,
      updatedAt: now - 8 * 24 * 60 * 60 * 1_000,
      createdAt: now - 9 * 24 * 60 * 60 * 1_000,
      expiresAt: now - 8 * 24 * 60 * 60 * 1_000,
      errorCode: 'delivery-failed',
      replyToken: ReplyToken('old-token'),
      hop: 0,
      wakeRequested: false,
    }
    store.records.set(DeliveryId('delivery-1'), expired)
    store.records.set(DeliveryId('old'), oldTerminal)
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options)
    const transitions: unknown[] = []
    coordinator.subscribe((transition) => { transitions.push(transition) })

    await coordinator.recover()

    expect(target.inject).not.toHaveBeenCalled()
    expect(store.get(DeliveryId('delivery-1'))).toMatchObject({ status: 'expired' })
    expect(store.records.has(DeliveryId('old'))).toBe(false)
    expect(transitions).toContainEqual({
      kind: 'delete',
      deliveryId: DeliveryId('old'),
    })
  })
})
