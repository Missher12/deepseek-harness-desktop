/** Literal reasoning in a bounded reading card; manual reading owns its scroll. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { IconChevronDownOutline14, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './ReasoningRow.module.css'

// A burst advances by the same two rendered lines as a small append.
const FOLLOW_INTERVAL_MS = 800
const FOLLOW_LINES = 2

/**
 * Render original reasoning without truncating or replaying received text.
 * Running overflow follows two lines at a time until the reader intervenes.
 * History, hidden documents and reduced-motion views remain still.
 * @param props.text - complete or streaming reasoning, with literal whitespace.
 * @param props.running - whether this block is the streaming tail.
 * @param props.t - the owning Chat locale seat.
 * @returns the reasoning card and its local reading controls.
 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  const controls = useId()
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [following, setFollowing] = useState(true)
  const [selected, setSelected] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const [motionAllowed, setMotionAllowed] = useState(false)
  const pause = useCallback(() => {
    setFollowing(false)
    const port = viewport.current
    if (port !== null) port.scrollTop = port.scrollTop
  }, [])

  useEffect(() => {
    if (!running) { setMotionAllowed(false); return }
    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : undefined
    const update = () => {
      const allowed = !document.hidden && media?.matches !== true
      setMotionAllowed(allowed)
      if (!allowed && viewport.current !== null) viewport.current.scrollTop = viewport.current.scrollTop
    }
    update()
    media?.addEventListener('change', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      media?.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [running])

  useLayoutEffect(() => {
    const body = content.current
    if (body === null) return
    const current = body.firstChild
    // Appending to the same Text node preserves a reader's Range endpoints.
    // Replacing its entire value on every chunk would collapse that selection.
    if (current instanceof Text && text.startsWith(current.data)) current.appendData(text.slice(current.length))
    else body.replaceChildren(body.ownerDocument.createTextNode(text))
  }, [text])

  useLayoutEffect(() => {
    const port = viewport.current
    const body = content.current
    if (port === null || body === null) return
    const measure = () => { setOverflow(port.scrollHeight > port.clientHeight + 1) }
    const onSelection = () => {
      const selection = port.ownerDocument.getSelection()
      const containsSelection = selection !== null && !selection.isCollapsed
        && Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
          .some(range => range.intersectsNode(port))
      setSelected(containsSelection)
      if (containsSelection) pause()
    }
    const observer = new ResizeObserver(measure)
    observer.observe(port)
    observer.observe(body)
    measure()
    if (running) port.ownerDocument.addEventListener('selectionchange', onSelection)
    return () => {
      observer.disconnect()
      port.ownerDocument.removeEventListener('selectionchange', onSelection)
    }
  }, [pause, running])

  const activeFollow = running && following && !selected && motionAllowed
  useEffect(() => {
    if (!activeFollow) return
    const timer = window.setInterval(() => {
      const port = viewport.current
      const body = content.current
      if (port === null || body === null) return
      const lineHeight = Number.parseFloat(getComputedStyle(body).lineHeight)
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return
      const end = Math.max(0, port.scrollHeight - port.clientHeight)
      const next = Math.min(end, port.scrollTop + lineHeight * FOLLOW_LINES)
      if (next > port.scrollTop) port.scrollTo({ top: next, behavior: 'smooth' })
    }, FOLLOW_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [activeFollow])

  return (
    <div className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined} data-following={activeFollow || undefined}>
      <button type="button" className={css.heading} aria-controls={controls} aria-expanded={expanded}
        aria-label={t(expanded ? 'message.reasoning.collapse' : 'message.reasoning.expand')}
        onClick={() => { setExpanded(value => !value) }}>
        <IconThinkOutline14 size={14} />
        <span className={css.title}>{t('message.think')}</span>
        {running && <span className={css.status}>{t('row.running')}</span>}
        <IconChevronDownOutline14 className={css.chevron} />
      </button>
      <div ref={viewport} id={controls} className={css.viewport} role="region"
        aria-label={t('message.reasoning.content')} tabIndex={overflow ? 0 : undefined}
        data-overflow={overflow || undefined} onWheel={pause} onTouchStart={pause}
        onPointerDown={pause} onFocus={pause}>
        <div ref={content} className={css.thinkBody} />
      </div>
      {overflow && (
        <div className={css.footer}>
          <span>{t('message.reasoning.original')}</span>
          {running && (
            <button type="button" className={css.follow} aria-controls={controls} disabled={selected}
              onClick={() => { if (following) pause(); else setFollowing(true) }}>
              {t(following ? 'message.reasoning.pause' : 'message.reasoning.follow')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
