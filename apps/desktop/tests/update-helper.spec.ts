import { describe, expect, it } from 'vitest'
import { validateUpdateHelperConfig } from '../src/update/update-helper.ts'

const valid = {
  schema: 1,
  parentPid: 123,
  currentAppPath: '/Applications/DeepSeek Harness.app',
  dmgPath: '/Users/example/Library/Application Support/DeepSeek Harness/updates/download-1/DeepSeek-Harness-0.2.0-mac-x64.dmg',
  expectedDesktopVersion: '0.2.0',
  expectedHarnessVersion: '0.1.0-rc.8',
  expectedSha256: 'a'.repeat(64),
}

describe('Desktop update helper boundary', () => {
  it('accepts the fixed absolute app and DMG contract', () => {
    expect(validateUpdateHelperConfig(valid)).toEqual(valid)
  })

  it.each([
    { currentAppPath: '/Applications/Other.app' },
    { currentAppPath: '/' },
    { dmgPath: '/tmp/../../unsafe.dmg' },
    { dmgPath: '/tmp/update.sh' },
    { expectedSha256: '../bad' },
    { expectedDesktopVersion: 'latest' },
    { parentPid: -1 },
  ])('rejects unsafe helper input %j', (change) => {
    expect(validateUpdateHelperConfig({ ...valid, ...change })).toBeNull()
  })
})
