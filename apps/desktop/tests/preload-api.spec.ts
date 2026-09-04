import { describe, expect, it } from 'vitest'
import {
  desktopPresentation,
  isDesktopIntegrationsSnapshot,
  isDesktopCommand,
  isDesktopPresentation,
  isDesktopUpdateSnapshot,
  isDesktopPreferenceMutation,
  isDesktopPreferencesSnapshot,
  isRecoveryAction,
  supportsDesktopUpdates,
} from '../src/preload-api.ts'

describe('desktop preload vocabulary', () => {
  it('exposes one frozen platform presentation fact', () => {
    const mac = desktopPresentation('darwin')
    const windows = desktopPresentation('win32')

    expect(mac).toEqual({ titlebar: 'hidden-inset' })
    expect(windows).toEqual({ titlebar: 'native' })
    expect(Object.isFrozen(mac)).toBe(true)
    expect(Object.isFrozen(windows)).toBe(true)
  })

  it('accepts only the closed Desktop presentation vocabulary', () => {
    expect(isDesktopPresentation({ titlebar: 'hidden-inset' })).toBe(true)
    expect(isDesktopPresentation({ titlebar: 'native' })).toBe(true)
    expect(isDesktopPresentation({ titlebar: 'hidden-inset', command: 'shell' })).toBe(false)
    expect(isDesktopPresentation({ titlebar: 'overlay' })).toBe(false)
    expect(isDesktopPresentation(undefined)).toBe(false)
  })

  it.each(['new-session', 'open-command-menu', 'open-settings'])('accepts command %s', (value) => {
    expect(isDesktopCommand(value)).toBe(true)
  })

  it.each(['retry', 'open-logs', 'quit'])('accepts recovery action %s', (value) => {
    expect(isRecoveryAction(value)).toBe(true)
  })

  it.each(['shell', 'read-file', undefined, 1, {}])('rejects unlisted value %j', (value) => {
    expect(isDesktopCommand(value)).toBe(false)
    expect(isRecoveryAction(value)).toBe(false)
  })

  it('accepts only a complete closed update snapshot', () => {
    const snapshot = {
      phase: 'desktop-available',
      runningDesktop: '0.1.9',
      includedHarness: '0.1.0-rc.5',
      latestOfficialHarness: '0.1.0-rc.8',
      latestDesktop: '0.2.0',
      lastCheckedAt: 1_787_196_400_000,
      downloadProgress: null,
      message: null,
    }
    expect(isDesktopUpdateSnapshot(snapshot)).toBe(true)
    expect(isDesktopUpdateSnapshot({ ...snapshot, phase: 'run-shell' })).toBe(false)
    expect(isDesktopUpdateSnapshot({ ...snapshot, downloadProgress: '100%' })).toBe(false)
  })

  it('offers the verified DMG updater only on macOS', () => {
    expect(supportsDesktopUpdates('darwin')).toBe(true)
    expect(supportsDesktopUpdates('win32')).toBe(false)
    expect(supportsDesktopUpdates('linux')).toBe(false)
  })

  it('accepts only the closed Desktop preference vocabulary', () => {
    expect(isDesktopPreferencesSnapshot({
      closeBehavior: 'keep-running', tieredPricingEstimates: false,
    })).toBe(true)
    expect(isDesktopPreferencesSnapshot({ closeBehavior: 'hide', tieredPricingEstimates: true })).toBe(false)
    expect(isDesktopPreferenceMutation({ key: 'closeBehavior', value: 'quit' })).toBe(true)
    expect(isDesktopPreferenceMutation({ key: 'tieredPricingEstimates', value: false })).toBe(true)
    expect(isDesktopPreferenceMutation({ key: 'closeBehavior', value: false })).toBe(false)
    expect(isDesktopPreferenceMutation({ key: 'shell', value: 'quit' })).toBe(false)
  })

  it('accepts only the path-free Desktop integration snapshot', () => {
    expect(isDesktopIntegrationsSnapshot({
      openDesign: { state: 'installed', profile: 'open-design' },
    })).toBe(true)
    expect(isDesktopIntegrationsSnapshot({
      openDesign: { state: 'missing', profile: 'open-design' },
    })).toBe(true)
    expect(isDesktopIntegrationsSnapshot({
      openDesign: { state: 'installed', profile: '/Users/example/.dsh/profiles/open-design' },
    })).toBe(false)
    expect(isDesktopIntegrationsSnapshot({
      openDesign: { state: 'installed', profile: 'open-design', command: 'shell' },
    })).toBe(false)
  })
})
