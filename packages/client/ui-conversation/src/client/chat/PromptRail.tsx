import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { PromptAnchor } from '@deepseek-ai/dsh-client-connection/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './ChatView.module.css'
import { formatMessageClock } from './message-chrome.ts'

const MAX_RENDERED_PROMPTS = 120

export interface PromptRailPoint {
  readonly y: number
  readonly top: number
  readonly height: number
  readonly count: number
}

/** Return the nearest rendered prompt, keeping pointer positions inside the rail. */
export function nearestPromptIndex({ y, top, height, count }: PromptRailPoint): number {
  if (count <= 0) return -1
  if (count === 1 || height <= 0) return 0
  const ratio = Math.min(1, Math.max(0, (y - top) / height))
  return Math.round(ratio * (count - 1))
}

/** Keep rendering bounded while retaining both chronological ends. */
function visiblePromptAnchors(
  anchors: readonly PromptAnchor[],
  activeSeq: number | null,
): readonly PromptAnchor[] {
  if (anchors.length <= MAX_RENDERED_PROMPTS) return anchors
  const found = activeSeq === null ? -1 : anchors.findIndex(anchor => anchor.seq === activeSeq)
  const activeIndex = found < 0 ? anchors.length - 1 : found
  const start = Math.max(0, Math.min(
    anchors.length - MAX_RENDERED_PROMPTS,
    activeIndex - Math.floor(MAX_RENDERED_PROMPTS / 2),
  ))
  const windowed = anchors.slice(start, start + MAX_RENDERED_PROMPTS)
  const first = anchors[0]
  const last = anchors.at(-1)
  if (start > 0 && first !== undefined) windowed[0] = first
  if (start + MAX_RENDERED_PROMPTS < anchors.length && last !== undefined) {
    windowed[windowed.length - 1] = last
  }
  return windowed
}

export interface PromptRailProps {
  readonly anchors: readonly PromptAnchor[]
  readonly activeSeq: number | null
  readonly onActivate: (seq: number) => void
  readonly t: ChatViewSlotProps['t']
}

const COMPACT_PROMPT_RAIL_QUERY = '(max-width: 860px)'

/** Keep the dense desktop ruler out of narrow transcript layouts. */
function useCompactPromptRail(): boolean {
  const [compact, setCompact] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(COMPACT_PROMPT_RAIL_QUERY).matches
  ))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(COMPACT_PROMPT_RAIL_QUERY)
    const update = () => { setCompact(media.matches) }
    update()
    media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update) }
  }, [])

  return compact
}

/** Codex-style prompt timeline: navigation only, with no rewind semantics. */
export function PromptRail({ anchors, activeSeq, onActivate, t }: PromptRailProps) {
  const [tooltipSeq, setTooltipSeq] = useState<number | null>(null)
  const [focusSeq, setFocusSeq] = useState<number | null>(null)
  const [compactOpen, setCompactOpen] = useState(false)
  const compactTriggerRef = useRef<HTMLButtonElement>(null)
  const compactPopoverRef = useRef<HTMLDivElement>(null)
  const markRefs = useRef(new Map<number, HTMLButtonElement>())
  const compact = useCompactPromptRail()
  const indexBySeq = useMemo(
    () => new Map(anchors.map((anchor, index) => [anchor.seq, index] as const)),
    [anchors],
  )
  const effectiveActiveSeq = activeSeq !== null && indexBySeq.has(activeSeq)
    ? activeSeq
    : anchors.at(-1)?.seq ?? null
  const visible = useMemo(
    () => visiblePromptAnchors(anchors, effectiveActiveSeq),
    [anchors, effectiveActiveSeq],
  )

  useEffect(() => {
    if (!compact) setCompactOpen(false)
  }, [compact])

  useEffect(() => {
    if (compactOpen) compactPopoverRef.current?.focus()
  }, [compactOpen])

  useEffect(() => {
    if (focusSeq !== null && visible.some(anchor => anchor.seq === focusSeq)) return
    setFocusSeq(effectiveActiveSeq)
  }, [effectiveActiveSeq, focusSeq, visible])

  useEffect(() => {
    if (tooltipSeq !== null && !anchors.some(anchor => anchor.seq === tooltipSeq)) setTooltipSeq(null)
  }, [anchors, tooltipSeq])

  if (visible.length < 2) return null
  const activeIndex = effectiveActiveSeq === null
    ? anchors.length - 1
    : indexBySeq.get(effectiveActiveSeq) ?? anchors.length - 1
  const current = Math.max(1, activeIndex + 1)
  const nearestAnchor = (clientY: number, track: HTMLElement): PromptAnchor | undefined => {
    const rect = track.getBoundingClientRect()
    const index = nearestPromptIndex({ y: clientY, top: rect.top, height: rect.height, count: visible.length })
    return index < 0 ? undefined : visible[index]
  }
  const focusedSeq = focusSeq !== null && visible.some(anchor => anchor.seq === focusSeq)
    ? focusSeq
    : effectiveActiveSeq
  const moveFocus = (from: number, key: string): void => {
    const fromIndex = visible.findIndex(anchor => anchor.seq === from)
    if (fromIndex < 0) return
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? visible.length - 1
        : Math.max(0, Math.min(visible.length - 1, fromIndex + (key === 'ArrowUp' ? -1 : 1)))
    const next = visible[nextIndex]
    if (next === undefined) return
    setFocusSeq(next.seq)
    markRefs.current.get(next.seq)?.focus()
  }
  const onMarkKeyDown = (event: KeyboardEvent<HTMLButtonElement>, anchor: PromptAnchor): void => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      moveFocus(anchor.seq, event.key)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onActivate(anchor.seq)
    }
  }
  const closeCompact = (restoreFocus = false): void => {
    setCompactOpen(false)
    if (restoreFocus) compactTriggerRef.current?.focus()
  }

  return (
    <nav className={css.promptRail} aria-label={t('promptRail.aria')} data-side="left">
      {!compact && (
        <div
          className={css.promptRailTrack}
          data-prompt-rail-track=""
          onPointerMove={(event) => { setTooltipSeq(nearestAnchor(event.clientY, event.currentTarget)?.seq ?? null) }}
          onPointerLeave={() => { setTooltipSeq(null) }}
          onClick={(event) => {
            if (event.button !== 0 || event.target !== event.currentTarget) return
            const anchor = nearestAnchor(event.clientY, event.currentTarget)
            if (anchor !== undefined) onActivate(anchor.seq)
          }}
        >
          {visible.map((anchor, visibleIndex) => {
            const absoluteIndex = indexBySeq.get(anchor.seq) ?? 0
            const label = anchor.preview || t('promptRail.imageOnly')
            const tooltipVisible = tooltipSeq === anchor.seq
            const edge = visibleIndex === 0 ? 'start' : visibleIndex === visible.length - 1 ? 'end' : undefined
            const position = visible.length === 1 ? 0 : visibleIndex / (visible.length - 1) * 100
            return (
              <button
                key={anchor.seq}
                ref={(element) => {
                  if (element === null) markRefs.current.delete(anchor.seq)
                  else markRefs.current.set(anchor.seq, element)
                }}
                type="button"
                className={css.promptRailMark}
                style={{ '--dsh-prompt-position': `${String(position)}%` } as CSSProperties}
                data-prompt-rail-mark=""
                data-active={anchor.seq === effectiveActiveSeq || undefined}
                data-steering={anchor.kind === 'steering' || undefined}
                data-edge={edge}
                tabIndex={anchor.seq === focusedSeq ? 0 : -1}
                aria-current={anchor.seq === effectiveActiveSeq ? 'true' : undefined}
                aria-label={t('promptRail.jump', { index: absoluteIndex + 1, preview: label })}
                aria-describedby={tooltipVisible ? `prompt-rail-tip-${String(anchor.seq)}` : undefined}
                onFocus={() => { setFocusSeq(anchor.seq); setTooltipSeq(anchor.seq) }}
                onBlur={() => { setTooltipSeq(current => current === anchor.seq ? null : current) }}
                onKeyDown={(event) => { onMarkKeyDown(event, anchor) }}
                onClick={() => { onActivate(anchor.seq) }}
              >
                <span className={css.promptRailTick} aria-hidden />
                {anchor.seq === effectiveActiveSeq && <span className={css.promptRailActiveDot} aria-hidden />}
                {tooltipVisible && (
                  <span id={`prompt-rail-tip-${String(anchor.seq)}`} className={css.promptRailTooltip} role="tooltip">
                    <span className={css.promptRailTooltipIndex}>
                      {t('promptRail.tooltip', {
                        index: absoluteIndex + 1,
                        time: formatMessageClock(anchor.time, t),
                      })}
                    </span>
                    <span className={css.promptRailTooltipText}>{label}</span>
                  </span>
                )}
              </button>
            )
          })}
          <span className={css.promptRailCount} data-prompt-rail-count="" aria-hidden>
            {t('promptRail.count', { current, total: anchors.length })}
          </span>
        </div>
      )}
      {compact && (
        <div className={css.promptRailCompact}>
          <button
            ref={compactTriggerRef}
            type="button"
            className={css.promptRailCompactTrigger}
            aria-expanded={compactOpen}
            aria-haspopup="dialog"
            onClick={() => { setCompactOpen(open => !open) }}
          >
            {t('promptRail.compact', { current, total: anchors.length })}
          </button>
          {compactOpen && (
            <div
              ref={compactPopoverRef}
              className={css.promptRailCompactPopover}
              role="dialog"
              aria-label={t('promptRail.compactDialog')}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeCompact(true)
                }
              }}
            >
              <div className={css.promptRailCompactList} role="list">
                {visible.map((anchor) => {
                  const absoluteIndex = indexBySeq.get(anchor.seq) ?? 0
                  const label = anchor.preview || t('promptRail.imageOnly')
                  return (
                    <div key={anchor.seq} className={css.promptRailCompactItem} role="listitem">
                      <button
                        type="button"
                        aria-current={anchor.seq === effectiveActiveSeq ? 'true' : undefined}
                        aria-label={t('promptRail.jump', { index: absoluteIndex + 1, preview: label })}
                        onClick={() => {
                          onActivate(anchor.seq)
                          closeCompact()
                        }}
                      >
                        <span>{t('promptRail.item', { index: absoluteIndex + 1 })}</span>
                        <span>{label}</span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </nav>
  )
}
