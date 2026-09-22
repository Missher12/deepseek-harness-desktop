// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { ReasoningRow } from '../src/client/chat/ReasoningRow.tsx'

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  document.getSelection()?.removeAllRanges()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function message(text: string, streaming = false) {
  return <AssistantMarkdown t={t} blocks={[{ kind: 'reasoning', text }]} streaming={streaming}
    renderMessageImages={renderMessageImages} />
}

function reasoningBody(view: ReturnType<typeof render>): HTMLElement {
  return view.container.querySelector('[data-variant="think"] > div:last-child') as HTMLElement
}

const LITERAL = 'Inspect the session\n  保留空白 👨👩👧👦 é'

describe('ReasoningRow full-length reading', () => {
  it('renders the complete literal text with no reading control of its own', () => {
    const view = render(<ReasoningRow text={LITERAL} running={false} t={t} />)
    const root = view.container.firstElementChild as HTMLElement

    expect(view.getByText('思考')).toBeTruthy()
    expect(root.querySelector('button')).toBeNull()
    expect(root.querySelector('[role="region"]')).toBeNull()
    expect(root.querySelector('[tabindex]')).toBeNull()
    // One heading plus one body: no viewport wrapper, no scrollport, no footer.
    expect(root.children).toHaveLength(2)
    expect(view.container.textContent).toBe(`思考${LITERAL}`)
  })

  it('keeps one appended Text node while new lines arrive and the turn settles', () => {
    const view = render(message(LITERAL, true))
    const body = reasoningBody(view)
    expect(view.getByText('运行中')).toBeTruthy()

    view.rerender(message(`${LITERAL}\nNext step`, false))
    const text = body.firstChild
    expect(text?.textContent).toBe(`${LITERAL}\nNext step`)
    expect(view.queryByText('运行中')).toBeNull()
  })

  it('survives mounting a streaming block, settling, and remounting from history', () => {
    const view = render(message('第一块', true))
    view.rerender(message('第一块\n第二块', false))
    expect(view.container.textContent).toBe('思考第一块\n第二块')
    view.unmount()

    const history = render(message('历史思考\nwith a second line', false))
    expect(history.container.textContent).toBe('思考历史思考\nwith a second line')
    expect(history.container.querySelector('button')).toBeNull()
  })

  it('retains a reader selection across a streaming append', () => {
    const view = render(message('Read this carefully', false))
    const body = reasoningBody(view)
    const range = document.createRange()
    range.setStart(body.firstChild!, 0)
    range.setEnd(body.firstChild!, 'Read this carefully'.length)
    document.getSelection()?.addRange(range)

    view.rerender(message('Read this carefully and retain the selection', false))
    expect(document.getSelection()?.toString()).toBe('Read this carefully')
  })

  it('keeps the body one Text node so the browser owns wrapping and selection', () => {
    const view = render(message(LITERAL, false))
    const body = reasoningBody(view)
    expect(body.textContent).toBe(LITERAL)
    expect(body.querySelectorAll('*')).toHaveLength(0)
  })

  it('replaces the text when a chunk no longer extends the prefix', () => {
    const view = render(message('first draft', false))
    view.rerender(message('second draft', false))
    expect(view.container.textContent).toBe('思考second draft')
  })

  it('keeps no timer or animation work alive after unmount', () => {
    const view = render(message('Quiet reasoning', true))
    act(() => { vi.advanceTimersByTime(2_400) })
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renders reduced-motion and background views as full text', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    try {
      const view = render(message('Reduced motion reasoning', true))
      expect(view.container.textContent).toBe('思考运行中Reduced motion reasoning')
      act(() => { vi.advanceTimersByTime(2_400) })
      expect(vi.getTimerCount()).toBe(0)
    } finally { hidden.mockRestore() }
  })
})

describe('AssistantMarkdown reasoning placement', () => {
  it('keeps reasoning and answer text in received order inside one block list', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'reasoning', text: 'first thought' },
          { kind: 'text', text: 'partial answer' },
          { kind: 'reasoning', text: 'second thought' },
        ]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    const blocks = [...view.container.querySelectorAll('[data-variant="think"], [data-assistant-text]')]
    expect(blocks).toHaveLength(3)
    expect(blocks[0]?.textContent).toContain('first thought')
    expect(blocks[1]?.textContent).toContain('partial answer')
    expect(blocks[2]?.textContent).toContain('second thought')
  })

  it('marks only the last reasoning block of a streaming message as running', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'reasoning', text: 'settled thought' },
          { kind: 'reasoning', text: 'live thought' },
        ]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    const running = view.container.querySelectorAll('[data-state="running"] [data-reasoning-full]')
    expect(running).toHaveLength(1)
    expect(running[0]?.getAttribute('data-reasoning-full')).toBe('live thought')
    const settled = view.container.querySelectorAll('[data-state="ok"] [data-reasoning-full]')
    expect(settled).toHaveLength(1)
    expect(settled[0]?.getAttribute('data-reasoning-full')).toBe('settled thought')
  })
})
