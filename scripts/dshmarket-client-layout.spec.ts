import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'))
const packageRoot = dirname(desktopRequire.resolve('dshmarket/package.json'))
const source = readFileSync(join(packageRoot, 'src/client/MarketSection.tsx'), 'utf8')
const css = readFileSync(join(packageRoot, 'src/client/Market.module.css'), 'utf8')
const locales = readFileSync(join(packageRoot, 'src/client/locales.ts'), 'utf8')

describe('Harness-native dshmarket presentation', () => {
  it('renders a compact one-column plugin list with stable semantic hooks', () => {
    expect(source).toContain('data-dshmarket-layout="compact"')
    expect(source).toContain('data-dshmarket-plugin-row')
    expect(source).toContain('data-dshmarket-primary-action')
    expect(source).toContain('data-dshmarket-overflow-menu')
    expect(css).toMatch(/\.grid\{[^}]*grid-template-columns:1fr/)
    expect(css).toMatch(/\.av\{[^}]*(?:width:40px[^}]*height:40px|height:40px[^}]*width:40px)/)
    expect(css).toContain('-webkit-line-clamp:2')
  })

  it('keeps the high-frequency controls sticky and horizontally scrollable', () => {
    expect(source).toContain('data-dshmarket-toolbar')
    expect(source).toContain('data-dshmarket-categories')
    expect(css).toMatch(/\.marketToolbar\{[^}]*position:sticky/)
    expect(css).toMatch(/\.catsWrap\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/)
    expect(css).toMatch(/\.catsWrap>\*\{[^}]*flex:0 0 auto[^}]*white-space:nowrap/)
    expect(source).toContain('disabled={!categoryEdges.left}')
    expect(source).toContain('disabled={!categoryEdges.right}')
    expect(source).toContain('scrollIntoView({')
    expect(source).toMatch(/inline: 'nearest'/)
    expect(source).toMatch(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/)
    expect(css).toContain('.catsViewport[data-scroll-left="true"]::before')
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)/)
    expect(css).toMatch(/\.tabSearch\{[^}]*width:100%/)
    expect(css).toContain('var(--dsw-')
  })

  it('keeps every registry category in stable order when selection changes', async () => {
    const marketDataUrl = pathToFileURL(join(packageRoot, 'src/client/market-data.ts')).href
    const marketData = await import(marketDataUrl) as Record<string, unknown>
    const orderedCategories = marketData.orderedCategories as (categories: readonly string[]) => string[]
    const registryOrder = ['agents', 'tools', 'themes', 'memory']

    const visible = orderedCategories(registryOrder)

    expect(visible).toEqual(registryOrder)
    expect(visible).not.toBe(registryOrder)
    expect(source).toContain('orderedCategories(categories).map')
  })

  it('reflows crowded plugin actions from the market container width', () => {
    expect(css).toMatch(/\.root\{[^}]*container-type:inline-size/)
    expect(css).toMatch(
      /@container\s*\(max-width:620px\)\{[^@]*\.pluginRow\{[^}]*grid-template-columns:40px minmax\(0,1fr\) auto/s,
    )
    expect(css).toMatch(/@container\s*\(max-width:620px\)\{[^@]*\.pluginAction\{[^}]*grid-column:2/s)
  })

  it('exposes Discover, Installed, Updates, and Activity without removing legacy flows', () => {
    for (const tab of ['tabDiscover', 'tabInstalled', 'tabUpdates', 'tabActivity']) {
      expect(source).toContain(`t('${tab}')`)
      expect(locales).toContain(`${tab}:`)
    }
    expect(source).toContain("setTab('themes')")
    expect(source).toContain("setTab('backup')")
    expect(source).toContain("fetch('/dsh-market/logs'")
    for (const callback of ['setConfirming(p)', 'doUpdate(name)', 'setRemoveConfirm(name)', 'doToggle(name']) {
      expect(source).toContain(callback)
    }
  })

  it('keeps both active-market aliases read-only even when updateAvailable is true', async () => {
    // Resolve the patched dependency at runtime. A literal source import makes
    // the repository's stricter TypeScript aggregate type-check third-party
    // source with our compiler options instead of dshmarket's own build.
    const marketDataUrl = pathToFileURL(join(packageRoot, 'src/client/market-data.ts')).href
    const marketData = await import(marketDataUrl) as Record<string, unknown>
    expect(marketData).toHaveProperty('isMarketPackage')
    expect(marketData).toHaveProperty('canUpdatePackage')
    const isMarketPackage = marketData.isMarketPackage as (name: string) => boolean
    const canUpdatePackage = marketData.canUpdatePackage as (
      name: string,
      status: { updateAvailable?: boolean } | undefined,
    ) => boolean
    const available = { updateAvailable: true }

    for (const alias of ['dshmarket', 'dsh-market']) {
      expect(isMarketPackage(alias)).toBe(true)
      expect(canUpdatePackage(alias, available)).toBe(false)
    }
    expect(isMarketPackage('dsh-loop')).toBe(false)
    expect(canUpdatePackage('dsh-loop', available)).toBe(true)

    expect(source.match(/canUpdatePackage\(name, updates\[name\]\)/g)).toHaveLength(2)
    expect(source).toContain('canUpdatePackage(name, status)')
    expect(source).toContain('data-dshmarket-protected-package')
    expect(locales).toContain('managedByDesktop:')
  })
})
