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
  it('renders the approved reference hierarchy with stable semantic hooks', () => {
    expect(source).toContain('data-dshmarket-layout="reference"')
    expect(source).toContain('data-dshmarket-search')
    expect(source).toContain('data-dshmarket-installed-rail')
    expect(source).toContain('data-dshmarket-management-trigger')
    expect(source).toContain('data-dshmarket-mode="public"')
    expect(source).toContain('data-dshmarket-mode="personal"')
    expect(source).toContain('data-dshmarket-section')
    expect(source).toContain('data-dshmarket-section-remainder')
    expect(source).toContain('data-dshmarket-plugin-row')
    expect(source).toContain('data-dshmarket-plugin-description')
    expect(source).toContain('data-dshmarket-primary-action')
    expect(source).toContain('data-dshmarket-overflow-menu')
    expect(source).toContain('IconEllipsisOutline16')
    expect(source).toContain("aria-label={`${t('moreActions')}: ${p.name}`}")
    expect(source).toContain('className={css.avatarInitial}')
    expect(source).toContain('className={`${css.avatarImage} ${loaded ? css.avatarImageReady : \'\'}`}')
    expect(source).toContain('onLoad={() => setLoaded(true)}')
    expect(css).toMatch(/\.sectionGrid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
    expect(css).toMatch(/\.av\{[^}]*(?:width:40px[^}]*height:40px|height:40px[^}]*width:40px)[^}]*position:relative[^}]*overflow:hidden/)
    expect(css).toMatch(/\.avatarImage\{[^}]*position:absolute[^}]*opacity:0/)
    expect(css).toMatch(/\.avatarImageReady\{[^}]*opacity:1/)
    expect(css).toMatch(/\.desc\{[^}]*-webkit-line-clamp:1/)
    expect(css).toMatch(/\.primaryAction\{[^}]*height:30px/)
    expect(css).toMatch(/@container\s*\(max-width:680px\)\{[^@]*\.sectionGrid\{[^}]*grid-template-columns:1fr/s)
  })

  it('keeps the installed rail scrollable and the real search ahead of catalog sections', () => {
    expect(css).toMatch(/\.installedRail\{[^}]*overflow-x:auto/)
    expect(css).toMatch(/\.search\{[^}]*width:100%/)
    expect(source.indexOf('data-dshmarket-search')).toBeLessThan(source.indexOf('data-dshmarket-installed-rail'))
    expect(source.indexOf('data-dshmarket-installed-rail')).toBeLessThan(source.indexOf('data-dshmarket-mode="public"'))
    expect(source.indexOf('data-dshmarket-mode="public"')).toBeLessThan(source.indexOf('data-dshmarket-section'))
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
    expect(source).toContain('catalogSections(')
  })

  it('derives Featured and bounded category previews without duplicate plugins', async () => {
    const marketDataUrl = pathToFileURL(join(packageRoot, 'src/client/market-data.ts')).href
    const marketData = await import(marketDataUrl) as Record<string, unknown>
    const catalogSections = marketData.catalogSections as (
      registry: { categories: Record<string, Record<string, string>> },
      plugins: Array<{ name: string; owner: string; url: string; category: string; stars?: number; deprecated?: boolean }>,
      previewLimit: number,
    ) => Array<{ id: string; plugins: Array<{ name: string }>; remainder: number }>
    const plugins = [
      { name: 'tools-top', owner: 'a', url: 'https://example.com/a', category: 'tools', stars: 100 },
      { name: 'ui-top', owner: 'b', url: 'https://example.com/b', category: 'ui', stars: 90 },
      { name: 'tools-next', owner: 'c', url: 'https://example.com/c', category: 'tools', stars: 80 },
      { name: 'tools-last', owner: 'd', url: 'https://example.com/d', category: 'tools', stars: 70 },
      { name: 'ui-next', owner: 'e', url: 'https://example.com/e', category: 'ui', stars: 60 },
      { name: 'deprecated', owner: 'f', url: 'https://example.com/f', category: 'ui', stars: 999, deprecated: true },
    ]

    const sections = catalogSections({ categories: { tools: { en: 'Tools' }, ui: { en: 'UI' } } }, plugins, 2)

    expect(sections.map(section => section.id)).toEqual(['featured', 'tools', 'ui'])
    expect(sections[0]?.plugins.map(plugin => plugin.name)).toEqual(['tools-top', 'ui-top'])
    expect(sections[1]).toMatchObject({ remainder: 0 })
    expect(sections[1]?.plugins.map(plugin => plugin.name)).toEqual(['tools-next', 'tools-last'])
    expect(sections[2]?.plugins.map(plugin => plugin.name)).toEqual(['ui-next', 'deprecated'])
    const overviewNames = sections.flatMap(section => section.plugins.map(plugin => plugin.name))
    expect(new Set(overviewNames).size).toBe(overviewNames.length)
  })

  it('classifies only file and link dependency specs as personal plugins', async () => {
    const marketDataUrl = pathToFileURL(join(packageRoot, 'src/client/market-data.ts')).href
    const marketData = await import(marketDataUrl) as Record<string, unknown>
    const personalPluginNames = marketData.personalPluginNames as (installed: Record<string, string>) => string[]

    expect(personalPluginNames({
      linked: 'link:/tmp/linked',
      copied: 'file:/tmp/copied',
      public: '^1.2.3',
      github: 'github:owner/plugin',
    })).toEqual(['linked', 'copied'])
  })

  it('searches the real catalog by name, owner, and active localized description', async () => {
    const marketDataUrl = pathToFileURL(join(packageRoot, 'src/client/market-data.ts')).href
    const marketData = await import(marketDataUrl) as Record<string, unknown>
    const visiblePlugins = marketData.visiblePlugins as (
      plugins: Array<{ name: string; owner: string; url: string; category: string; description?: Record<string, string> }>,
      query: { category: string; query: string; lang: string; sort: string },
    ) => Array<{ name: string }>
    const plugins = [
      { name: 'alpha-tool', owner: 'north', url: 'https://example.com/a', category: 'tools', description: { zh: '数据清理', en: 'Cleanup' } },
      { name: 'beta-tool', owner: 'south-lab', url: 'https://example.com/b', category: 'tools', description: { zh: '浏览器助手', en: 'Browser helper' } },
    ]

    const search = (query: string) => visiblePlugins(plugins, { category: 'all', query, lang: 'zh', sort: 'registry' })
      .map(plugin => plugin.name)
    expect(search('ALPHA')).toEqual(['alpha-tool'])
    expect(search('south')).toEqual(['beta-tool'])
    expect(search('浏览器')).toEqual(['beta-tool'])
  })

  it('keeps each flat plugin row readable with one trailing action', () => {
    expect(css).toMatch(/\.root\{[^}]*container-type:inline-size/)
    expect(css).toMatch(
      /\.pluginRow\{[^}]*grid-template-columns:40px minmax\(0,1fr\) auto[^}]*align-items:center/,
    )
    expect(css).toMatch(/\.pluginRow\{[^}]*border:none/)
    expect(css).toMatch(/\.pluginCopy\{[^}]*min-width:0/)
  })

  it('moves maintenance destinations behind management without removing legacy flows', () => {
    for (const tab of ['installed', 'updates', 'activity', 'themes', 'backup']) {
      expect(source).toContain(`id: '${tab}'`)
    }
    for (const key of ['manageInstalled', 'tabUpdates', 'tabActivity', 'tabThemes', 'tabBackup']) {
      expect(locales).toContain(`${key}:`)
    }
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
