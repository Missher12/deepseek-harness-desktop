import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionMessengerCoordinator, type CoordinatorOptions } from '../src/coordinator.ts'
import { SessionReplyWaiter } from '../src/waits.ts'
import { MAX_HOP, RECEIPT_TTL_MS } from '../src/spec.ts'
import {
  DeliveryId,
  ReplyToken,
  type DeliveredReceipt,
  type Receipt,
} from '../src/types.ts'
import { fakeAgent, fakeContext, MemoryReceiptStore } from './helpers.ts'

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
    'consumes a valid token once and uses wake=%s through %s', async (wake, method) => {
      const source = fakeAgent('source')
      const target = fakeAgent('target')
      const h = fakeContext([source, target])
      const store = new MemoryReceiptStore()
      store.records.set(DeliveryId('original'), delivered())
      const coordinator = new SessionMessengerCoordinator(h.ctx as never, store, options(() => 2_000))

      const result = await coordinator.reply(target, {
        deliveryId: DeliveryId('original'), replyToken: ReplyToken('secret-token'), message: 'answer', wake,
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
      await expect(coordinator.reply(target, {
        deliveryId: DeliveryId('original'), replyToken: ReplyToken('secret-token'), message: 'again', wake,
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
    let listener: ((receipt: Receipt) => void) | undefined
    const source = {
      receipt: (id: DeliveryId) => records.get(id),
      subscribe: (next: (receipt: Receipt) => void) => {
        listener = next
        records.set(DeliveryId('original'), replied)
        records.set(DeliveryId('reply'), reverse)
        return vi.fn()
      },
    }
    const waiter = new SessionReplyWaiter(source)

    listener?.(delivered({ id: DeliveryId('unrelated') }))
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
})
