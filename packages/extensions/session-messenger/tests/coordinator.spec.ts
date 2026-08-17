import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  SessionMessengerCoordinator,
  type CoordinatorOptions,
} from '../src/coordinator.ts'
import { DeliveryId, ReplyToken } from '../src/types.ts'
import { fakeAgent, fakeContext, MemoryReceiptStore } from './helpers.ts'

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
      source: { kind: 'plugin', plugin: 'dsh-session-messenger', form: 'relay' },
    })
    const text = deliveredMessage.content[0]
    expect(text?.type).toBe('text')
    if (text?.type !== 'text') throw new Error('expected relay text block')
    expect(text.text).toContain('Source Session: caller')
    expect(text.text).toContain('Delivery ID: delivery-1')
    expect(text.text).toContain('Reply Token: token-1')
    expect(text.text).toContain('hello')
    expect(Object.isFrozen(deliveredMessage)).toBe(true)
    expect(store.writes.map(receipt => receipt.status)).toEqual(['prepared', 'delivered'])
    expect(store.get(DeliveryId('delivery-1'))).not.toHaveProperty('envelope')
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
