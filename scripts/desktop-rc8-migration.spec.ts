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

const EXPECTED_HARNESS_VERSION = '0.1.5-rc.2'
const EXPECTED_DESKTOP_VERSION = '0.5.10'

describe('official core Desktop migration', () => {
  it('aligns the official rc.2 core and the Desktop 0.5.10 release manifests', () => {
    expect(readManifest('package.json').version).toBe(EXPECTED_HARNESS_VERSION)
    for (const manifest of [
      'packages/client/runtime/package.json',
      'packages/client/ui-settings-personalization/package.json',
      'packages/client/ui-settings-system-update/package.json',
      'packages/client/ui-settings-usage/package.json',
      'packages/extensions/reasoning-effort/package.json',
      'packages/extensions/session-messenger/package.json',
      'packages/host/desktop-plugin-runtime/package.json',
      'packages/session/usage-insights/package.json',
    ]) {
      expect(readManifest(manifest).version, manifest).toBe(EXPECTED_HARNESS_VERSION)
    }
    for (const manifest of [
      'apps/desktop/package.json',
    ]) {
      expect(readManifest(manifest).version, manifest).toBe(EXPECTED_DESKTOP_VERSION)
    }
    expect(readUpdateMetadata()).toMatchObject({
      desktopVersion: EXPECTED_DESKTOP_VERSION,
      harnessVersion: EXPECTED_HARNESS_VERSION,
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
