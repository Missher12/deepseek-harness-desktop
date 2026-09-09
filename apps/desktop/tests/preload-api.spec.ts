import { describe, expect, it } from 'vitest'
import {
  desktopPresentation,
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
      platform: 'darwin', arch: 'x64', packageFormat: 'dmg',
      installAction: 'protected-replace', supportReason: null,
      assetName: null, downloadedBytes: null, downloadTotalBytes: null,
    }
    expect(isDesktopUpdateSnapshot(snapshot)).toBe(true)
    expect(isDesktopUpdateSnapshot({ ...snapshot, phase: 'run-shell' })).toBe(false)
    expect(isDesktopUpdateSnapshot({ ...snapshot, downloadProgress: '100%' })).toBe(false)
  })

  it('offers fixed update operations on all three supported desktop platforms', () => {
    expect(supportsDesktopUpdates('darwin')).toBe(true)
    expect(supportsDesktopUpdates('win32')).toBe(true)
    expect(supportsDesktopUpdates('linux')).toBe(true)
    expect(supportsDesktopUpdates('freebsd')).toBe(false)
  })

  it.each([
    { platform: 'darwin', packageFormat: 'dmg', installAction: 'protected-replace' },
    { platform: 'win32', packageFormat: 'nsis', installAction: 'open-setup-wizard' },
    { platform: 'linux', packageFormat: 'deb', installAction: 'reveal-package' },
    { platform: 'linux', packageFormat: 'appimage', installAction: 'reveal-package' },
  ])('validates native $platform/$packageFormat without paths or fabricated progress', (native) => {
    const snapshot = {
      ...native, arch: 'x64', supportReason: null, phase: 'idle',
      runningDesktop: '0.5.7', includedHarness: '0.1.3-alpha.1',
      latestOfficialHarness: null, latestDesktop: null, lastCheckedAt: null,
      downloadProgress: null, message: null, assetName: null,
      downloadedBytes: null, downloadTotalBytes: null,
    }
    expect(isDesktopUpdateSnapshot(snapshot)).toBe(true)
    for (const change of [
      { localPath: '/private/update' }, { platform: 'win32', packageFormat: 'dmg' },
      { downloadProgress: 1.1 }, { downloadedBytes: -1 },
      { downloadedBytes: 20, downloadTotalBytes: 10 }, { assetName: '../payload' },
      { arch: 'arm64' }, { installAction: 'execute-package' },
      { packageFormat: 'unknown', installAction: null, supportReason: 'unknown-package', phase: 'ready' },
    ]) expect(isDesktopUpdateSnapshot({ ...snapshot, ...change }), JSON.stringify(change)).toBe(false)
    expect(isDesktopUpdateSnapshot({ ...snapshot, phase: 'manual-install-ready' })).toBe(native.platform === 'linux')
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

})
