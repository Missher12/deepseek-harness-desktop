import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  SessionMessengerCoordinator,
  type CoordinatorOptions,
} from '../src/coordinator.ts'
import { DeliveryId, ReplyToken } from '../src/types.ts'
import { fakeAgent, fakeContext, MemoryReceiptStore } from './helpers.client.ts'

function options(now = 1_000): CoordinatorOptions {
  let delivery = 0
  let message = 0
  let token = 0
  return {
    now: () => now,
    nextDeliveryId: () => DeliveryId(`delivery-${++delivery}`),
    nextMessageId: () => MessageId(`message-${++message}`),
    nextReplyToken: () => ReplyToken(`token-${++token}`),
    installLifecycle: false,
  }
}

describe('SessionMessengerCoordinator delivery', () => {
  it('stops a receipt-bound collaboration chain for either participant and leaves a fresh send available', async () => {
    const caller = fakeAgent('caller')
    const target = fakeAgent('target')
    const h = fakeContext([caller, target])
    const store = new MemoryReceiptStore()
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options())

    const first = await coordinator.deliver(caller, {
      targetSessionId: 'target', message: 'start', mode: 'followup',
    })
    const reply = await coordinator.replyToDelivery(target, {
      deliveryId: first.deliveryId, message: 'answer', wake: true,
    })
    const stopped = await coordinator.stopCollaboration(caller, reply.deliveryId)

    expect(stopped).toMatchObject({
      deliveryId: reply.deliveryId,
      rootDeliveryId: first.deliveryId,
      status: 'stopped',
    })
    expect(store.get(first.deliveryId)).toMatchObject({ collaborationStoppedAt: 1_000 })
    expect(store.get(reply.deliveryId)).toMatchObject({
      status: 'aborted', errorCode: 'collaboration-stopped', collaborationStoppedAt: 1_000,
    })
    const writesAfterStop = store.writes.length
    await expect(coordinator.stopCollaboration(target, first.deliveryId)).resolves.toMatchObject({
      deliveryId: first.deliveryId,
      rootDeliveryId: first.deliveryId,
      status: 'stopped',
      stoppedAt: stopped.stoppedAt,
    })
    expect(store.writes).toHaveLength(writesAfterStop)
    await expect(coordinator.replyToDelivery(caller, {
      deliveryId: reply.deliveryId, message: 'must not continue', wake: true,
    })).rejects.toMatchObject({ code: 'collaboration-stopped' })
    await expect(coordinator.stopCollaboration(fakeAgent('stranger'), first.deliveryId))
      .rejects.toMatchObject({ code: 'reply-forbidden' })
    expect(store.writes).toHaveLength(writesAfterStop)

    const fresh = await coordinator.deliver(caller, {
      targetSessionId: 'target', message: 'new explicit chain', mode: 'followup',
    })
    expect(fresh.deliveryId).toBe(DeliveryId('delivery-3'))
    expect(store.get(fresh.deliveryId)).not.toHaveProperty('collaborationStoppedAt')
  })

  it('links an explicit continuation to the trusted prior delivery and rejects it after stop', async () => {
    const caller = fakeAgent('caller')
    const target = fakeAgent('target')
    const h = fakeContext([caller, target])
    const store = new MemoryReceiptStore()
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options())
    const first = await coordinator.deliver(caller, {
      targetSessionId: 'target', message: 'start', mode: 'followup',
    })
    const next = await coordinator.deliver(target, {
      targetSessionId: 'caller', message: 'continue', mode: 'followup',
      continuationOfDeliveryId: first.deliveryId,
    })

    expect(store.get(next.deliveryId)).toMatchObject({
      continuationOfDeliveryId: first.deliveryId,
      hop: 1,
    })
    await coordinator.stopCollaboration(target, next.deliveryId)
    await expect(coordinator.deliver(caller, {
      targetSessionId: 'target', message: 'blocked continuation', mode: 'followup',
      continuationOfDeliveryId: next.deliveryId,
    })).rejects.toMatchObject({ code: 'collaboration-stopped' })
  })

  it('stops a valid chain even when an unrelated retained receipt has a missing parent', async () => {
    const caller = fakeAgent('caller')
    const target = fakeAgent('target')
    const h = fakeContext([caller, target])
    const store = new MemoryReceiptStore()
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options())
    const delivery = await coordinator.deliver(caller, {
      targetSessionId: 'target', message: 'valid chain', mode: 'followup',
    })
    store.records.set(DeliveryId('orphan'), {
      ...store.get(delivery.deliveryId)!,
      id: DeliveryId('orphan'),
      continuationOfDeliveryId: DeliveryId('missing-parent'),
    })

    await expect(coordinator.stopCollaboration(target, delivery.deliveryId)).resolves.toMatchObject({
      rootDeliveryId: delivery.deliveryId,
      status: 'stopped',
    })
    expect(store.get(delivery.deliveryId)).toMatchObject({
      status: 'aborted', errorCode: 'collaboration-stopped',
    })
    expect(store.get(DeliveryId('orphan'))).not.toHaveProperty('collaborationStoppedAt')
  })

  it.each([
    ['idle', 'inject'],
    ['running', 'inject'],
    ['idle', 'followup'],
    ['running', 'followup'],
  ] as const)('routes %s targets through exact %s semantics and a fixed frozen Message ID', async (status, mode) => {
    const caller = fakeAgent('caller')
    const target = fakeAgent('target', { status })
    const h = fakeContext([caller, target])
    const store = new MemoryReceiptStore()
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options())

    const result = await coordinator.deliver(caller, {
      targetSessionId: 'target',
      message: 'hello',
      mode,
    })

    expect(result).toEqual({
      deliveryId: DeliveryId('delivery-1'),
      messageId: MessageId('message-1'),
      status: 'delivered',
      wakeRequested: mode === 'followup',
    })
    const selected = mode === 'inject' ? target.inject : target.followup
    const unselected = mode === 'inject' ? target.followup : target.inject
    expect(selected).toHaveBeenCalledTimes(1)
    expect(unselected).not.toHaveBeenCalled()
    const deliveredMessage = selected.mock.calls[0]![0] as UserMessage
    expect(deliveredMessage).toMatchObject({
      id: MessageId('message-1'),
      role: 'user',
      source: {
        kind: 'plugin',
        plugin: 'dsh-session-messenger',
        form: 'relay',
        senderSessionId: SessionId('caller'),
        deliveryId: DeliveryId('delivery-1'),
        mode,
        bodyBlockIndex: 1,
      },
    })
    const metadata = deliveredMessage.content[0]
    expect(metadata?.type).toBe('text')
    if (metadata?.type !== 'text') throw new Error('expected relay metadata text block')
    expect(metadata.text).toContain('Source Session: caller')
    expect(metadata.text).toContain('Delivery ID: delivery-1')
    expect(metadata.text).not.toContain('Reply Token')
    expect(deliveredMessage.content[1]).toEqual({ type: 'text', text: 'hello' })
    expect(JSON.stringify(deliveredMessage)).not.toContain('token-1')
    expect(Object.isFrozen(deliveredMessage)).toBe(true)
    expect(store.writes.map(receipt => receipt.status)).toEqual(['prepared', 'delivered'])
    expect(store.get(DeliveryId('delivery-1'))).not.toHaveProperty('envelope')
    expect(caller.session.append).toHaveBeenCalledWith('session-messenger/outgoing', {
      deliveryId: DeliveryId('delivery-1'),
      targetSessionId: SessionId('target'),
      body: 'hello',
      status: 'delivered',
      wakeRequested: mode === 'followup',
    }, { ignorable: true })
    expect(target.whenIdle).not.toHaveBeenCalled()
    expect(h.ctx.agents.resume).not.toHaveBeenCalled()
  })

  it('serializes concurrent deliveries so target FIFO matches write-ahead order', async () => {
    const caller = fakeAgent('caller')
    const target = fakeAgent('target', { status: 'running' })
    const h = fakeContext([caller, target])
    const store = new MemoryReceiptStore()
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options())

    await Promise.all([
      coordinator.deliver(caller, { targetSessionId: 'target', message: 'first', mode: 'followup' }),
      coordinator.deliver(caller, { targetSessionId: 'target', message: 'second', mode: 'followup' }),
    ])

    expect(target.followup.mock.calls.map(call => (call[0] as UserMessage).id)).toEqual([
      MessageId('message-1'), MessageId('message-2'),
    ])
    expect(store.writes.map(receipt => `${receipt.id}:${receipt.status}`)).toEqual([
      'delivery-1:prepared', 'delivery-1:delivered',
      'delivery-2:prepared', 'delivery-2:delivered',
    ])
    expect(target.whenIdle).not.toHaveBeenCalled()
  })

  it('settles a prepared receipt as rejected when the third archive fence loses the race', async () => {
    const caller = fakeAgent('caller')
    const target = fakeAgent('target')
    const h = fakeContext([caller, target])
    const store = new MemoryReceiptStore()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const preparedStarted = new Promise<void>((resolve) => { entered = resolve })
    store.beforePut = async (receipt) => {
      if (receipt.status === 'prepared') {
        entered()
        await gate
      }
    }
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options())
    const delivery = coordinator.deliver(caller, {
      targetSessionId: 'target', message: 'race', mode: 'inject',
    })
    await preparedStarted
    h.ctx.workspaceRegistry.archivedSessionIds.push(SessionId('target'))
    release()

    await expect(delivery).rejects.toMatchObject({ code: 'target-archived' })
    expect(caller.session.append).not.toHaveBeenCalled()
    expect(target.inject).not.toHaveBeenCalled()
    expect(store.writes.map(receipt => receipt.status)).toEqual(['prepared', 'rejected'])
    expect(store.get(DeliveryId('delivery-1'))).toMatchObject({
      status: 'rejected', errorCode: 'target-archived',
    })
    expect(store.get(DeliveryId('delivery-1'))).not.toHaveProperty('envelope')
  })

  it('makes handled enqueue rejection terminal before returning', async () => {
    const caller = fakeAgent('caller')
    const target = fakeAgent('target')
    target.inject.mockImplementation(() => { throw new Error('queue closed') })
    const h = fakeContext([caller, target])
    const store = new MemoryReceiptStore()
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options())

    await expect(coordinator.deliver(caller, {
      targetSessionId: 'target', message: 'hello', mode: 'inject',
    })).rejects.toMatchObject({ code: 'delivery-failed' })
    expect(store.writes.map(receipt => receipt.status)).toEqual(['prepared', 'failed'])
    expect(store.get(DeliveryId('delivery-1'))).not.toHaveProperty('envelope')
  })

  it('returns recovery-pending instead of a false no-side-effect failure after enqueue', async () => {
    const caller = fakeAgent('caller')
    const target = fakeAgent('target')
    const h = fakeContext([caller, target])
    const store = new MemoryReceiptStore()
    let failed = false
    store.failPut = receipt => receipt.status === 'delivered' && !(failed = false)
    store.failPut = (receipt) => {
      if (receipt.status !== 'delivered' || failed) return false
      failed = true
      return true
    }
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options())

    await expect(coordinator.deliver(caller, {
      targetSessionId: 'target', message: 'hello', mode: 'inject',
    })).resolves.toMatchObject({ status: 'delivery-recovery-pending' })
    expect(target.inject).toHaveBeenCalledTimes(1)
    expect(store.get(DeliveryId('delivery-1'))).toMatchObject({
      status: 'delivery-recovery-pending',
      envelope: { body: 'hello' },
    })
  })

  it('enforces the per-source rate and profile unresolved caps before target mutation', async () => {
    const caller = fakeAgent('caller')
    const target = fakeAgent('target')
    const h = fakeContext([caller, target])
    const store = new MemoryReceiptStore()
    const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options())
    for (let i = 0; i < 30; i += 1) {
      await coordinator.deliver(caller, { targetSessionId: 'target', message: String(i), mode: 'inject' })
    }
    await expect(coordinator.deliver(caller, {
      targetSessionId: 'target', message: 'too fast', mode: 'inject',
    })).rejects.toMatchObject({ code: 'rate-limited' })
    expect(target.inject).toHaveBeenCalledTimes(30)

    const anotherCaller = fakeAgent('another')
    const capped = new MemoryReceiptStore()
    for (let i = 0; i < 256; i += 1) {
      const base = store.entries()[0]![1]
      capped.records.set(DeliveryId(`cap-${i}`), {
        ...base,
        id: DeliveryId(`cap-${i}`),
        messageId: MessageId(`cap-message-${i}`),
        sourceSessionId: SessionId(`source-${i}`),
      })
    }
    const capCoordinator = new SessionMessengerCoordinator(h.ctx as never, capped, options())
    await expect(capCoordinator.deliver(anotherCaller, {
      targetSessionId: 'target', message: 'full', mode: 'inject',
    })).rejects.toMatchObject({ code: 'too-many-unresolved' })
  })
})
