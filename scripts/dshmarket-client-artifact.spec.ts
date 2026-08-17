import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'))
const packageRoot = dirname(desktopRequire.resolve('dshmarket/package.json'))

function text(relativePath: string): string {
  return readFileSync(join(packageRoot, relativePath), 'utf8')
}

describe('patched dshmarket artifacts', () => {
  it('keeps source, generated Client bundle, and source map semantically coherent', () => {
    const source = text('src/client/MarketSection.tsx')
    const bundle = text('client/client.js')
    const sourceMap = JSON.parse(text('client/client.js.map')) as { sourcesContent?: unknown[] }
    const mappedSources = (sourceMap.sourcesContent ?? []).filter((value): value is string => typeof value === 'string').join('\n')

    for (const artifact of [source, bundle, mappedSources]) {
      expect(artifact).toContain('data-dshmarket-layout')
      expect(artifact).toContain('data-dshmarket-plugin-row')
      expect(artifact).toContain('data-dshmarket-tab')
    }
  })

  it('ships the Host self-protection marker in source and generated output', () => {
    for (const artifact of [text('src/routes.ts'), text('lib/routes.js')]) {
      expect(artifact).toContain('self-protected')
      expect(artifact).toContain('dshmarket')
      expect(artifact).toContain('dsh-market')
    }
  })

  it('retains the exact npm integrity while applying a locked pnpm patch hash', () => {
    const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
    expect(lockfile).toContain('dshmarket@1.10.1: 243d2d50d32d816f00d8238f8c9b35b323571b18b984d91d6b851d59cf2531d2')
    expect(lockfile).toContain('integrity: sha512-8AWM8RT2tttJsozTBm6mAfI+cNpCIbeBdP9IoydJdHlH/+x72aNqmv3AWdbNfKDDwkkqM2Ce/XRDhha9HG0Q5Q==')
  })
})
