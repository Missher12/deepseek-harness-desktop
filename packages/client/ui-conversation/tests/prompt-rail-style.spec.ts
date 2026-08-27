import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as promptRail from '../src/client/chat/PromptRail.tsx'

const stylesheet = readFileSync(
  new URL('../src/client/chat/ChatView.module.css', import.meta.url),
  'utf8',
)

type NearestPromptIndex = (input: { y: number; top: number; height: number; count: number }) => number
const nearestPromptIndex = (promptRail as { nearestPromptIndex?: NearestPromptIndex }).nearestPromptIndex
const activeTickPattern = [
  '\\.promptRailMark\\[data-active\\][^{]*\\.promptRailTick\\s*\\{',
  '[^}]*width:\\s*(24|25)px;',
  '[^}]*background:\\s*var\\(--dsw-static-deepseek-500\\)',
].join('')

describe('PromptRail presentation', () => {
  it('uses defined neutral-label tokens with a fallback and reserves pointer hits for the track', () => {
    expect(stylesheet).not.toContain('--dsw-alias-label-quaternary')
    expect(stylesheet).toMatch(/var\(--dsw-alias-label-tertiary,\s*[^)]+\)/)
    expect(stylesheet).toMatch(/\.promptRailMark\s*\{[^}]*pointer-events:\s*none;/s)
  })

  it('draws the selected prompt as a DeepSeek-blue line with a hollow dot', () => {
    expect(stylesheet).toMatch(new RegExp(activeTickPattern, 's'))
    expect(stylesheet).toMatch(/\.promptRailActiveDot\s*\{[^}]*border:.*var\(--dsw-static-deepseek-500\)/s)
    expect(stylesheet).not.toMatch(/\.promptRailActiveDot\s*\{[^}]*background:\s*var\(--dsw-alias-tooltip-bg\)/s)
    expect(stylesheet).toMatch(/\.promptRailActiveDot\s*\{[^}]*background:\s*var\(--dsw-alias-bg-base,\s*#fff\)/s)
  })

  it('selects the nearest prompt index from a clamped rail coordinate', () => {
    expect(nearestPromptIndex).toBeTypeOf('function')
    expect(nearestPromptIndex?.({ y: 260, top: 0, height: 520, count: 120 })).toBe(60)
    expect(nearestPromptIndex?.({ y: -20, top: 0, height: 520, count: 120 })).toBe(0)
    expect(nearestPromptIndex?.({ y: 600, top: 0, height: 520, count: 120 })).toBe(119)
  })
})
