/**
 * Progressive reveal of the one reasoning block that is currently streaming.
 * The received text is never delayed, rewritten, or dropped: this hook only
 * decides how much of an already-delivered prefix is painted this frame, and
 * every terminal or paused state paints the complete text at once.
 */

import { useEffect, useRef, useState } from 'react'
import { GraphemeIndex } from './graphemes.ts'

/** Grapheme clusters revealed per second while the reader keeps up with the model. */
export const REVEAL_CLUSTERS_PER_SECOND = 240
/** A backlog pending longer than this is caught up instead of typed out. */
export const BACKLOG_CHASE_MS = 300
/**
 * Longest backlog this reveal still types out. The reveal owes the model about
 * a second of typing at most before it owes the reader the whole chunk, so a
 * larger burst is painted in one frame and the visible lag stays sub-second.
 */
export const CATCH_UP_CLUSTERS = REVEAL_CLUSTERS_PER_SECOND
/** Interval credited to a frame that starts a fresh reveal cycle. */
const FIRST_FRAME_MS = 1000 / 60

/**
 * How much of the received text to paint this frame.
 * @param backlog - grapheme clusters received but not yet shown.
 * @param elapsed - milliseconds since the previous painted frame of this cycle.
 * @param backlogAge - milliseconds since the received text last grew.
 * @returns the number of clusters to reveal now, at least one while a backlog remains.
 */
export function revealStep(backlog: number, elapsed: number, backlogAge: number): number {
  if (backlog <= 0) return 0
  if (backlog > CATCH_UP_CLUSTERS || backlogAge >= BACKLOG_CHASE_MS) return backlog
  return Math.max(1, Math.round(elapsed * REVEAL_CLUSTERS_PER_SECOND / 1000))
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Reveal `text` progressively while `running`, and completely in every other case.
 * The returned value is always a prefix of `text`; a finished, stopped, errored,
 * backgrounded, or reduced-motion block returns `text` itself. Frames are
 * scheduled with `requestAnimationFrame` and stepped by elapsed time, so the
 * revealed rate is the same at every display refresh rate.
 * @param text - complete received reasoning text, with literal whitespace.
 * @param running - whether this block is the streaming tail.
 * @returns the prefix to paint for this render.
 */
export function useRevealedText(text: string, running: boolean): string {
  const [shown, setShown] = useState(() => running ? '' : text)
  const painted = useRef(0)
  const frame = useRef<number | null>(null)
  const lastFrameAt = useRef(0)
  const grownAt = useRef(0)
  const lastText = useRef(text)
  const paused = useRef(false)
  const index = useRef(new GraphemeIndex())

  useEffect(() => {
    // One segmentation per text change: the frame loop then reads a length and
    // a prefix without walking the whole thought again.
    index.current.update(text)
    const cancel = (): void => {
      if (frame.current === null) return
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    // Paused and terminal states paint everything already received. The painted
    // count moves with them, so a block that leaves a pause shows what arrived
    // while it was away without replaying any of it.
    function showAll(): void {
      cancel()
      painted.current = index.current.length
      lastFrameAt.current = 0
      setShown(text)
    }
    function schedule(): void {
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(paint)
    }
    function paint(): void {
      frame.current = null
      if (document.hidden || reducedMotion()) {
        paused.current = true
        showAll()
        return
      }
      const total = index.current.length
      const backlog = total - painted.current
      if (backlog <= 0) {
        // Nothing pending: the next chunk starts its own cycle rather than
        // inheriting the idle gap as one oversized frame.
        lastFrameAt.current = 0
        return
      }
      const now = performance.now()
      const elapsed = lastFrameAt.current === 0 ? FIRST_FRAME_MS : now - lastFrameAt.current
      const step = revealStep(backlog, elapsed, now - grownAt.current)
      lastFrameAt.current = now
      painted.current = Math.min(total, painted.current + step)
      const prefix = index.current.prefix(painted.current)
      setShown(current => prefix.startsWith(current) ? prefix : current)
      if (painted.current < total) schedule()
    }

    // A replaced chunk restarts the reveal: the painted count describes a prefix
    // of the text it was measured against, so it cannot carry over. An extended
    // chunk keeps it, which is what makes the reveal continue across appends.
    const previous = lastText.current
    lastText.current = text
    if (text !== previous && !text.startsWith(previous)) {
      painted.current = 0
      lastFrameAt.current = 0
      grownAt.current = performance.now()
      setShown(running ? '' : text)
    } else if (index.current.length > painted.current) {
      grownAt.current = performance.now()
    }

    if (!running || document.hidden || reducedMotion()) {
      paused.current = true
      showAll()
      return
    }
    // Resuming after a pause starts a fresh frame cycle: the gap the pause left
    // is not elapsed reveal time.
    if (paused.current) {
      paused.current = false
      lastFrameAt.current = 0
    }
    if (painted.current < index.current.length) schedule()
    return cancel
  }, [text, running])

  return running ? shown : text
}
