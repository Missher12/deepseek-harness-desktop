import { describe, expect, it } from 'vitest'
import { isDesktopCompatibilitySnapshot, isDesktopPluginMutation } from '../src/compatibility/contracts.ts'

describe('native plugin management messages', () => {
  it('admits only identity, explicit choice and current revision', () => {
    const mutation = { name: 'example-plugin', revision: 3, action: 'restore' }
    expect(isDesktopPluginMutation(mutation)).toBe(true)
    for (const change of [{ name: '../other' }, { revision: -1 }, { action: 'run' }, { validator: 'shell' }, { path: '/private' }]) {
      expect(isDesktopPluginMutation({ ...mutation, ...change })).toBe(false)
    }
  })
  it('rejects configuration and package paths in the recovery projection', () => {
    const snapshot = { schemaVersion: 1, revision: 3, canonicalProfile: 'web', effectiveProfile: 'desktop-base',
      restartRequired: true, originalPatchReload: 'live', recoveryCode: null,
      entries: [{ name: 'example-plugin', version: '1.0.0', enabled: false, health: 'paused', reason: 'invalid-yaml', requiredBundles: [] }] }
    expect(isDesktopCompatibilitySnapshot(snapshot)).toBe(true)
    expect(isDesktopCompatibilitySnapshot({ ...snapshot, source: '/private' })).toBe(false)
    expect(isDesktopCompatibilitySnapshot({ ...snapshot, entries: [{ ...snapshot.entries[0], source: '/private' }] })).toBe(false)
    expect(isDesktopCompatibilitySnapshot({ ...snapshot, recoveryCode: 'raw secret error\nvalue' })).toBe(false)
  })
})
