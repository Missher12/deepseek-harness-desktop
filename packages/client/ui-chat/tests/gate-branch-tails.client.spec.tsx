// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { StatsLine } from '../src/client/chat/StatsLine.tsx'
import { zh } from '../src/client/locale.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

const t: AssistantMarkdownProps['t'] = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})


describe('render branch tails', () => {
  it('AssistantMarkdown reasoning card settles when it is not the streaming tail', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'done thinking' }, { kind: 'text', text: 'answer' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    // reasoning at index 0 with a later block: running is false → ok state.
    expect(view.getByRole('region', { name: '思考内容' }).textContent).toBe('done thinking')
    expect(view.queryByText('运行中')).toBeNull()
  })

  it('StatsLine falls back to window-node counts and keeps unknown metric placeholders without projections', () => {
    // No sessionStats key → the window fold supplies the counts (the
    // assembly-without-the-unit fallback). Node `usage` is deliberately
    // ignored: billing rides the durable tokenUsage projection, so an absent
    // projection keeps the counts with unknown billing placeholders.
    const nodes = [
      { kind: 'assistant', seq: 1, time: 1, turn: 1, step: 1, blocks: [] },
      { kind: 'assistant', seq: 2, time: 2, turn: 1, step: 2, blocks: [], usage: { inputTokens: 4, outputTokens: 6 } },
      { kind: 'assistant', seq: 3, time: 3, turn: 2, step: 1, blocks: [], usage: { inputTokens: 5 } },
    ] as const
    const snap = chatSnapshotFixture({ nodes })
    const source = { getSnapshot: () => snap, subscribe: () => () => {} }
    const view = render(
      <StatsLine
        t={t}
        useChat={bindSnapshotSelector(source)}
        useProjection={() => undefined}
      />,
    )
    expect(view.container.textContent).toBe('2 轮 · 3 步 | LLM — · 工具调用 — | 首 token 平均 — · — tok/s | 缓存命中 —% | 输入 — tok · 输出 — tok')
  })

  it('AssistantMarkdown reasoning card shows running only at the streaming tail', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'still thinking' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.getByRole('region', { name: '思考内容' }).textContent).toBe('still thinking')
    expect(view.getByText('运行中')).toBeTruthy()
  })

})
