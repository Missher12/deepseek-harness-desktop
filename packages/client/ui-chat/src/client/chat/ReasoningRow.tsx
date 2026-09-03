/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { useThrottledVisualUpdate } from './use-throttled-visual-update.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function revealCount(backlog: number): number {
  return Math.max(1, Math.ceil(backlog / (backlog > 48 ? 4 : 8)))
}

function useTypewriterSummary(target: string, animate: boolean): string {
  const [displayed, setDisplayed] = useState(() => animate ? '' : target)
  const displayedRef = useRef(displayed)
  const targetRef = useRef(target)
  const frameRef = useRef<number>()
  const cancel = () => {
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
    frameRef.current = undefined
  }
  useEffect(() => {
    displayedRef.current = displayed
  }, [displayed])
  useEffect(() => {
    targetRef.current = target
    const flush = () => {
      cancel()
      displayedRef.current = targetRef.current
      setDisplayed(targetRef.current)
    }
    if (!animate || document.hidden || prefersReducedMotion()) { flush(); return cancel }
    if (!target.startsWith(displayedRef.current)) {
      displayedRef.current = ''
      setDisplayed('')
    }
    const tick = () => {
      frameRef.current = undefined
      const current = displayedRef.current
      const nextTarget = targetRef.current
      if (current === nextTarget) return
      const units = Array.from(nextTarget)
      const currentLength = Array.from(current).length
      const next = units.slice(0, currentLength + revealCount(units.length - currentLength)).join('')
      displayedRef.current = next
      setDisplayed(next)
      if (next !== nextTarget) frameRef.current = requestAnimationFrame(tick)
    }
    if (frameRef.current === undefined) frameRef.current = requestAnimationFrame(tick)
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined
    const onMotion = () => { if (media?.matches === true) flush() }
    const onVisibility = () => { if (document.hidden) flush() }
    media?.addEventListener('change', onMotion)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      media?.removeEventListener('change', onMotion)
      document.removeEventListener('visibilitychange', onVisibility)
      cancel()
    }
  }, [animate, target])
  return displayed
}

/**
 * Render one assistant reasoning block as the Think disclosure row.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.t - conversation locale seat for the running status.
 * @returns the reasoning disclosure.
 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  const [expanded, setExpanded] = useState(false)
  const summaryRef = useRef<HTMLSpanElement>(null)
  const targetSummary = running ? latestLine(text) : firstLine(text)
  const summary = useTypewriterSummary(targetSummary, running && !expanded)
  const { schedule: scheduleSummaryScroll, cancel: cancelSummaryScroll } = useThrottledVisualUpdate(() => {
    const element = summaryRef.current
    if (element === null) return
    element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  })
  useLayoutEffect(() => {
    const element = summaryRef.current
    if (!running && element !== null) {
      cancelSummaryScroll()
      element.scrollLeft = 0
      return
    }
    scheduleSummaryScroll()
  }, [cancelSummaryScroll, running, scheduleSummaryScroll, summary])

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}
    >
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title={t('message.think')}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span ref={summaryRef} className={css.summary} data-follow-end={running || undefined}
              data-typing={running && !expanded && summary !== targetSummary || undefined}>
              <span className={css.summaryText}>{summary}</span>
            </span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  )
}
