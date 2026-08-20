import { describe, expect, it } from 'vitest'
import { isDesktopCommand, isDesktopUpdateSnapshot, isRecoveryAction } from '../src/preload-api.ts'

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
})
