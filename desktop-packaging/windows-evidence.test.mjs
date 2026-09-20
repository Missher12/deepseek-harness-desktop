import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateWindowsSmoke } from './windows-evidence.mjs'

const version = '0.1.6-alpha.2'
const passing = {
  version, platform: 'win32', arch: 'x64', packaged: true, uiReady: true,
  exited: true, ownedProcessesStopped: true, pageErrors: [],
}

test('accepts an installed Windows x64 smoke with a normal complete exit', () => {
  assert.equal(validateWindowsSmoke(passing, version), true)
})

for (const [name, value] of [
  ['version', '0.1.5-rc.2'], ['platform', 'darwin'], ['arch', 'arm64'],
  ['packaged', false], ['uiReady', false], ['exited', false],
  ['ownedProcessesStopped', false], ['pageErrors', ['renderer failure']],
  ['pageErrors', undefined], ['uiReady', 'true'],
]) {
  test(`rejects invalid ${name}: ${JSON.stringify(value)}`, () => {
    assert.throws(() => validateWindowsSmoke({ ...passing, [name]: value }, version))
  })
}

test('rejects an absent receipt', () => {
  assert.throws(() => validateWindowsSmoke(null, version))
})
