/**
 * Progressive reveal of the one reasoning block that is currently streaming.
 * The received text is never delayed, rewritten, or dropped: this hook only
 * decides how much of an already-delivered prefix is painted this frame, and
 * every terminal or paused state paints the complete text at once.
 */

import { useEffect, useRef, useState } from 'react'
import { Draft } from './graphemes.ts'

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
 * @param backlogAge - milliseconds the oldest unpainted cluster has been waiting.
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
 *
 * The prefix is derived from the painted cluster count on every frame, and a
 * frame is scheduled whenever the received text changes — not only when the
 * cluster count grows. A chunk that continues the last cluster (a combining
 * mark, an emoji join sequence, or the second half of a surrogate pair) carries
 * text a reader must see while the stream is still running.
 * @param text - complete received reasoning text, with literal whitespace.
 * @param running - whether this block is the streaming tail.
 * @returns the prefix to paint for this render.
 */
export function useRevealedText(text: string, running: boolean): string {
  const [shown, setShown] = useState(() => running ? '' : text)
  const draft = useRef(new Draft())
  const painted = useRef(0)
  const frame = useRef<number | null>(null)
  const lastFrameAt = useRef(0)
  const firstPendingAt = useRef(0)
  const paused = useRef(false)
  const seen = useRef('')

  useEffect(() => {
    const cancel = (): void => {
      if (frame.current === null) return
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    function schedule(): void {
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(paint)
    }
    // Paused and terminal states paint everything already received. The painted
    // count moves with them, so a block that leaves a pause shows what arrived
    // while it was away without replaying any of it.
    function showAll(): void {
      cancel()
      painted.current = draft.current.length
      lastFrameAt.current = 0
      firstPendingAt.current = 0
      setShown(text)
    }
    function paint(): void {
      frame.current = null
      if (document.hidden || reducedMotion()) {
        paused.current = true
        showAll()
        return
      }
      const total = draft.current.length
      const backlog = total - painted.current
      const now = performance.now()
      if (backlog > 0) {
        // The wait belongs to the oldest cluster still unpainted, so a chunk
        // that arrives mid-stream cannot postpone an older one's catch-up.
        const elapsed = lastFrameAt.current === 0 ? FIRST_FRAME_MS : now - lastFrameAt.current
        const step = revealStep(backlog, elapsed, now - firstPendingAt.current)
        lastFrameAt.current = now
        painted.current = Math.min(total, painted.current + step)
      } else {
        lastFrameAt.current = 0
      }
      // Derived from the painted count every frame, so a cluster a chunk
      // continued repaints even though the count did not move.
      const prefix = draft.current.toString().slice(0, draft.current.endOf(painted.current))
      setShown(current => prefix.startsWith(current) ? prefix : current)
      if (painted.current < total) schedule()
      else firstPendingAt.current = 0
    }

    // The received text is the source of truth, so a chunk that replaces the
    // stream rebuilds the draft rather than appending to a prefix it left, and
    // clears what the replaced text had already painted.
    if (!text.startsWith(seen.current)) {
      draft.current = new Draft()
      painted.current = 0
      lastFrameAt.current = 0
      firstPendingAt.current = 0
      setShown(running ? '' : text)
    }
    if (text !== seen.current) {
      seen.current = text
      const previous = draft.current.toString().length
      draft.current.append(text.slice(draft.current.textLength))
      draft.current.update()
      // A cluster the last chunk continued still counts from where it stood, so
      // the wait a reader is owed belongs to the oldest cluster without paint.
      // The comparison is on the appended text, because a continuation changes
      // it without changing the cluster count.
      if (firstPendingAt.current === 0 && draft.current.textLength > previous) {
        firstPendingAt.current = performance.now()
      }
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
    // Always paint once per received chunk: the frame itself decides how much
    // to show, and a paint that changes nothing leaves no frame pending.
    schedule()
    return cancel
  }, [text, running])

  return running ? shown : text
}
