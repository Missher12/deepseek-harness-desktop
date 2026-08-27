import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PromptAnchor } from '@deepseek-ai/dsh-client-connection/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './ChatView.module.css'

const MAX_RENDERED_PROMPTS = 120

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
  const visible = useMemo(() => visiblePromptAnchors(anchors, activeSeq), [activeSeq, anchors])
  const indexBySeq = useMemo(
    () => new Map(anchors.map((anchor, index) => [anchor.seq, index] as const)),
    [anchors],
  )

  useEffect(() => {
    if (tooltipSeq !== null && !anchors.some(anchor => anchor.seq === tooltipSeq)) setTooltipSeq(null)
  }, [anchors, tooltipSeq])

  if (visible.length < 2) return null
  return (
    <nav className={css.promptRail} aria-label={t('promptRail.aria')} data-side="left">
      <div className={css.promptRailTrack}>
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
              data-active={anchor.seq === activeSeq || undefined}
              data-steering={anchor.kind === 'steering' || undefined}
              data-edge={edge}
              aria-current={anchor.seq === activeSeq ? 'true' : undefined}
              aria-label={t('promptRail.jump', { index: absoluteIndex + 1, preview: label })}
              aria-describedby={tooltipVisible ? `prompt-rail-tip-${String(anchor.seq)}` : undefined}
              onMouseEnter={() => { setTooltipSeq(anchor.seq) }}
              onMouseLeave={() => { setTooltipSeq(current => current === anchor.seq ? null : current) }}
              onFocus={() => { setTooltipSeq(anchor.seq) }}
              onBlur={() => { setTooltipSeq(current => current === anchor.seq ? null : current) }}
              onClick={() => { onActivate(anchor.seq) }}
            >
              <span className={css.promptRailTick} aria-hidden />
              {tooltipVisible && (
                <span id={`prompt-rail-tip-${String(anchor.seq)}`} className={css.promptRailTooltip} role="tooltip">
                  <span className={css.promptRailTooltipIndex}>{t('promptRail.index', { index: absoluteIndex + 1 })}</span>
                  <span className={css.promptRailTooltipText}>{label}</span>
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
