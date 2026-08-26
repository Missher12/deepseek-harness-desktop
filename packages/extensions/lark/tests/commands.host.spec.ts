import { describe, expect, test, vi } from 'vitest'
import { CommandRouter, type AdmittedMessage } from '../src/commands.ts'

function message(text: string): AdmittedMessage {
  return { eventId: `event:${text}`, messageId: `message:${text}`, openId: 'ou_owner', chatId: 'oc_dm', text }
}

function harness(admission: 'owner' | 'unpaired' | 'rejected' = 'owner') {
  const transport = { sendText: vi.fn(async (_chatId: string, _text: string) => ({ messageId: 'om_1', chatId: 'oc_dm' })) }
  const cards = { sendProjectCard: vi.fn(async () => {}) }
  const commandCenter = {
    send: vi.fn(async () => {}),
    handleText: vi.fn(async (): Promise<'handled' | 'enqueue' | 'unknown'> => 'unknown'),
  }
  const binding = {
    unbind: vi.fn(async () => {}),
    statusText: vi.fn(async () => '已绑定 /project · session-1'),
  }
  const inbox = {
    enqueue: vi.fn(async (): Promise<'accepted' | 'duplicate' | 'unbound'> => 'accepted'),
    steer: vi.fn(async () => {}), stop: vi.fn(async () => {}),
  }
  const identity = {
    admit: vi.fn(async () => admission === 'owner'
      ? { kind: 'owner' as const, message: message('/') }
      : admission === 'unpaired'
        ? { kind: 'unpaired' as const, chatId: 'oc_dm', pairingCode: 'ABCD-1234' }
        : { kind: 'rejected' as const }),
  }
  const prepareOwnerMessage = vi.fn(async (input: AdmittedMessage) => input.media === undefined
    ? input
    : { ...input, text: `${input.text}:prepared` })
  return {
    router: new CommandRouter({ transport, cards, commandCenter, binding, inbox, identity, prepareOwnerMessage }),
    transport, cards, commandCenter, binding, inbox, prepareOwnerMessage,
  }
}

describe('exact slash routing', () => {
  test('exact / opens the complete command center without touching the Agent inbox', async () => {
    const h = harness()
    await h.router.message(message('/'))
    expect(h.commandCenter.send).toHaveBeenCalledOnce()
    expect(h.cards.sendProjectCard).not.toHaveBeenCalled()
    expect(h.inbox.enqueue).not.toHaveBeenCalled()
    expect(h.inbox.steer).not.toHaveBeenCalled()
  })

  test.each(['/进入', '/切换'])('%s opens project selection without touching the Agent inbox', async (text) => {
    const h = harness()
    await h.router.message({ ...message(text), text })
    expect(h.cards.sendProjectCard).toHaveBeenCalledOnce()
    expect(h.commandCenter.send).not.toHaveBeenCalled()
    expect(h.inbox.enqueue).not.toHaveBeenCalled()
  })

  test('menu 进入项目 takes the same no-model fast path', async () => {
    const h = harness()
    await h.router.menuAction({ ...message('进入项目'), text: '进入项目' })
    expect(h.cards.sendProjectCard).toHaveBeenCalledOnce()
    expect(h.inbox.enqueue).not.toHaveBeenCalled()
  })

  test('supports unbind, status, command-center help, steer, and stop', async () => {
    const h = harness()
    await h.router.message({ ...message('/解绑'), text: '/解绑' })
    await h.router.message({ ...message('/状态'), text: '/状态' })
    await h.router.message({ ...message('/帮助'), text: '/帮助' })
    await h.router.message({ ...message('/插话 fix now'), text: '/插话 fix now' })
    await h.router.message({ ...message('/停止'), text: '/停止' })
    expect(h.binding.unbind).toHaveBeenCalledOnce()
    expect(h.binding.statusText).toHaveBeenCalledOnce()
    expect(h.commandCenter.send).toHaveBeenCalledOnce()
    expect(h.inbox.steer).toHaveBeenCalledWith('fix now')
    expect(h.inbox.stop).toHaveBeenCalledOnce()
  })

  test('delegates supported Harness commands and durably enqueues an admitted skill invocation', async () => {
    const h = harness()
    h.commandCenter.handleText
      .mockResolvedValueOnce('handled')
      .mockResolvedValueOnce('enqueue')
    const model = { ...message('/模型'), text: '/模型' }
    const skill = { ...message('/review-code now'), text: '/review-code now' }
    await h.router.message(model)
    await h.router.message(skill)
    expect(h.commandCenter.handleText).toHaveBeenNthCalledWith(1, model, '/模型')
    expect(h.commandCenter.handleText).toHaveBeenNthCalledWith(2, skill, '/review-code now')
    expect(h.inbox.enqueue).toHaveBeenCalledOnce()
    expect(h.inbox.enqueue).toHaveBeenCalledWith(skill)
  })

  test('ordinary text is queued as its own durable turn', async () => {
    const h = harness()
    await h.router.message(message('continue development'))
    expect(h.inbox.enqueue).toHaveBeenCalledWith(message('continue development'))
  })

  test('ordinary text before Session binding receives actionable guidance', async () => {
    const h = harness()
    h.inbox.enqueue.mockResolvedValueOnce('unbound')
    h.binding.statusText.mockResolvedValueOnce('尚未绑定项目和会话。发送 / 进入选择。')

    await h.router.message(message('continue development'))

    expect(h.transport.sendText).toHaveBeenCalledWith(
      'oc_dm',
      '尚未绑定项目和会话。发送 / 进入选择。',
    )
  })

  test('prepares media only after owner admission and before durable enqueue', async () => {
    const h = harness()
    const input: AdmittedMessage = {
      ...message('image'), media: { kind: 'image', key: 'img_1', name: 'image.png' },
    }
    await h.router.message(input)
    expect(h.prepareOwnerMessage).toHaveBeenCalledWith(input)
    expect(h.inbox.enqueue).toHaveBeenCalledWith({ ...input, text: 'image:prepared' })
  })

  test('an unpaired private user receives only a short pairing response', async () => {
    const h = harness('unpaired')
    await h.router.message(message('/'))
    expect(h.transport.sendText).toHaveBeenCalledWith('oc_dm', expect.stringMatching(/ABCD-1234/))
    expect(h.transport.sendText.mock.calls[0]![1]).not.toMatch(/project|session|Users|项目|会话/)
    expect(h.cards.sendProjectCard).not.toHaveBeenCalled()
    expect(h.prepareOwnerMessage).not.toHaveBeenCalled()
  })

  test('rejected events produce no output', async () => {
    const h = harness('rejected')
    await h.router.message(message('/'))
    expect(h.transport.sendText).not.toHaveBeenCalled()
    expect(h.cards.sendProjectCard).not.toHaveBeenCalled()
    expect(h.commandCenter.send).not.toHaveBeenCalled()
    expect(h.prepareOwnerMessage).not.toHaveBeenCalled()
  })
})
