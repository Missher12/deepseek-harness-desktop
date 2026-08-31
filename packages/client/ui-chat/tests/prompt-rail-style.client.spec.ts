import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as promptRail from '../src/client/chat/PromptRail.tsx'

const stylesheet = readFileSync(
  new URL('../src/client/chat/ChatView.module.css', import.meta.url),
  'utf8',
)

type NearestPromptIndex = (input: { y: number; top: number; height: number; count: number }) => number
const nearestPromptIndex = (promptRail as { nearestPromptIndex?: NearestPromptIndex }).nearestPromptIndex

function ruleBlock(selector: string): string {
  const start = stylesheet.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`Missing CSS rule: ${selector}`)
  const end = stylesheet.indexOf('}', start)
  if (end < 0) throw new Error(`Unclosed CSS rule: ${selector}`)
  return stylesheet.slice(start, end + 1)
}

describe('PromptRail presentation in ui-chat', () => {
  it('uses defined neutral-label tokens with a fallback and reserves pointer hits for the track', () => {
    const tick = ruleBlock('.promptRailTick')
    const mark = ruleBlock('.promptRailMark')
    const count = ruleBlock('.promptRailCount')
    expect(tick).not.toContain('--dsw-alias-label-quaternary')
    expect(tick).toContain('background: var(--dsw-alias-label-tertiary, #8c8c8c);')
    expect(mark).toContain('pointer-events: none;')
    expect(count).toContain('pointer-events: none;')
  })

  it('draws the selected prompt as a DeepSeek-blue line with a hollow dot', () => {
    const activeTick = ruleBlock('.promptRailMark[data-active] .promptRailTick')
    const dot = ruleBlock('.promptRailActiveDot')
    expect(activeTick).toContain('width: 25px;')
    expect(activeTick).toContain('height: 2px;')
    expect(activeTick).toContain('background: var(--dsw-static-deepseek-500);')
    expect(dot).toContain('width: 14px;')
    expect(dot).toContain('height: 14px;')
    expect(dot).toContain('border: 2px solid var(--dsw-static-deepseek-500);')
    expect(dot).toContain('border-radius: 50%;')
    expect(dot).toContain('background: var(--dsw-alias-bg-base, #fff);')
    expect(dot).not.toContain('--dsw-alias-tooltip-bg')
  })

  it('keeps tick centers on the rail endpoints and only clamps edge tooltips', () => {
    expect(ruleBlock('.promptRailMark')).toContain('transform: translateY(-50%);')
    expect(stylesheet).not.toContain(".promptRailMark[data-edge='start'] {")
    expect(stylesheet).not.toContain(".promptRailMark[data-edge='end'] {")
    expect(ruleBlock(".promptRailMark[data-edge='start'] .promptRailTooltip")).toContain('top: 50%;')
    expect(ruleBlock(".promptRailMark[data-edge='start'] .promptRailTooltip")).toContain('transform: none;')
    expect(ruleBlock(".promptRailMark[data-edge='end'] .promptRailTooltip")).toContain('top: 50%;')
    expect(ruleBlock(".promptRailMark[data-edge='end'] .promptRailTooltip")).toContain('transform: translateY(-100%);')
  })

  it('subtracts the measured composer stack from the actual conversation viewport', () => {
    const rail = ruleBlock('.promptRail')
    const track = ruleBlock('.promptRailTrack')
    expect(rail).toContain('max-width: none;')
    expect(track).toContain('left: calc(-1 * var(--dsh-composer-side-clearance));')
    expect(track).not.toContain('right:')
    expect(track).toContain('var(--dsh-composer-height')
    expect(track).toContain('var(--dsh-conversation-viewport-height')
    expect(track).not.toContain('100dvh')
  })

  it('keeps the split-view ruler and compact trigger outside message text', () => {
    expect(stylesheet).toContain('@container (max-width: 720px) {\n  .promptRailTrack {\n    left: calc(-1 * var(--dsh-composer-side-clearance) - 7px);')
    expect(stylesheet).toContain('.promptRailMark[data-active] .promptRailTick {\n    width: 15px;')
    expect(stylesheet).toContain('@media (max-width: 860px) {\n  .column {\n    box-sizing: border-box;\n    padding-inline-end: 64px;')
  })

  it('pins forced-colors marks to system colors and disables tick motion when requested', () => {
    expect(stylesheet).toContain('.promptRailTick,\n  .promptRailActiveDot {\n    forced-color-adjust: none;')
    expect(stylesheet).toContain('.promptRailTrack::before {\n    background-color: CanvasText !important;')
    expect(stylesheet).toContain('.promptRailTick {\n    height: 0;\n    border-top: 1px solid CanvasText !important;')
    expect(stylesheet).toContain('.promptRailMark[data-active] .promptRailTick {\n    border-top-color: Highlight !important;\n    border-top-width: 2px;')
    expect(stylesheet).toContain('.promptRailActiveDot {\n    border-color: Highlight;\n    background-color: Canvas !important;')
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce) {\n  .promptRailTick {\n    transition: none;')
  })

  it('leaves the conditionally mounted compact control visible until its mode handoff commits', () => {
    expect(ruleBlock('.promptRailCompact')).not.toContain('display: none;')
    expect(stylesheet).toContain('.promptRailCompact {\n    position: relative;\n    display: flex;')
  })

  it('selects the nearest prompt index from a clamped rail coordinate', () => {
    expect(nearestPromptIndex).toBeTypeOf('function')
    expect(nearestPromptIndex?.({ y: 260, top: 0, height: 520, count: 120 })).toBe(60)
    expect(nearestPromptIndex?.({ y: 20, top: 20, height: 180, count: 120 })).toBe(0)
    expect(nearestPromptIndex?.({ y: 200, top: 20, height: 180, count: 120 })).toBe(119)
    expect(nearestPromptIndex?.({ y: 20 + 180 * 59.49 / 119, top: 20, height: 180, count: 120 })).toBe(59)
    expect(nearestPromptIndex?.({ y: 20 + 180 * 59.51 / 119, top: 20, height: 180, count: 120 })).toBe(60)
    expect(nearestPromptIndex?.({ y: 89.9, top: 0, height: 180, count: 2 })).toBe(0)
    expect(nearestPromptIndex?.({ y: 90, top: 0, height: 180, count: 2 })).toBe(1)
    expect(nearestPromptIndex?.({ y: 30, top: 20, height: 0, count: 120 })).toBe(0)
    expect(nearestPromptIndex?.({ y: 30, top: 20, height: 180, count: 1 })).toBe(0)
    expect(nearestPromptIndex?.({ y: 30, top: 20, height: 180, count: 0 })).toBe(-1)
    expect(nearestPromptIndex?.({ y: -20, top: 0, height: 520, count: 120 })).toBe(0)
    expect(nearestPromptIndex?.({ y: 600, top: 0, height: 520, count: 120 })).toBe(119)
  })
})
