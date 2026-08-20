import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  parseOfficialHarnessTag,
  selectUpdateAvailability,
  validateDesktopUpdateManifest,
} from '../src/update/release.ts'
import type { DesktopUpdateManifest } from '../src/update/release.ts'

const validManifest: DesktopUpdateManifest = {
  schema: 1,
  desktopVersion: '0.2.0',
  harnessVersion: '0.1.0-rc.8',
  platform: 'darwin',
  arch: 'x64',
  assetName: 'DeepSeek-Harness-0.2.0-mac-x64.dmg',
  bytes: 123_456_789,
  sha256: 'a'.repeat(64),
  releaseUrl: 'https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v0.2.0',
}

describe('Desktop update release validation', () => {
  it('parses only official dsh semantic-version tags', () => {
    expect(parseOfficialHarnessTag('dsh-v0.1.0-rc.8')).toBe('0.1.0-rc.8')
    expect(parseOfficialHarnessTag('v0.1.0')).toBeNull()
    expect(parseOfficialHarnessTag('dsh-vlatest')).toBeNull()
  })

  it('orders stable and prerelease versions without accepting malformed values', () => {
    expect(compareVersions('0.1.0-rc.8', '0.1.0-rc.5')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.0-rc.8')).toBeGreaterThan(0)
    expect(compareVersions('0.1', '0.1.0')).toBeNull()
  })

  it('accepts only the fixed Intel macOS manifest contract', () => {
    expect(validateDesktopUpdateManifest(validManifest)).toEqual(validManifest)
    expect(validateDesktopUpdateManifest({ ...validManifest, arch: 'arm64' })).toBeNull()
    expect(validateDesktopUpdateManifest({ ...validManifest, bytes: 0 })).toBeNull()
    expect(validateDesktopUpdateManifest({ ...validManifest, sha256: '../bad' })).toBeNull()
    expect(validateDesktopUpdateManifest({ ...validManifest, releaseUrl: 'https://evil.example/release' })).toBeNull()
  })

  it('distinguishes upstream-only availability from an installable Desktop release', () => {
    expect(selectUpdateAvailability({
      runningDesktop: '0.1.9',
      includedHarness: '0.1.0-rc.5',
      latestOfficialHarness: '0.1.0-rc.8',
      desktopManifest: null,
    })).toBe('upstream-available')

    expect(selectUpdateAvailability({
      runningDesktop: '0.1.9',
      includedHarness: '0.1.0-rc.5',
      latestOfficialHarness: '0.1.0-rc.8',
      desktopManifest: validManifest,
    })).toBe('desktop-available')

    expect(selectUpdateAvailability({
      runningDesktop: '0.2.0',
      includedHarness: '0.1.0-rc.8',
      latestOfficialHarness: '0.1.0-rc.8',
      desktopManifest: validManifest,
    })).toBe('current')
  })
})
