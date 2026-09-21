// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { displayLength, displayPrefix, Draft } from '../src/client/chat/graphemes.ts'
import {
  BACKLOG_CHASE_MS, CATCH_UP_CLUSTERS, REVEAL_CLUSTERS_PER_SECOND, revealStep,
} from '../src/client/chat/use-revealed-text.ts'
import { ReasoningRow } from '../src/client/chat/ReasoningRow.tsx'

const t = makeTranslate(zh, commonZh)

let reduced = false
let clock = 0
let frames = new Map<number, FrameRequestCallback>()
let scheduled = 0

/** Advance the fake clock, then flush every queued animation frame. */
function flushFrame(elapsed = 0): void {
  clock += elapsed
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

  it('resegments only the tail a chunk may have continued', () => {
    const draft = new Draft()
    draft.append('\u4e2da')
    draft.update()
    expect(draft.length).toBe(2)
    expect(draft.endOf(0)).toBe(0)
    expect(draft.endOf(1)).toBe(1)
    expect(draft.endOf(2)).toBe(2)
    expect(draft.endOf(99)).toBe(2)

    // A chunk that continues the last cluster keeps the settled endings and
    // moves only the provisional one: the cluster count is unchanged, which is
    // exactly why scheduling on the count alone dropped the new text.
    draft.append('\u0301')
    expect(draft.update()).toBe(false)
    expect(draft.length).toBe(2)
    expect(draft.endOf(1)).toBe(1)
    expect(draft.endOf(2)).toBe(3)
    expect(draft.toString()).toBe('\u4e2da\u0301')

    // An unchanged text is a no-op, which is what keeps a frame's cost
    // independent of the thought's length.
    expect(draft.update()).toBe(false)
    expect(draft.length).toBe(2)
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

  it('shows the completed cluster in the rendered text, not only in an attribute', () => {
    // The paint is only real if the text node carries it: assert the visible
    // DOM text, which is what a reader sees and selects.
    const view = render(<ReasoningRow text="e" running t={t} />)
    flushFrame()
    expect(body(view).textContent).toBe('e')

    view.rerender(<ReasoningRow text={'e\u0301'} running t={t} />)
    flushFrame(400)
    expect(body(view).textContent).toBe('e\u0301')
    // One text node still holds it, so a selection survives.
    expect(body(view).childNodes).toHaveLength(1)
    expect(body(view).firstChild?.nodeType).toBe(Node.TEXT_NODE)

    view.rerender(<ReasoningRow text={'\u{1F468}\u200D\u{1F469}'} running t={t} />)
    flushFrame(400)
    expect(body(view).textContent).toBe('\u{1F468}\u200D\u{1F469}')
  })

  it('completes the last cluster when a later chunk continues it', () => {
    // A chunk can extend the final cluster without adding one: a combining
    // mark, an emoji join sequence, or the second half of a surrogate pair.
    // Each must reach the reader while the stream is still running.
    const cases: readonly (readonly [string, string])[] = [
      ['e', 'e\u0301'],
      ['\u{1F468}', '\u{1F468}\u200D\u{1F469}'],
      ['\uD83D', '\uD83D\uDE00'],
    ]
    for (const [before, after] of cases) {
      cleanup()
      const view = render(<ReasoningRow text={before} running t={t} />)
      flushFrame()
      expect(painted(view)).toBe(before)

      view.rerender(<ReasoningRow text={after} running t={t} />)
      flushFrame(400)
      expect(painted(view)).toBe(after)
    }
  })

  it('keeps a cluster count unchanged while the text grows', () => {
    // The regression the reveal had: scheduling on the cluster count alone
    // leaves the continuation unpainted until unrelated text arrives.
    const draft = new Draft()
    draft.append('\u{1F468}')
    draft.update()
    const before = draft.length
    draft.append('\u200D\u{1F469}')
    expect(draft.update()).toBe(false)
    expect(draft.length).toBe(before)
    expect(draft.toString()).toBe('\u{1F468}\u200D\u{1F469}')
  })

  it('does not let appends postpone the oldest pending cluster past the window', () => {
    // 180 clusters arrive, then nine more every three frames at 60Hz: the
    // oldest 180 are owed display within the catch-up window whatever lands
    // behind them.
    const first = '\u601d'.repeat(180)
    let latest = first
    const view = render(<ReasoningRow text={latest} running t={t} />)
    flushFrame()
    for (let frame = 1; frame <= 24; frame += 1) {
      if (frame % 3 === 0) {
        latest += '\u7eed'.repeat(9)
        view.rerender(<ReasoningRow text={latest} running t={t} />)
      }
      flushFrame(1000 / 60)
    }
    expect(clock - 1_000).toBeGreaterThan(400)
    expect(painted(view).slice(0, first.length)).toBe(first)
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
