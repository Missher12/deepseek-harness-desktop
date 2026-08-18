import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'))
const packageRoot = dirname(desktopRequire.resolve('dshmarket/package.json'))

function text(relativePath: string): string {
  return readFileSync(join(packageRoot, relativePath), 'utf8')
}

describe('patched dshmarket artifacts', () => {
  it('ships a syntactically valid browser bundle', () => {
    const bundle = text('client/client.js')
    expect(() => new Script(bundle, { filename: 'dshmarket/client/client.js' })).not.toThrow()
  })

  it('keeps source, generated Client bundle, and source map semantically coherent', () => {
    const source = text('src/client/MarketSection.tsx')
    const bundle = text('client/client.js')
    const sourceMap = JSON.parse(text('client/client.js.map')) as { sourcesContent?: unknown[] }
    const mappedSources = (sourceMap.sourcesContent ?? []).filter((value): value is string => typeof value === 'string').join('\n')

    for (const artifact of [source, bundle, mappedSources]) {
      expect(artifact).toContain('data-dshmarket-layout')
      expect(artifact).toContain('data-dshmarket-plugin-row')
      expect(artifact).toContain('data-dshmarket-tab')
      expect(artifact).toContain('data-scroll-right')
      expect(artifact).toContain('categoriesNext')
    }
  })

  it('ships the Host self-protection marker in source and generated output', () => {
    for (const artifact of [text('src/routes.ts'), text('lib/routes.js')]) {
      expect(artifact).toContain('self-protected')
      expect(artifact).toContain('dshmarket')
      expect(artifact).toContain('dsh-market')
    }
  })

  it('ships the read-only active-market state in source, bundle, and source map', () => {
    const source = text('src/client/MarketSection.tsx')
    const bundle = text('client/client.js')
    const sourceMap = text('client/client.js.map')

    for (const artifact of [source, bundle, sourceMap]) {
      expect(artifact).toContain('data-dshmarket-protected-package')
      expect(artifact).toContain('managedByDesktop')
      expect(artifact).toContain('canUpdatePackage')
    }
  })

  it('retains the exact npm integrity while applying a locked pnpm patch hash', () => {
    const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
    expect(lockfile).toContain('dshmarket@1.10.1: e9f0960f8efa27f20bbf2625a2d10864e6b22911f5ddd93bc12335764b0b0f9b')
    expect(lockfile).toContain('integrity: sha512-8AWM8RT2tttJsozTBm6mAfI+cNpCIbeBdP9IoydJdHlH/+x72aNqmv3AWdbNfKDDwkkqM2Ce/XRDhha9HG0Q5Q==')
  })
})
