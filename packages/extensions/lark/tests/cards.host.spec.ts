import { afterEach, describe, expect, test, vi } from 'vitest'
import { StreamingCardController, renderTurnCard } from '../src/cards.ts'
import type { TurnProjectionState } from '../src/projection.ts'

const state = (text: string, status: TurnProjectionState['status'] = 'streaming'): TurnProjectionState => ({
  sessionId: 'session-1', turn: 1, status, text, tools: [], approvals: [],
  startedAt: 1000, elapsedMs: 500,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('monotonic streaming card', () => {
  test('coalesces intermediate revisions and flushes terminal facts immediately', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const sendCard = vi.fn(async () => ({ messageId: 'om_card', chatId: 'oc_dm' }))
    const updateCard = vi.fn(async (_messageId: string, _card: unknown) => {})
    const sendText = vi.fn(async (_chatId: string, _text: string) => ({}))
    const controller = new StreamingCardController({
      sendCard, updateCard, sendText, throttleMs: 100,
    })
    const stream = await controller.open('oc_dm', state('', 'placeholder'))
    void stream.update(state('Hel'))
    void stream.update(state('Hello'))
    expect(updateCard).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(updateCard).toHaveBeenCalledOnce()
    expect(JSON.stringify(updateCard.mock.calls[0]![1])).toContain('Hello')
    await vi.advanceTimersByTimeAsync(100)
    expect(updateCard).toHaveBeenCalledOnce()

    await stream.update({
      ...state('Hello', 'completed'), elapsedMs: 1500,
      model: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 },
      approvals: [{
        approvalId: 'approval-1', toolName: 'bash', status: 'pending',
        allowValue: { action: 'approve-once' }, denyValue: { action: 'deny' },
      }],
    }, true)
    expect(sendCard).toHaveBeenCalledOnce()
    expect(updateCard).toHaveBeenCalledTimes(2)
    const payloads = updateCard.mock.calls.map(call => JSON.stringify(call[1]))
    expect(payloads[1]).toContain('17')
    expect(payloads[1]).toContain('1.5s')
    expect(payloads[1]).toContain('deepseek-v4-flash')
    expect(payloads[1]).toContain('deepseek')
    expect(payloads[1]).toContain('max')
    expect(payloads[1]).toContain('↑ 10')
    expect(payloads[1]).toContain('↓ 5')
    expect(payloads[1]).toContain('缓存 2/0')
    expect(payloads[1]).toContain('允许一次')
    expect(payloads[1]).toContain('拒绝')
    expect(sendText).not.toHaveBeenCalled()
  })

  test('delivers the newest final state after at most one in-flight update', async () => {
    let releaseFirst!: () => void
    const updateCard = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirst = resolve }))
      .mockResolvedValue(undefined)
    const controller = new StreamingCardController({
      sendCard: vi.fn(async () => ({ messageId: 'om_card', chatId: 'oc_dm' })),
      updateCard, sendText: vi.fn(async () => ({})), throttleMs: 0,
    })
    const stream = await controller.open('oc_dm', state(''))
    void stream.update(state('A'))
    await vi.waitFor(() => { expect(updateCard).toHaveBeenCalledOnce() })
    void stream.update(state('AB'))
    const final = stream.update(state('ABC', 'completed'), true)
    expect(updateCard).toHaveBeenCalledOnce()
    releaseFirst()
    await final
    expect(updateCard).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(updateCard.mock.calls[1]![1])).toContain('ABC')
    expect(JSON.stringify(updateCard.mock.calls[1]![1])).toContain('已完成')
  })

  test('cancels a deferred update when the stream stops', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const updateCard = vi.fn(async () => {})
    const controller = new StreamingCardController({
      sendCard: vi.fn(async () => ({ messageId: 'om_card', chatId: 'oc_dm' })),
      updateCard, sendText: vi.fn(async () => ({})), throttleMs: 100,
    })
    const stream = await controller.open('oc_dm', state(''))
    void stream.update(state('waiting'))
    stream.stop()
    await vi.advanceTimersByTimeAsync(100)
    expect(updateCard).not.toHaveBeenCalled()
  })

  test('ignores shrinking or stale revisions', async () => {
    const updateCard = vi.fn(async (_messageId: string, _card: unknown) => {})
    const controller = new StreamingCardController({
      sendCard: vi.fn(async () => ({ messageId: 'om_card', chatId: 'oc_dm' })),
      updateCard, sendText: vi.fn(async (_chatId: string, _text: string) => ({})), throttleMs: 0,
    })
    const stream = await controller.open('oc_dm', state('Hello'))
    await stream.update(state('Hel'))
    await stream.update(state('Hello!'))
    expect(updateCard).toHaveBeenCalledOnce()
    expect(JSON.stringify(updateCard.mock.calls[0]![1])).toContain('Hello!')
  })

  test('falls back to bounded text after card update failure', async () => {
    const sendText = vi.fn(async (_chatId: string, _text: string) => ({}))
    const controller = new StreamingCardController({
      sendCard: vi.fn(async () => ({ messageId: 'om_card', chatId: 'oc_dm' })),
      updateCard: vi.fn(async (_messageId: string, _card: unknown) => { throw new Error('card unavailable') }),
      sendText, throttleMs: 0,
    })
    const stream = await controller.open('oc_dm', state(''))
    await stream.update(state('x'.repeat(20_000)), true)
    await stream.update(state(`${'x'.repeat(20_000)}y`), true)
    expect(sendText).toHaveBeenCalledOnce()
    expect(sendText.mock.calls[0]![1].length).toBeLessThanOrEqual(4000)
  })

  test('renders unavailable usage truthfully', () => {
    expect(JSON.stringify(renderTurnCard(state('working')))).toContain('暂不可用')
  })
})
