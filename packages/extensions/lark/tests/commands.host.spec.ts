import { describe, expect, test, vi } from 'vitest'
import { CommandRouter, type AdmittedMessage } from '../src/commands.ts'

function message(text: string): AdmittedMessage {
  return { eventId: `event:${text}`, messageId: `message:${text}`, openId: 'ou_owner', chatId: 'oc_dm', text }
}

function harness(admission: 'owner' | 'unpaired' | 'rejected' = 'owner') {
  const transport = { sendText: vi.fn(async () => ({ messageId: 'om_1', chatId: 'oc_dm' })) }
  const cards = { sendProjectCard: vi.fn(async () => {}) }
  const binding = {
    unbind: vi.fn(async () => {}),
    statusText: vi.fn(async () => '已绑定 /project · session-1'),
  }
  const inbox = {
    enqueue: vi.fn(async () => {}), steer: vi.fn(async () => {}), stop: vi.fn(async () => {}),
  }
  const identity = {
    admit: vi.fn(async () => admission === 'owner'
      ? { kind: 'owner' as const, message: message('/') }
      : admission === 'unpaired'
        ? { kind: 'unpaired' as const, chatId: 'oc_dm', pairingCode: 'ABCD-1234' }
        : { kind: 'rejected' as const }),
  }
  return { router: new CommandRouter({ transport, cards, binding, inbox, identity }), transport, cards, binding, inbox }
}

describe('exact slash routing', () => {
  test.each(['/', '/进入'])('%s opens project selection without touching the Agent inbox', async (text) => {
    const h = harness()
    await h.router.message({ ...message(text), text })
    expect(h.cards.sendProjectCard).toHaveBeenCalledOnce()
    expect(h.inbox.enqueue).not.toHaveBeenCalled()
    expect(h.inbox.steer).not.toHaveBeenCalled()
  })

  test('menu 进入项目 takes the same no-model fast path', async () => {
    const h = harness()
    await h.router.menuAction({ ...message('进入项目'), text: '进入项目' })
    expect(h.cards.sendProjectCard).toHaveBeenCalledOnce()
    expect(h.inbox.enqueue).not.toHaveBeenCalled()
  })

  test('supports switch, unbind, status, help, steer, and stop', async () => {
    const h = harness()
    await h.router.message({ ...message('/切换'), text: '/切换' })
    await h.router.message({ ...message('/解绑'), text: '/解绑' })
    await h.router.message({ ...message('/状态'), text: '/状态' })
    await h.router.message({ ...message('/帮助'), text: '/帮助' })
    await h.router.message({ ...message('/插话 fix now'), text: '/插话 fix now' })
    await h.router.message({ ...message('/停止'), text: '/停止' })
    expect(h.cards.sendProjectCard).toHaveBeenCalledOnce()
    expect(h.binding.unbind).toHaveBeenCalledOnce()
    expect(h.binding.statusText).toHaveBeenCalledOnce()
    expect(h.inbox.steer).toHaveBeenCalledWith('fix now')
    expect(h.inbox.stop).toHaveBeenCalledOnce()
  })

  test('ordinary text is queued as its own durable turn', async () => {
    const h = harness()
    await h.router.message(message('continue development'))
    expect(h.inbox.enqueue).toHaveBeenCalledWith(message('continue development'))
  })

  test('an unpaired private user receives only a short pairing response', async () => {
    const h = harness('unpaired')
    await h.router.message(message('/'))
    expect(h.transport.sendText).toHaveBeenCalledWith('oc_dm', expect.stringMatching(/ABCD-1234/))
    expect(h.transport.sendText.mock.calls[0]![1]).not.toMatch(/project|session|Users|项目|会话/)
    expect(h.cards.sendProjectCard).not.toHaveBeenCalled()
  })

  test('rejected events produce no output', async () => {
    const h = harness('rejected')
    await h.router.message(message('/'))
    expect(h.transport.sendText).not.toHaveBeenCalled()
    expect(h.cards.sendProjectCard).not.toHaveBeenCalled()
  })
})
