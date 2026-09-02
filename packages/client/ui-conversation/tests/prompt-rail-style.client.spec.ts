import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(
  fileURLToPath(new URL('../src/client/chat/ChatView.module.css', import.meta.url)),
  'utf8',
)

function ruleBlock(selector: string): string {
  const start = stylesheet.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`Missing CSS rule: ${selector}`)
  const end = stylesheet.indexOf('}', start)
  if (end < 0) throw new Error(`Unclosed CSS rule: ${selector}`)
  return stylesheet.slice(start, end + 1)
}

describe('PromptRail presentation', () => {
  it('anchors the rail in the conversation gutter without narrowing the message column', () => {
    expect(ruleBlock('.promptRail')).toContain('max-width: none;')
    const track = ruleBlock('.promptRailTrack')
    expect(track).toContain('left: calc(-1 * var(--dsh-composer-side-clearance));')
    expect(track).toContain('calc(100dvh - var(--dsh-composer-height, 152px) - 120px)')
    expect(track).toContain('var(--dsh-composer-height, 152px)')
    expect(track).not.toContain('right: calc(100%')
    expect(stylesheet).not.toContain('padding-inline-end: 64px;')
  })

  it('draws one selected long mark, hollow dot, and passive count from semantic tokens', () => {
    const active = ruleBlock('.promptRailMark[data-active] .promptRailTick')
    const dot = ruleBlock('.promptRailActiveDot')
    const count = ruleBlock('.promptRailCount')
    expect(active).toContain('width: 25px;')
    expect(active).toContain('background: var(--dsw-static-deepseek-500);')
    expect(dot).toContain('border: 2px solid var(--dsw-static-deepseek-500);')
    expect(dot).toContain('background: var(--dsw-alias-bg-base);')
    expect(count).toContain('pointer-events: none;')
    expect(`${active}${dot}${count}`).not.toMatch(/#[\da-f]{3,8}/iu)
  })

  it('replaces dense marks with an in-flow compact navigator below 860px', () => {
    expect(stylesheet).toContain('@media (max-width: 860px)')
    expect(stylesheet).toContain('.promptRailCompact {\n    position: relative;\n    display: flex;')
    expect(ruleBlock('.promptRailCompactPopover')).toContain('max-height: min(48vh, 360px);')
    expect(stylesheet).not.toContain('.promptRail {\n    display: none;')
  })

  it('keeps the ruler legible in forced colors and removes decorative tick motion', () => {
    expect(stylesheet).toContain('@media (forced-colors: active)')
    expect(stylesheet).toContain('border-top-color: Highlight !important;')
    expect(stylesheet).toContain('background-color: Canvas !important;')
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)')
    expect(stylesheet).toContain('.promptRailTick {\n    transition: none;')
  })
})
