// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useSearchableHidden } from '../src/client/chat/searchable-hidden.ts'

afterEach(() => { cleanup(); document.getSelection()?.removeAllRanges() })

function Content({ hidden, reveal }: { hidden: boolean; reveal: () => void }) {
  const ref = useSearchableHidden(hidden, reveal)
  return <div ref={ref}><span>Keep reading this process</span></div>
}

it('defers automatic folding while text is selected, then folds after selection clears', () => {
  const reveal = vi.fn()
  const view = render(<Content hidden={false} reveal={reveal} />)
  const text = view.getByText('Keep reading this process')
  const range = document.createRange()
  range.selectNodeContents(text)
  document.getSelection()?.addRange(range)
  view.rerender(<Content hidden reveal={reveal} />)
  expect(text.parentElement?.getAttribute('hidden')).toBeNull()
  expect(reveal).not.toHaveBeenCalled()
  document.getSelection()?.removeAllRanges()
  fireEvent(document, new Event('selectionchange'))
  expect(text.parentElement?.getAttribute('hidden')).toBe('until-found')
  fireEvent(text.parentElement!, new Event('beforematch'))
  expect(reveal).toHaveBeenCalledOnce()
})

it('does not let an unrelated selection prevent folding and removes listeners on unmount', () => {
  const reveal = vi.fn()
  const outside = document.createElement('p')
  outside.textContent = 'Outside this process'
  document.body.append(outside)
  try {
    const range = document.createRange()
    range.selectNodeContents(outside)
    document.getSelection()?.addRange(range)
    const view = render(<Content hidden reveal={reveal} />)
    expect(view.getByText('Keep reading this process').parentElement?.getAttribute('hidden')).toBe('until-found')
    view.unmount()
    document.getSelection()?.removeAllRanges()
    fireEvent(document, new Event('selectionchange'))
    expect(reveal).not.toHaveBeenCalled()
  } finally { outside.remove() }
})

it('defers the whole selected Turn without revealing another Turn', () => {
  const reveal = vi.fn()
  const view = render(<div>
    <div data-chat-turn="1"><Content hidden={false} reveal={reveal} /></div>
    <div data-chat-turn="1"><span>Selected later process</span></div>
    <div data-chat-turn="2"><div data-other-turn><Content hidden={false} reveal={reveal} /></div></div>
  </div>)
  const range = document.createRange()
  range.selectNodeContents(view.getByText('Selected later process'))
  document.getSelection()?.addRange(range)
  view.rerender(<div>
    <div data-chat-turn="1"><Content hidden reveal={reveal} /></div>
    <div data-chat-turn="1"><span>Selected later process</span></div>
    <div data-chat-turn="2"><div data-other-turn><Content hidden reveal={reveal} /></div></div>
  </div>)
  const first = view.container.querySelector('[data-chat-turn="1"] > div')
  const other = view.container.querySelector('[data-other-turn] > div')
  expect(first?.getAttribute('hidden')).toBeNull()
  expect(other?.getAttribute('hidden')).toBe('until-found')
  document.getSelection()?.removeAllRanges()
  fireEvent(document, new Event('selectionchange'))
  expect(first?.getAttribute('hidden')).toBe('until-found')
})
