/** TurnNavigator geometry contracts (alpha.5 official rail). */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const cssPath = new URL('../src/client/chat/TurnNavigator.module.css', import.meta.url)
const tsxPath = new URL('../src/client/chat/TurnNavigator.tsx', import.meta.url)

describe('TurnNavigator geometry', () => {
  it('keeps the fixed 10px pitch and 6px rail inset in one place', async () => {
    const [tsx, css] = await Promise.all([
      readFile(tsxPath, 'utf8'),
      readFile(cssPath, 'utf8'),
    ])
    expect(tsx).toMatch(/TURN_SPACING_PX = 10/u)
    expect(tsx).toMatch(/RAIL_INSET_PX = 6/u)
    expect(css).toContain('height: 10px')
    expect(css).toContain('var(--turn-rail-inset)')
  })

  it('sizes the rail band from the viewport minus the composer floor', async () => {
    const css = await readFile(cssPath, 'utf8')
    expect(css).toContain('--turn-rail-band')
    expect(css).toMatch(/var\(--dsh-composer-height/u)
    expect(css).toMatch(/var\(--dsh-conversation-viewport-height/u)
    // The band can never run under the composer or leave a negative frame.
    expect(css).not.toMatch(/bottom:\s*-[0-9]/u)
    expect(css).toContain('max(0px, calc(var(--turn-rail-band) - 64px))')
  })

  it('keeps the preview at most 300px wide, clamped inside the rail band', async () => {
    const css = await readFile(cssPath, 'utf8')
    expect(css).toMatch(/width:\s*min\(300px/u)
    expect(css).toContain('clamp(')
    expect(css).toContain('calc(100% - var(--turn-preview-height))')
  })

  it('anchors the rail in the start gutter and opens its preview toward the transcript', async () => {
    const css = await readFile(cssPath, 'utf8')

    expect(css).toMatch(/\.frame\s*\{[\s\S]*?inset-inline-start:\s*calc\(/u)
    expect(css).toMatch(/\.frame\s*\{[\s\S]*?inset-inline-start:\s*calc\(0px -/u)
    expect(css).toMatch(/\.frame\s*\{[\s\S]*?width:\s*20px/u)
    expect(css).not.toMatch(/\.frame\s*\{[\s\S]*?right:\s*calc\(/u)
    expect(css).toMatch(/\.mark\s*\{[\s\S]*?inset-inline-start:\s*0/u)
    expect(css).toMatch(/\.mark::before\s*\{[\s\S]*?inset-inline-start:\s*0/u)
    expect(css).toMatch(/\.preview\s*\{[\s\S]*?inset-inline-start:\s*calc\(100% \+ 10px\)/u)
    expect(css).toMatch(/from \{ opacity: 0; transform: translateX\(-4px\); \}/u)
  })

  it('hides the zero-height rail only when the center column is truly narrow', async () => {
    const css = await readFile(cssPath, 'utf8')

    // The query container is ChatView's content box, after 32px padding on
    // each side. A 616px content box therefore represents the 680px center
    // column cutoff promised by the Desktop layout contract.
    expect(css).toContain('@container (max-width: 616px)')
    expect(css).not.toContain('@container (max-width: 900px)')
    expect(css).toMatch(/\.slot\s*\{[\s\S]*?height:\s*0/u)
  })

  it('renders one prompt line and three response lines with mark-tick states', async () => {
    const css = await readFile(cssPath, 'utf8')
    expect(css).toContain('-webkit-line-clamp: 1')
    expect(css).toContain('-webkit-line-clamp: 3')
    // Marks are keyboard destinations, never mouse targets of their own.
    expect(css).toContain('pointer-events: none')
    // Hover/focus states never widen the transcript or the composer.
    expect(css).not.toMatch(/margin-(?:left|right)/u)
  })

  it('honors reduced motion across the rail', async () => {
    const css = await readFile(cssPath, 'utf8')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toMatch(/animation:\s*none/u)
    expect(css).toMatch(/transition:\s*none/u)
  })
})
