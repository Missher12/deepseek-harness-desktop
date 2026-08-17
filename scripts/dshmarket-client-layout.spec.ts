import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
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
    expect(css).toContain('var(--dsw-')
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
})
