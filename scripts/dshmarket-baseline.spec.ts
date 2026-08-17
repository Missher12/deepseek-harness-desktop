import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'))
const packageRoot = dirname(desktopRequire.resolve('dshmarket/package.json'))
const fixturePath = join(import.meta.dirname, 'fixtures/dshmarket-1.10.1-baseline.json')

interface BaselineFixture {
  integrity: string
  upstreamHead: string
  files: Record<string, string>
}

function text(path: string): string {
  return readFileSync(path, 'utf8')
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

describe('dshmarket dependency baseline', () => {
  it('locks the exact package, registry integrity, upstream commit, and client identities', () => {
    const manifest = JSON.parse(text(join(packageRoot, 'package.json'))) as { name?: string; version?: string }
    const baseline = JSON.parse(text(fixturePath)) as BaselineFixture
    const lockfile = text(join(root, 'pnpm-lock.yaml'))
    const clientSource = text(join(packageRoot, 'src/client/index.ts'))

    expect(manifest).toMatchObject({ name: 'dshmarket', version: '1.10.1' })
    expect(baseline.upstreamHead).toBe('6970a6f801108c04234eb953ff0f707feffa621a')
    expect(baseline.integrity).toBe('sha512-8AWM8RT2tttJsozTBm6mAfI+cNpCIbeBdP9IoydJdHlH/+x72aNqmv3AWdbNfKDDwkkqM2Ce/XRDhha9HG0Q5Q==')
    expect(lockfile).toContain(`integrity: ${baseline.integrity}`)
    expect(clientSource).toContain("export const name = 'dsh-market'")
    expect(clientSource).toContain("id: 'market'")
  })

  it('locks only stable source file hashes, not generated CSS module hashes', () => {
    const baseline = JSON.parse(text(fixturePath)) as BaselineFixture
    const workspace = text(join(root, 'pnpm-workspace.yaml'))
    const patchFile = join(root, 'patches/dshmarket@1.10.1.patch')
    const patched = workspace.includes('dshmarket@1.10.1: patches/dshmarket@1.10.1.patch')
    expect(Object.keys(baseline.files).sort()).toEqual([
      'src/client/Market.module.css',
      'src/client/MarketSection.tsx',
      'src/client/index.ts',
      'src/routes.ts',
    ])
    for (const [relativePath, expectedHash] of Object.entries(baseline.files)) {
      const currentHash = sha256(join(packageRoot, relativePath))
      if (!patched || relativePath === 'src/client/index.ts') {
        expect(currentHash, relativePath).toBe(expectedHash)
      } else {
        expect(text(patchFile), relativePath).toContain(`diff --git a/${relativePath} b/${relativePath}`)
        expect(currentHash, relativePath).not.toBe(expectedHash)
      }
    }
  })
})
