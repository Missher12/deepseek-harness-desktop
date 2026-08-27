import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
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

/** Codex-style prompt timeline: navigation only, with no rewind semantics. */
export function PromptRail({ anchors, activeSeq, onActivate, t }: PromptRailProps) {
  const [tooltipSeq, setTooltipSeq] = useState<number | null>(null)
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

  return (
    <nav className={css.promptRail} aria-label={t('promptRail.aria')} data-side="left">
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
              type="button"
              className={css.promptRailMark}
              style={{ '--dsh-prompt-position': `${String(position)}%` } as CSSProperties}
              data-active={anchor.seq === effectiveActiveSeq || undefined}
              data-steering={anchor.kind === 'steering' || undefined}
              data-edge={edge}
              aria-current={anchor.seq === effectiveActiveSeq ? 'true' : undefined}
              aria-label={t('promptRail.jump', { index: absoluteIndex + 1, preview: label })}
              aria-describedby={tooltipVisible ? `prompt-rail-tip-${String(anchor.seq)}` : undefined}
              onFocus={() => { setTooltipSeq(anchor.seq) }}
              onBlur={() => { setTooltipSeq(current => current === anchor.seq ? null : current) }}
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
    </nav>
  )
}
