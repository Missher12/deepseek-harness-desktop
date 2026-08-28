import { describe, expect, it } from 'vitest'
import {
  isDesktopCommand,
  isDesktopUpdateSnapshot,
  isDesktopPreferenceMutation,
  isDesktopPreferencesSnapshot,
  isBrowserTakeoverStatus,
  isDesktopControlUiMutation,
  isDesktopControlUiSnapshot,
  isRecoveryAction,
  supportsDesktopUpdates,
} from '../src/preload-api.ts'

describe('desktop preload vocabulary', () => {
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

  it('accepts only the exact browser takeover status vocabulary', () => {
    expect(isBrowserTakeoverStatus({ phase: 'human', signedInWarning: true })).toBe(true)
    expect(isBrowserTakeoverStatus({ phase: 'stopping', signedInWarning: true })).toBe(true)
    expect(isBrowserTakeoverStatus({ phase: 'agent', signedInWarning: false })).toBe(false)
    expect(isBrowserTakeoverStatus({ phase: 'given', signedInWarning: true, sessionId: 'renderer' })).toBe(false)
    expect(isBrowserTakeoverStatus(Object.create({ phase: 'human', signedInWarning: true }))).toBe(false)
  })

  it('accepts only the path-free Desktop control UI snapshot', () => {
    const snapshot = {
      supported: true,
      computerEnabled: true,
      permissions: { screenViewing: 'granted', assistiveControl: 'denied' },
      ordinaryApps: [{ appId: 'com.example.notes', name: 'Notes', allowed: true }],
      emergencyAccelerator: 'CommandOrControl+Shift+F12',
      active: { agentName: 'Agent', appName: 'Notes', action: 'Typing' },
      stopping: false,
    }
    expect(isDesktopControlUiSnapshot(snapshot)).toBe(true)
    expect(isDesktopControlUiSnapshot({ ...snapshot, sessionId: 'renderer' })).toBe(false)
    expect(isDesktopControlUiSnapshot({ ...snapshot, permissions: { screenViewing: 'yes', assistiveControl: 'denied' } })).toBe(false)
    expect(isDesktopControlUiSnapshot({ ...snapshot, active: { ...snapshot.active, leaseId: 'secret' } })).toBe(false)
    expect(isDesktopControlUiSnapshot(Object.create(snapshot))).toBe(false)
  })

  it('accepts only non-authority Desktop control setting intents', () => {
    expect(isDesktopControlUiMutation({ kind: 'set-computer-enabled', enabled: true })).toBe(true)
    expect(isDesktopControlUiMutation({ kind: 'set-app-allowed', appId: 'com.example.notes', allowed: false })).toBe(true)
    expect(isDesktopControlUiMutation({ kind: 'set-emergency-accelerator', accelerator: 'CommandOrControl+Shift+F11' })).toBe(true)
    expect(isDesktopControlUiMutation({ kind: 'set-app-allowed', appId: 'com.example.notes', allowed: true, sessionId: 'renderer' })).toBe(false)
    expect(isDesktopControlUiMutation({ kind: 'set-computer-enabled', enabled: 1 })).toBe(false)
    expect(isDesktopControlUiMutation({ kind: 'set-app-allowed', appId: '../secret', allowed: true })).toBe(false)
  })
})
