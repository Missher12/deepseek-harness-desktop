import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const readManifest = (path: string): { version?: unknown } =>
  JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
const readUpdateMetadata = (): { desktopVersion?: unknown; harnessVersion?: unknown } =>
  JSON.parse(readFileSync('apps/desktop/update-metadata.json', 'utf8')) as {
    desktopVersion?: unknown
    harnessVersion?: unknown
  }

describe('official core Desktop migration', () => {
  it('aligns the official rc.1 core and Desktop-owned first-party packages before the Desktop version bump', () => {
    expect(readManifest('package.json').version).toBe('0.1.2-rc.1')
    for (const manifest of [
      'packages/brain/missher-brain/package.json',
      'packages/client/runtime/package.json',
      'packages/client/ui-settings-brain/package.json',
      'packages/client/ui-settings-personalization/package.json',
      'packages/client/ui-settings-system-update/package.json',
      'packages/client/ui-settings-usage/package.json',
      'packages/extensions/desktop-workbench/package.json',
      'packages/extensions/reasoning-effort/package.json',
      'packages/extensions/session-messenger/package.json',
      'packages/host/desktop-plugin-runtime/package.json',
      'packages/session/usage-insights/package.json',
    ]) {
      expect(readManifest(manifest).version, manifest).toBe('0.1.2-rc.1')
    }
    for (const manifest of [
      'apps/desktop/package.json',
      'apps/desktop-managed-memory/package.json',
      'apps/desktop-managed-evolution/package.json',
    ]) {
      expect(readManifest(manifest).version, manifest).toBe('0.5.3')
    }
    expect(readUpdateMetadata()).toMatchObject({
      desktopVersion: '0.5.3',
      harnessVersion: '0.1.2-rc.1',
    })
  })

  it('retains one canonical row for each Desktop-only product feature', () => {
    const patches = yaml.load(
      readFileSync('apps/desktop/desktop.cordis.patch.yml', 'utf8'),
    ) as Array<{ insert?: Array<{ id?: string }> }>
    const ids = patches.flatMap(patch => patch.insert ?? []).map(row => row.id)

    expect(ids.filter(id => id === 'reasoning-effort')).toHaveLength(1)
    expect(ids.filter(id => id === 'session-messenger')).toHaveLength(1)
    expect(ids.filter(id => id === 'dsh-market')).toHaveLength(1)
  })
})
