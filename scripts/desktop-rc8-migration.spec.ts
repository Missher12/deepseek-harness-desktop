import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const readManifest = (path: string): { version?: unknown } =>
  JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
const readUpdateMetadata = (): { desktopVersion?: unknown } =>
  JSON.parse(readFileSync('apps/desktop/update-metadata.json', 'utf8')) as { desktopVersion?: unknown }

describe('rc.8 Desktop migration', () => {
  it('keeps the official rc.8 root and advances the macOS workbench release to Desktop 0.3.2', () => {
    expect(readManifest('package.json').version).toBe('0.1.0-rc.8')
    expect(readManifest('apps/desktop/package.json').version).toBe('0.3.2')
    expect(readUpdateMetadata().desktopVersion).toBe('0.3.2')
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
