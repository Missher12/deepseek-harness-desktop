import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'

const PACKAGE_ROOT = new URL('../', import.meta.url)
const REPOSITORY_ROOT = new URL('../../../', PACKAGE_ROOT)
const PINNED_LICENSE_SHA256 = 'c3cf95d2fa3e68f8a40cc4bd941097b85e740623df940fd4ded471065d74fa06'
const PINNED_SPRITE_SHA256 = '1222c5a2a70087cacb6da338f5d6e3e3fa7585259c67a80a943b2cab6901f51e'
const WORKSPACE_PEERS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-host-webserver',
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
    readonly client: { readonly inject: readonly string[]; readonly platform: string }
    readonly bundle: { readonly patch: string }
  }
  readonly files: readonly string[]
  readonly dependencies?: Record<string, string>
  readonly peerDependencies: Record<string, string>
  readonly devDependencies: Record<string, string>
}

async function readManifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(new URL('package.json', PACKAGE_ROOT), 'utf8')) as PackageManifest
}

async function readRepositoryVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(new URL('package.json', REPOSITORY_ROOT), 'utf8')) as { version: string }
  return manifest.version
}

describe('@deepseek-ai/dsh-reasoning-effort package shape', () => {
  test('is a public workspace release member', async () => {
    const manifest = await readManifest()

    expect(manifest.name).toBe('@deepseek-ai/dsh-reasoning-effort')
    expect(manifest.name).toMatch(/^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(manifest.version).toBe(await readRepositoryVersion())
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
    expect(manifest.exports['./client']).toEqual({
      types: './lib/types/client/index.d.ts',
      default: './lib/client.js',
    })
    expect(manifest.files).toEqual([
      'lib/index.js',
      'lib/client.js',
      'cordis.patch.yml',
      'THIRD_PARTY_NOTICES.md',
      'lib/assets',
      'lib/types/**/*.d.ts',
    ])
  })

  test('declares a Web client and independently installable bundle patch', async () => {
    const manifest = await readManifest()

    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.client.inject).toEqual([
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-model-selection',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-api-remotes',
    ])
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
  })

  test('publishes the complete rc.5 compatibility contract and owned Host dependencies', async () => {
    const manifest = await readManifest()
    const tsconfig = JSON.parse(await readFile(new URL('tsconfig.json', PACKAGE_ROOT), 'utf8')) as {
      references: readonly { readonly path: string }[]
      exclude: readonly string[]
    }

    expect(manifest.dependencies).toEqual({
      '@deepseek-ai/schemastery': 'workspace:^',
    })
    expect(manifest.peerDependencies).toEqual({
      '@deepseek-ai/cordis': 'workspace:^',
    })
    expect(manifest.devDependencies).toEqual({
      ...Object.fromEntries(WORKSPACE_PEERS.map(dependency => [dependency, 'workspace:^'])),
      '@deepseek-ai/dsh-api-session-controller': 'workspace:^',
      '@deepseek-ai/dsh-session': 'workspace:^',
      '@deepseek-ai/dsh-settings': 'workspace:^',
      '@deepseek-ai/dsh-client-test-runtime': 'workspace:^',
      '@testing-library/react': '^16.1.0',
      '@types/react': '~18.3.1',
      '@types/react-dom': '~18.3.0',
      react: '^18.2.0',
      'react-dom': '^18.2.0',
    })
    expect(tsconfig.exclude).toEqual(['src/client/index.ts'])
    expect(tsconfig.references).toEqual([
      { path: '../../api/remotes/tsconfig.client.json' },
      { path: '../../../vendor/cordis' },
      { path: '../../../vendor/schemastery' },
      { path: '../../host/webserver' },
      { path: '../../settings/settings' },
      { path: '../../client/locale' },
      { path: '../../client/runtime' },
      { path: '../../client/ui-conversation' },
      { path: '../../client/ui-model-selection' },
      { path: '../../client/ui-primitives' },
      { path: '../../client/ui-slots' },
    ])
  })

  test('preserves the pinned upstream license, attribution, and sprite bytes', async () => {
    const [license, notices, sprite] = await Promise.all([
      readFile(new URL('LICENSE', PACKAGE_ROOT), 'utf8'),
      readFile(new URL('THIRD_PARTY_NOTICES.md', PACKAGE_ROOT), 'utf8'),
      readFile(new URL('assets/chibi-runner-strip.png', PACKAGE_ROOT)),
    ])

    expect(createHash('sha256').update(license).digest('hex')).toBe(PINNED_LICENSE_SHA256)
    expect(notices).toContain('https://github.com/HanaAyane/dsh-reasoning-effort')
    expect(notices).toContain('f94622b46078ac8c064f91bdc10ab27e8cf32270')
    expect(notices).toContain('assets/chibi-runner-strip.png')
    expect(createHash('sha256').update(sprite).digest('hex')).toBe(PINNED_SPRITE_SHA256)
  })

  test('provides the Host and Client source entries consumed by clientBundle', async () => {
    const [host, clientEntry, client, bundle] = await Promise.all([
      readFile(new URL('src/index.ts', PACKAGE_ROOT), 'utf8'),
      readFile(new URL('src/client/index.ts', PACKAGE_ROOT), 'utf8'),
      readFile(new URL('src/client/index.tsx', PACKAGE_ROOT), 'utf8'),
      readFile(new URL('tsdown.config.ts', PACKAGE_ROOT), 'utf8'),
    ])

    expect(host).toContain("export const name = 'reasoning-effort'")
    expect(host).toContain("export const inject = ['settings', 'webServer']")
    expect(host).toContain('export function apply(ctx: Context): void')
    expect(clientEntry).toContain("export * from './index.tsx'")
    expect(client).toContain("export const name = 'reasoning-effort-client'")
    expect(client).toContain('export function apply(ctx: ClientContext): void')
    expect(bundle).toContain("loader: { ...config.loader, '.png': 'dataurl' }")
  })

  test('keeps the ordinary circular thumb inside both track endpoints', async () => {
    const css = await readFile(new URL('src/client/EffortControl.module.css', PACKAGE_ROOT), 'utf8')

    expect(css).toMatch(
      /\.knob\s*\{[^}]*left:\s*clamp\(14px,\s*var\(--reasoning-effort-progress\),\s*calc\(100%\s*-\s*14px\)\)/s,
    )
  })

  test('resolves the attributed sprite from source during the parallel Client build', async () => {
    const bundle = await readFile(new URL('tsdown.config.ts', PACKAGE_ROOT), 'utf8')

    expect(bundle).toContain("source === '../../assets/chibi-runner-strip.png'")
    expect(bundle).toContain("new URL('./assets/chibi-runner-strip.png', import.meta.url)")
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
