import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'

const PACKAGE_ROOT = new URL('../', import.meta.url)
const PINNED_SPRITE_SHA256 = '1222c5a2a70087cacb6da338f5d6e3e3fa7585259c67a80a943b2cab6901f51e'
const WORKSPACE_PEERS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-settings',
] as const

interface PackageManifest {
  readonly name: string
  readonly version: string
  readonly publishConfig: { readonly access: string }
  readonly repository: {
    readonly type: string
    readonly url: string
    readonly directory: string
  }
  readonly type: string
  readonly main: string
  readonly types: string
  readonly exports: Record<string, string | {
    readonly types: string
    readonly default: string
  }>
  readonly dsh: {
    readonly client: { readonly platform: string }
    readonly bundle: { readonly patch: string }
  }
  readonly files: readonly string[]
  readonly peerDependencies: Record<string, string>
  readonly devDependencies: Record<string, string>
}

async function readManifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(new URL('package.json', PACKAGE_ROOT), 'utf8')) as PackageManifest
}

describe('@deepseek-ai/dsh-reasoning-effort package shape', () => {
  test('is a public rc.5 workspace release member with package invariant exports', async () => {
    const manifest = await readManifest()

    expect(manifest.name).toBe('@deepseek-ai/dsh-reasoning-effort')
    expect(manifest.name).toMatch(/^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(manifest.version).toBe('0.1.0-rc.5')
    expect(manifest.publishConfig).toEqual({ access: 'public' })
    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/deepseek-ai/deepseek-harness.git',
      directory: 'packages/extensions/reasoning-effort',
    })
    expect(manifest.type).toBe('module')
    expect(manifest.main).toBe('lib/index.js')
    expect(manifest.types).toBe('lib/types/index.d.ts')
    expect(manifest.exports['.']).toEqual({
      types: './lib/types/index.d.ts',
      default: './lib/index.js',
    })
    expect(manifest.exports['./invariant']).toEqual({
      types: './lib/types/invariant.d.ts',
      default: './lib/invariant.js',
    })
    expect(manifest.exports['./client']).toEqual({
      types: './lib/types/client/index.d.ts',
      default: './lib/client.js',
    })
    expect(manifest.files).toEqual([
      'lib/index.js',
      'lib/invariant.js',
      'lib/client.js',
      'cordis.patch.yml',
      'lib/assets',
      'lib/types/**/*.d.ts',
    ])
  })

  test('declares a Web client and independently installable bundle patch', async () => {
    const manifest = await readManifest()

    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
  })

  test('pins Harness peers to the rc.5 workspace and React 18', async () => {
    const manifest = await readManifest()

    for (const dependency of WORKSPACE_PEERS) {
      expect(manifest.peerDependencies[dependency], dependency).toBe('workspace:^')
      expect(manifest.devDependencies[dependency], dependency).toBe('workspace:^')
    }
    expect(manifest.peerDependencies.react).toBe('^18.2.0')
    expect(manifest.devDependencies.react).toBe('^18.2.0')
    expect(manifest.peerDependencies['react-dom']).toBe('^18.2.0')
    expect(manifest.devDependencies['react-dom']).toBe('^18.2.0')
  })

  test('preserves the pinned upstream license, attribution, and sprite bytes', async () => {
    const [license, notices, sprite] = await Promise.all([
      readFile(new URL('LICENSE', PACKAGE_ROOT), 'utf8'),
      readFile(new URL('THIRD_PARTY_NOTICES.md', PACKAGE_ROOT), 'utf8'),
      readFile(new URL('assets/chibi-runner-strip.png', PACKAGE_ROOT)),
    ])

    expect(license).toContain('Copyright (c) 2026 HanaAyane')
    expect(license).toContain('Permission is hereby granted, free of charge')
    expect(notices).toContain('https://github.com/HanaAyane/dsh-reasoning-effort')
    expect(notices).toContain('f94622b46078ac8c064f91bdc10ab27e8cf32270')
    expect(notices).toContain('assets/chibi-runner-strip.png')
    expect(createHash('sha256').update(sprite).digest('hex')).toBe(PINNED_SPRITE_SHA256)
  })

  test('inserts exactly one scoped reasoning-effort row', async () => {
    const patch = await readFile(new URL('cordis.patch.yml', PACKAGE_ROOT), 'utf8')
    const content = patch
      .split('\n')
      .filter(line => line.trim() !== '' && !line.trimStart().startsWith('#'))
      .join('\n')

    expect(content).toBe([
      '- insert:',
      '    - id: reasoning-effort',
      "      name: '@deepseek-ai/dsh-reasoning-effort'",
    ].join('\n'))
  })
})
