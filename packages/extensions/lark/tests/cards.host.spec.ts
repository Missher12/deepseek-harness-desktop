import { describe, expect, test, vi } from 'vitest'
import { StreamingCardController, renderTurnCard } from '../src/cards.ts'
import type { TurnProjectionState } from '../src/projection.ts'

const state = (text: string, status: TurnProjectionState['status'] = 'streaming'): TurnProjectionState => ({
  sessionId: 'session-1', turn: 1, status, text, tools: [], approvals: [],
  startedAt: 1000, elapsedMs: 500,
})

describe('monotonic streaming card', () => {
  test('paints one stable placeholder, then grows text and final metrics', async () => {
    const sendCard = vi.fn(async () => ({ messageId: 'om_card', chatId: 'oc_dm' }))
    const updateCard = vi.fn(async () => {})
    const sendText = vi.fn(async () => ({}))
    let now = 1000
    const controller = new StreamingCardController({
      sendCard, updateCard, sendText, throttleMs: 100,
      now: () => now, sleep: async (ms) => { now += ms },
    })
    const stream = await controller.open('oc_dm', state('', 'placeholder'))
    await stream.update(state('Hel'))
    await stream.update(state('Hello'))
    await stream.update({
      ...state('Hello', 'completed'), elapsedMs: 1500,
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 },
    }, true)
    expect(sendCard).toHaveBeenCalledOnce()
    expect(updateCard).toHaveBeenCalledTimes(3)
    const payloads = updateCard.mock.calls.map(call => JSON.stringify(call[1]))
    expect(payloads[0]).toContain('Hel')
    expect(payloads[1]).toContain('Hello')
    expect(payloads[2]).toContain('17')
    expect(payloads[2]).toContain('1.5s')
    expect(sendText).not.toHaveBeenCalled()
  })

  test('ignores shrinking or stale revisions', async () => {
    const updateCard = vi.fn(async () => {})
    const controller = new StreamingCardController({
      sendCard: vi.fn(async () => ({ messageId: 'om_card', chatId: 'oc_dm' })),
      updateCard, sendText: vi.fn(async () => ({})), throttleMs: 0,
    })
    const stream = await controller.open('oc_dm', state('Hello'))
    await stream.update(state('Hel'))
    await stream.update(state('Hello!'))
    expect(updateCard).toHaveBeenCalledOnce()
    expect(JSON.stringify(updateCard.mock.calls[0]![1])).toContain('Hello!')
  })

  test('falls back to bounded text after card update failure', async () => {
    const sendText = vi.fn(async () => ({}))
    const controller = new StreamingCardController({
      sendCard: vi.fn(async () => ({ messageId: 'om_card', chatId: 'oc_dm' })),
      updateCard: vi.fn(async () => { throw new Error('card unavailable') }),
      sendText, throttleMs: 0,
    })
    const stream = await controller.open('oc_dm', state(''))
    await stream.update(state('x'.repeat(20_000)), true)
    expect(sendText).toHaveBeenCalledOnce()
    expect(sendText.mock.calls[0]![1].length).toBeLessThanOrEqual(4000)
  })

  test('renders unavailable usage truthfully', () => {
    expect(JSON.stringify(renderTurnCard(state('working')))).toContain('暂不可用')
  })
})
