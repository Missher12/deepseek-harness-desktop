import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(
  fileURLToPath(new URL('../src/client/UsageInsightsSection.module.css', import.meta.url)),
  'utf8',
)

describe('usage heatmap styles', () => {
  it('uses a structural skeleton with a reduced-motion fallback', () => {
    expect(styles).toMatch(/\.skeletonSummary\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s)
    expect(styles).toMatch(/\.skeletonBlock,\s*\.skeletonParticles i\s*\{[^}]*animation:\s*skeleton-pulse/s)
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce/s)
  })

  it('gives the dashboard a settings-native vertical rhythm', () => {
    expect(styles).toMatch(/\.section\s*\{[^}]*padding:\s*0\s+0\s+36px/s)
    expect(styles).toMatch(/\.pageHeader\s*\{[^}]*margin-bottom:\s*20px/s)
    expect(styles).toMatch(/\.pageTitle\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*24px;[^}]*font-weight:\s*500/s)
    expect(styles).toMatch(/\.pageIntro\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*22px/s)
    expect(styles).toMatch(/\.activityHeader\s*\{[^}]*margin-top:\s*32px/s)
    expect(styles).toMatch(/\.chartPanel\s*\{[^}]*margin-top:\s*16px/s)
    expect(styles).toMatch(/\.detailsGrid\s*\{[^}]*margin-top:\s*44px/s)
  })

  it('keeps all 53 by 7 zero-usage particles visible', () => {
    expect(styles).toMatch(/\.heatmap\s*\{[^}]*grid-template-rows:\s*repeat\(7,/s)
    expect(styles).toMatch(/\.heatmap\s*\{[^}]*grid-auto-flow:\s*column/s)
    expect(styles).toMatch(/\.heatmap\s*\{[^}]*aspect-ratio:\s*53\s*\/\s*7/s)
    expect(styles).toMatch(/\.heatmapWeek\s*\{[^}]*display:\s*contents/s)
    expect(styles).toMatch(/\.day\s*\{[^}]*background:\s*var\(--dsw-alias-bg-skeleton\)/s)
    expect(styles).not.toMatch(/\.weekly\s*\{/)
    expect(styles).not.toMatch(/\.cumulative\s*\{/)
    expect(styles).toMatch(/\.heatmapStage\s*\{[^}]*position:\s*relative/s)
    expect(styles).toMatch(/\.tooltip\s*\{[^}]*position:\s*absolute/s)
    expect(styles).toMatch(/\.tooltip\s*\{[^}]*border-radius:\s*8px/s)
  })
})
