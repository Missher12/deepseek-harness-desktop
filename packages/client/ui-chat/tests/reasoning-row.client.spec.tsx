// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null
let resize: ResizeObserverCallback
let disconnect: ReturnType<typeof vi.fn>
let reducedMotion = false
let motionChange: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
  reducedMotion = false
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return reducedMotion },
    addEventListener: (_name: string, callback: () => void) => { motionChange = callback },
    removeEventListener: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  document.getSelection()?.removeAllRanges()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  motionChange = undefined
})

function message(text: string, streaming = true) {
  return <AssistantMarkdown t={t} blocks={[{ kind: 'reasoning', text }]} streaming={streaming}
    renderMessageImages={renderMessageImages} />
}

function overflow(view: ReturnType<typeof render>) {
  const port = view.getByRole('region', { name: '思考内容' })
  Object.defineProperties(port, {
    scrollHeight: { configurable: true, value: 500 },
    clientHeight: { configurable: true, value: 100 },
  })
  const text = port.firstElementChild as HTMLElement
  text.style.lineHeight = '20px'
  const scrollTo = vi.fn((options?: ScrollToOptions | number, y?: number) => {
    port.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? 0
  })
  port.scrollTo = scrollTo
  act(() => { resize([], {} as ResizeObserver) })
  return { port, text, scrollTo }
}

describe('ReasoningRow', () => {
  it('keeps one literal transcript while new lines arrive and the turn settles', () => {
    const original = 'Inspect the session\n  保留空白 👨‍👩‍👧‍👦 é'
    const view = render(message(original))
    const port = view.getByRole('region', { name: '思考内容' })
    const text = port.firstElementChild
    expect(text?.textContent).toBe(original)
    expect(view.getByText('运行中')).toBeTruthy()
    view.rerender(message(original + '\nNext step'))
    expect(port.firstElementChild).toBe(text)
    expect(text?.textContent).toBe(original + '\nNext step')
    view.rerender(message(original + '\nNext step', false))
    expect(text?.textContent).toBe(original + '\nNext step')
    expect(view.queryByText('运行中')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('follows at most two real lines per tick, pauses for manual reading, and resumes explicitly', () => {
    const view = render(message('One\nTwo\nThree'))
    const { port, scrollTo } = overflow(view)
    act(() => { vi.advanceTimersByTime(800) })
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 40, behavior: 'smooth' })
    fireEvent.wheel(port)
    const paused = port.scrollTop
    act(() => { vi.advanceTimersByTime(2400) })
    expect(port.scrollTop).toBe(paused)
    fireEvent.click(view.getByRole('button', { name: '跟随最新' }))
    act(() => { vi.advanceTimersByTime(800) })
    expect(port.scrollTop).toBe(paused + 40)
    fireEvent.focus(port)
    act(() => { vi.advanceTimersByTime(800) })
    expect(port.scrollTop).toBe(paused + 40)
  })

  it('preserves position and the same text node when expanding and collapsing', () => {
    const view = render(message('One\nTwo\nThree'))
    const { port, text } = overflow(view)
    port.scrollTop = 60
    fireEvent.click(view.getByRole('button', { name: '展开思考' }))
    expect(view.getByRole('button', { name: '收起思考' }).getAttribute('aria-expanded')).toBe('true')
    expect(port.firstElementChild).toBe(text)
    expect(port.scrollTop).toBe(60)
    fireEvent.click(view.getByRole('button', { name: '收起思考' }))
    expect(port.firstElementChild).toBe(text)
    expect(port.scrollTop).toBe(60)
  })

  it('keeps selected text still and requires clearing the selection before following', () => {
    const view = render(message('Read this carefully'))
    const { port, text } = overflow(view)
    const range = document.createRange()
    range.setStart(text.firstChild!, 0)
    range.setEnd(text.firstChild!, 'Read this carefully'.length)
    document.getSelection()?.addRange(range)
    fireEvent(document, new Event('selectionchange'))
    act(() => { vi.advanceTimersByTime(1600) })
    expect(port.scrollTop).toBe(0)
    const follow = view.getByRole('button', { name: '跟随最新' }) as HTMLButtonElement
    expect(follow.disabled).toBe(true)
    view.rerender(message('Read this carefully and retain the selection'))
    expect(document.getSelection()?.toString()).toBe('Read this carefully')
    document.getSelection()?.removeAllRanges()
    fireEvent(document, new Event('selectionchange'))
    expect(follow.disabled).toBe(false)
    act(() => { vi.advanceTimersByTime(800) })
    expect(port.scrollTop).toBe(0)
    fireEvent.click(follow)
    act(() => { vi.advanceTimersByTime(800) })
    expect(port.scrollTop).toBe(40)
  })

  it('stops motion in reduced-motion and background views, and disposes all work', () => {
    const view = render(message('Quiet reasoning'))
    const { port } = overflow(view)
    act(() => { reducedMotion = true; motionChange?.() })
    act(() => { vi.advanceTimersByTime(1600) })
    expect(port.scrollTop).toBe(0)
    act(() => { reducedMotion = false; motionChange?.() })
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    try {
      fireEvent(document, new Event('visibilitychange'))
      act(() => { vi.advanceTimersByTime(1600) })
      expect(port.scrollTop).toBe(0)
      view.unmount()
      expect(vi.getTimerCount()).toBe(0)
      expect(disconnect).toHaveBeenCalled()
    } finally { hidden.mockRestore() }
  })

  it('does not animate or auto-scroll historical reasoning', () => {
    const view = render(message('Historical reasoning', false))
    const { port, scrollTo } = overflow(view)
    act(() => { vi.advanceTimersByTime(2400) })
    expect(scrollTo).not.toHaveBeenCalled()
    expect(port.scrollTop).toBe(0)
    expect(view.queryByRole('button', { name: '暂停跟随' })).toBeNull()
  })
})
