import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'))
const packageRoot = dirname(desktopRequire.resolve('dshmarket/package.json'))
const profileUrl = pathToFileURL(join(packageRoot, 'src/profile.ts')).href

interface ProfileModule {
  readProfileManifestSnapshot(profile: string, root: string): unknown
  restoreProfileManifestSnapshot(profile: string, snapshot: unknown, root: string): string[]
  classifyBundleResidue(root: string): { repairable: string[]; ambiguous: string[] }
  repairBundleResidue(root: string, name: string, now?: number): { removed: string; backupPath: string }
}

const profile = await import(profileUrl) as unknown as ProfileModule

const directories: string[] = []

interface TestProfileManifest {
  dependencies: Record<string, string>
  dsh: { profile: { bundles: string[] } }
  untouched?: { keep: boolean }
}

function readManifest(path: string): TestProfileManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as TestProfileManifest
}

function makeProfile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dshmarket-profile-transaction-'))
  directories.push(directory)
  mkdirSync(join(directory, 'node_modules/@deepseek-ai/dsh-base'), { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
    name: 'fixture-profile',
    private: true,
    dependencies: {
      '@deepseek-ai/dsh-base': 'workspace:*',
      '@example/existing': '1.0.0',
    },
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@example/existing'],
      },
    },
    untouched: { keep: true },
  }, null, 2)}\n`)
  return directory
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true })
})

describe('market profile manifest transaction', () => {
  it('restores dependencies and bundle names as one exact snapshot', () => {
    const directory = makeProfile()
    const snapshot = profile.readProfileManifestSnapshot('web', directory)
    const file = join(directory, 'package.json')
    const mutated = readManifest(file)
    mutated.dependencies = {
      '@deepseek-ai/dsh-base': 'workspace:*',
      '@example/ghost-carrier': '0.2.1',
    }
    mutated.dsh.profile.bundles = [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@example/ghost-carrier',
    ]
    writeFileSync(file, `${JSON.stringify(mutated, null, 2)}\n`)

    expect(profile.restoreProfileManifestSnapshot('web', snapshot, directory)).toEqual([
      '@example/existing',
      '@example/ghost-carrier',
    ])
    const restored = readManifest(file)
    expect(restored.dependencies).toEqual({
      '@deepseek-ai/dsh-base': 'workspace:*',
      '@example/existing': '1.0.0',
    })
    expect(restored.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@example/existing',
    ])
    expect(restored.untouched).toEqual({ keep: true })
  })

  it('classifies only proven-missing external bundle references as repairable', () => {
    const directory = makeProfile()
    const file = join(directory, 'package.json')
    const manifest = readManifest(file)
    manifest.dependencies = { '@example/existing': '1.0.0' }
    manifest.dsh.profile.bundles.push('@example/missing', '@example/ambiguous')
    mkdirSync(join(directory, 'node_modules/@example/ambiguous'), { recursive: true })
    writeFileSync(join(directory, 'node_modules/@example/ambiguous/package.json'), '{}')
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)

    expect(profile.classifyBundleResidue(directory)).toEqual({
      repairable: ['@example/missing'],
      ambiguous: ['@example/ambiguous'],
    })
  })

  it('backs up the manifest before removing exactly one repairable bundle', () => {
    const directory = makeProfile()
    const file = join(directory, 'package.json')
    const manifest = readManifest(file)
    manifest.dsh.profile.bundles.push('@example/missing')
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = profile.repairBundleResidue(directory, '@example/missing', 1_787_196_400_000)
    expect(result.removed).toBe('@example/missing')
    expect(readFileSync(result.backupPath, 'utf8')).toBe(`${JSON.stringify(manifest, null, 2)}\n`)
    const repaired = readManifest(file)
    expect(repaired.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@example/existing',
    ])
  })

  it('refuses to repair an ambiguous or installed bundle reference', () => {
    const directory = makeProfile()
    expect(() => profile.repairBundleResidue(directory, '@example/existing')).toThrow(/not repairable/i)
  })
})
