import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Reject incomplete or wrong-platform installed-application receipts.
 * @param {unknown} report Parsed shared smoke JSON.
 * @param {string} version Expected source manifest version.
 * @returns {true} Only after all required native outcomes are present.
 */
export function validateWindowsSmoke(report, version) {
  assert(report && typeof report === 'object', 'Missing Windows smoke receipt')
  assert.equal(report.version, version, 'Unexpected installed version')
  assert.equal(report.platform, 'win32', 'Smoke did not run on Windows')
  assert.equal(report.arch, 'x64', 'Smoke did not run on x64')
  for (const field of ['packaged', 'uiReady', 'exited', 'ownedProcessesStopped']) {
    assert.equal(report[field], true, `Windows smoke did not confirm ${field}`)
  }
  assert(Array.isArray(report.pageErrors) && report.pageErrors.length === 0, 'Renderer errors or missing error evidence')
  return true
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [receipt, version] = process.argv.slice(2)
  assert(receipt && version, 'Usage: windows-evidence.mjs <smoke.json> <version>')
  validateWindowsSmoke(JSON.parse(await readFile(receipt, 'utf8')), version)
}
