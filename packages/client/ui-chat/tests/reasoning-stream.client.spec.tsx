// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { displayLength, displayPrefix, GraphemeIndex } from '../src/client/chat/graphemes.ts'
import {
  BACKLOG_CHASE_MS, CATCH_UP_CLUSTERS, REVEAL_CLUSTERS_PER_SECOND, revealStep,
} from '../src/client/chat/use-revealed-text.ts'
import { ReasoningRow } from '../src/client/chat/ReasoningRow.tsx'

const t = makeTranslate(zh, commonZh)

let reduced = false
let clock = 0
let frames = new Map<number, FrameRequestCallback>()
let scheduled = 0

/** Flush every queued animation frame, letting React commit each paint. */
function flushFrame(): void {
  const queued = [...frames.values()]
  frames.clear()
  act(() => { for (const callback of queued) callback(clock) })
}

beforeEach(() => {
  frames = new Map()
  scheduled = 0
  clock = 1_000
  reduced = false
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    scheduled += 1
    frames.set(scheduled, callback)
    return scheduled
  })
  // Cancelling drops the entry, so an empty queue means no frame is pending
  // rather than a queue full of no-ops.
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => { frames.delete(handle) })
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return reduced },
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Painted prefix of the streaming block. */
function painted(view: ReturnType<typeof render>): string {
  return view.container.querySelector('[data-variant="think"] > div:last-child')
    ?.getAttribute('data-reasoning-shown') ?? ''
}

/** Complete received text carried by the block, whatever the paint has reached. */
function received(view: ReturnType<typeof render>): string {
  return view.container.querySelector('[data-variant="think"] > div:last-child')
    ?.getAttribute('data-reasoning-full') ?? ''
}

/** Literal text node currently in the block. */
function body(view: ReturnType<typeof render>): HTMLElement {
  return view.container.querySelector('[data-variant="think"] > div:last-child') as HTMLElement
}

describe('grapheme boundaries', () => {
  it('counts and slices by user-perceived character, not code unit', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'
    const combined = 'é'
    const value = `中${family}${combined}!`
    expect(displayLength(value)).toBe(4)
    expect(displayPrefix(value, 0)).toBe('')
    expect(displayPrefix(value, 1)).toBe('中')
    expect(displayPrefix(value, 2)).toBe(`中${family}`)
    expect(displayPrefix(value, 3)).toBe(`中${family}${combined}`)
    expect(displayPrefix(value, 4)).toBe(value)
    expect(displayPrefix(value, 99)).toBe(value)
  })

  it('keeps a partial cluster whole rather than splitting its code units', () => {
    expect(displayLength('a')).toBe(1)
    expect(displayPrefix('a\uD83D', 2)).toBe('a\uD83D')
    expect(displayLength('\r\n')).toBe(1)
  })

  it('indexes clusters once per text change and slices them without resegmenting', () => {
    const index = new GraphemeIndex()
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'
    const value = `中${family}e\u0301!`
    index.update(value)
    expect(index.length).toBe(4)
    expect(index.prefix(0)).toBe('')
    expect(index.prefix(2)).toBe(`中${family}`)
    expect(index.prefix(4)).toBe(value)
    expect(index.prefix(99)).toBe(value)

    // A text change resegments; an unchanged text is a no-op, which is what
    // keeps the per-frame cost independent of the thought's length.
    index.update(value)
    expect(index.length).toBe(4)
    index.update('再次思考')
    expect(index.length).toBe(4)
    expect(index.prefix(2)).toBe('再次')
  })
})

describe('revealStep', () => {
  it('reveals a small chunk at the calibrated rate on every refresh rate', () => {
    // 240 clusters per second sampled over one frame at 60/120/240Hz: the same
    // elapsed time reveals the same number of clusters, so the visible typing
    // speed follows time rather than the display.
    expect(revealStep(40, 1000 / 60, 0)).toBe(4)
    expect(revealStep(40, 1000 / 120, 0)).toBe(2)
    expect(revealStep(40, 1000 / 240, 0)).toBe(1)
    // Sub-cluster frames still advance, so the reveal never stalls.
    expect(revealStep(40, 2, 0)).toBe(1)
  })

  it('keeps the largest typed-out backlog inside the catch-up budget', () => {
    expect(CATCH_UP_CLUSTERS).toBe(REVEAL_CLUSTERS_PER_SECOND)
    expect(revealStep(CATCH_UP_CLUSTERS, 16, 0)).toBe(4)
  })

  it('paints a burst whole rather than typing it out', () => {
    // One cluster past the budget would outlast the catch-up window, so it
    // lands in a single frame instead of trailing the model.
    expect(revealStep(CATCH_UP_CLUSTERS + 1, 16, 0)).toBe(CATCH_UP_CLUSTERS + 1)
    expect(revealStep(600, 16, 0)).toBe(600)
  })

  it('catches up a backlog that has been pending past the window', () => {
    expect(revealStep(10, 16, BACKLOG_CHASE_MS)).toBe(10)
    expect(revealStep(10, 16, BACKLOG_CHASE_MS - 1)).toBe(4)
  })

  it('does nothing without a backlog', () => {
    expect(revealStep(0, 16, 0)).toBe(0)
    expect(revealStep(0, 16, BACKLOG_CHASE_MS)).toBe(0)
  })
})

describe('ReasoningRow streaming reveal', () => {
  it('paints a growing prefix of the received text', () => {
    const view = render(<ReasoningRow text="abcdefgh" running t={t} />)
    expect(painted(view)).toBe('')
    flushFrame()
    expect(painted(view)).toBe('abcd')

    clock += 100
    flushFrame()
    expect(painted(view)).toBe('abcdefgh')
  })

  it('paints a burst whole rather than typing it out', () => {
    const long = '思'.repeat(400)
    const view = render(<ReasoningRow text={long} running t={t} />)
    // Far more arrived than the reveal owes to type out, so it lands in one
    // frame instead of trailing the model.
    expect(painted(view)).toBe('')
    flushFrame()
    expect(painted(view)).toBe(long)
    expect(frames.size).toBe(0)
  })

  it('keeps revealing from where it was when more text arrives', () => {
    const view = render(<ReasoningRow text={'思'.repeat(60)} running t={t} />)
    flushFrame()
    expect(painted(view)).toBe('思'.repeat(4))

    view.rerender(<ReasoningRow text={'思'.repeat(80)} running t={t} />)
    clock += 100
    flushFrame()
    // Twenty clusters arrived and a hundred milliseconds passed: the reveal
    // continues from four rather than restarting at the delivered text.
    expect(painted(view)).toBe('思'.repeat(28))
  })

  it('flushes the complete text the moment the block stops running', () => {
    const long = '思'.repeat(60)
    const view = render(<ReasoningRow text={long} running t={t} />)
    flushFrame()
    expect(painted(view)).toBe('思'.repeat(4))
    view.rerender(<ReasoningRow text={long} running={false} t={t} />)
    expect(body(view).textContent).toBe(long)
    expect(frames.size).toBe(0)
  })

  it('shows a finished or historical block at full length without a frame', () => {
    const historical = '历史思考\n第二行'
    const view = render(<ReasoningRow text={historical} running={false} t={t} />)
    expect(body(view).textContent).toBe(historical)
    expect(frames.size).toBe(0)
  })

  it('shows reduced-motion blocks at full length', () => {
    reduced = true
    const view = render(<ReasoningRow text="quiet reasoning" running t={t} />)
    expect(body(view).textContent).toBe('quiet reasoning')
  })

  it('paints everything received on a paused display and never replays it', () => {
    const long = '思'.repeat(60)
    const view = render(<ReasoningRow text={long} running t={t} />)
    flushFrame()
    expect(painted(view)).toBe('思'.repeat(4))

    // Reduced motion and a backgrounded document share one paused path: the
    // block shows all of its received text instead of animating a backlog.
    reduced = true
    view.rerender(<ReasoningRow text={long} running t={t} />)
    flushFrame()
    expect(painted(view)).toBe(long)
    expect(frames.size).toBe(0)

    // Nothing already shown is replayed when the display resumes.
    reduced = false
    view.rerender(<ReasoningRow text={'思'.repeat(110)} running t={t} />)
    flushFrame()
    // The sixty clusters the pause already showed stay: only the fifty that
    // arrived after it are typed out, four at a time.
    expect(painted(view)).toBe('思'.repeat(64))
  })

  it('restarts the reveal when a chunk replaces the stream', () => {
    const view = render(<ReasoningRow text="甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉" running t={t} />)
    flushFrame()
    expect(painted(view)).toBe('甲乙丙丁')

    view.rerender(<ReasoningRow text="癸壬辛庚" running t={t} />)
    expect(painted(view)).toBe('')
    flushFrame()
    expect(painted(view)).toBe('癸壬辛庚')
  })

  it('keeps the full received text readable while the paint catches up', () => {
    const long = '思'.repeat(60)
    const view = render(<ReasoningRow text={long} running t={t} />)
    // The receipt is complete from the first frame; only the text node grows.
    expect(received(view)).toBe(long)
    flushFrame()
    expect(received(view)).toBe(long)
    expect(body(view).textContent).toBe('思'.repeat(4))
  })

  it('keeps no frame scheduled once the text is fully painted', () => {
    render(<ReasoningRow text="short" running t={t} />)
    flushFrame()
    flushFrame()
    expect(frames.size).toBe(0)
  })

  it('cancels its pending frame on unmount', () => {
    const view = render(<ReasoningRow text={'思'.repeat(200)} running t={t} />)
    flushFrame()
    expect(frames.size).toBeGreaterThan(0)
    view.unmount()
    expect(frames.size).toBe(0)
  })
})
