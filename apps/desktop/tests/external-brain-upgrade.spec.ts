import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const REPO_ROOT = resolve(import.meta.dirname, '../../..')
const DESKTOP_PATCH = join(REPO_ROOT, 'apps/desktop/desktop.cordis.patch.yml')

const legacyExternalBrainRows = yaml.load(`
- insert:
    - id: missher-memory
      name: dsh-missher-memory
    - id: missher-evolution
      name: dsh-missher-evolution
`) as Parameters<typeof composeEntries>[0][number]

function externalBrainRows(entries: ReturnType<typeof composeEntries>) {
  return entries.filter(row => (
    row.id?.includes('missher-memory')
    || row.id?.includes('missher-evolution')
  ))
}

describe('Desktop external-brain upgrade overlay', () => {
  it('disables legacy Profile rows and mounts one Desktop-owned row per provider', () => {
    const desktop = loadOverlayPatches('Desktop external-brain upgrade', DESKTOP_PATCH)
    const rows = externalBrainRows(composeEntries([legacyExternalBrainRows, desktop]))

    expect(rows).toEqual([
      { id: 'missher-memory', name: 'dsh-missher-memory', disabled: true },
      { id: 'missher-evolution', name: 'dsh-missher-evolution', disabled: true },
      {
        id: 'desktop-missher-memory',
        name: '@deepseek-ai/dsh-desktop-managed-memory',
        config: {
          enabled: true,
          captureEnabled: true,
          recallEnabled: true,
          consolidationEnabled: true,
        },
      },
      {
        id: 'desktop-missher-evolution',
        name: '@deepseek-ai/dsh-desktop-managed-evolution',
        config: { enabled: true, maintenanceIntervalHours: 24, maxInjectedRules: 4 },
      },
    ])
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
  })

  it('mounts the same Desktop-owned providers for a fresh Profile', () => {
    const warnings: string[] = []
    const desktop = loadOverlayPatches('Desktop external-brain fresh install', DESKTOP_PATCH)
    const rows = externalBrainRows(composeEntries([desktop], warning => warnings.push(warning)))

    expect(rows.map(row => [row.id, row.name, row.disabled ?? false])).toEqual([
      ['desktop-missher-memory', '@deepseek-ai/dsh-desktop-managed-memory', false],
      ['desktop-missher-evolution', '@deepseek-ai/dsh-desktop-managed-evolution', false],
    ])
    expect(warnings).toEqual([
      'patch: entry "missher-memory" not found',
      'patch: entry "missher-evolution" not found',
    ])
  })

  it('builds dedicated dual-face entries that retain the immutable provider dependencies', () => {
    const desktop = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> }
    const providers = [
      ['memory', '@deepseek-ai/dsh-desktop-managed-memory', 'dsh-missher-memory'],
      ['evolution', '@deepseek-ai/dsh-desktop-managed-evolution', 'dsh-missher-evolution'],
    ] as const

    for (const [directory, managedName, upstreamName] of providers) {
      const root = new URL(`../../desktop-managed-${directory}/`, import.meta.url)
      const bridge = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
        name: string
        exports: Record<string, unknown>
        dsh?: { client?: { platform?: string } }
        dependencies?: unknown
        peerDependencies?: unknown
      }
      const client = readFileSync(new URL('lib/client.js', root), 'utf8')
      expect(desktop.dependencies[managedName]).toBe('workspace:^')
      expect(bridge.name).toBe(managedName)
      expect(bridge.exports).toHaveProperty('./client')
      expect(bridge.dsh?.client?.platform).toBe('web')
      expect(bridge.dependencies).toBeUndefined()
      expect(bridge.peerDependencies).toBeUndefined()
      expect(client).toContain(`id: ${JSON.stringify(managedName)}`)
      expect(client).not.toContain(`id: ${JSON.stringify(upstreamName)}`)
    }
    expect(desktop.dependencies['dsh-missher-memory']).toContain('/v0.2.0/')
    expect(desktop.dependencies['dsh-missher-evolution']).toContain('/v0.1.1/')
  })
})
