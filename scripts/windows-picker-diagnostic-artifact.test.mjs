import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { win32 } from 'node:path'
import { runInNewContext } from 'node:vm'

const api = await import('./windows-picker-diagnostic-artifact.mjs').catch(() => ({}))

test('artifact verifier is available before any installer execution', () => {
  assert.equal(typeof api.verifyMetadata, 'function')
})

test('accepts only the pinned run, source, archive and unexpired artifact', () => {
  assert.equal(typeof api.verifyMetadata, 'function')
  const good = {
    id: 10291416609,
    name: 'DeepSeek-Harness-Setup-win-x64-0.5.8-5a17c6b29971b6034929bb8a13e3b11cdc4748e8',
    size_in_bytes: 142093135,
    digest: 'sha256:2974ed04459acaed7dd4b9251efa734d38fc20a6805a4022464f8f4dd2ce2c21',
    expired: false,
    workflow_run: { id: 34672172120, head_sha: '5a17c6b29971b6034929bb8a13e3b11cdc4748e8' },
  }
  assert.doesNotThrow(() => api.verifyMetadata(good))
  for (const changed of [
    { id: 1 }, { name: '../setup.exe' }, { expired: true }, { size_in_bytes: 1 },
    { digest: 'sha256:' + '0'.repeat(64) }, { workflow_run: { id: 1, head_sha: good.workflow_run.head_sha } },
    { workflow_run: { id: good.workflow_run.id, head_sha: '0'.repeat(40) } },
  ]) assert.throws(() => api.verifyMetadata({ ...good, ...changed }))
})

test('checksum cannot redirect to another executable or accept CRLF/multiple entries', () => {
  assert.equal(typeof api.parseChecksum, 'function')
  const hash = 'a'.repeat(64)
  const name = 'DeepSeek-Harness-Setup-0.5.8-win-x64.exe'
  assert.equal(api.parseChecksum(`${hash}  ${name}\n`), hash)
  for (const text of [`${hash}  ../${name}\n`, `${hash}  ${name}\r\n`, `${hash}  ${name}\nextra`, `${hash}  wrong.exe\n`]) {
    assert.throws(() => api.parseChecksum(text))
  }
})

test('diagnostic driver refuses source drift and retains the exact prefix and teardown', async () => {
  const driver = await import('./windows-picker-diagnostic-driver.mjs').catch(() => ({}))
  assert.equal(typeof driver.createDriver, 'function')
  const source = readFileSync(process.env.DSH_PICKER_SOURCE ?? 'apps/desktop/tests/packaged-smoke.ts', 'utf8')
  assert.throws(() => driver.createDriver(source + '\n'))
  const output = driver.createDriver(source)
  const prefix = source.slice(source.indexOf('  const temporaryRoot =', source.indexOf('export async function runPackagedDesktopSmoke')), source.indexOf('    try {\n      await exerciseWindowsClipboard'))
  assert.ok(output.includes(prefix))
  const teardown = source.slice(source.indexOf('    const mainPid = nativeApp.process().pid'), source.indexOf('/** Verify that layout state'))
  assert.ok(output.includes(teardown))
  const runBody = output.slice(output.indexOf('export async function runPackagedDesktopSmoke'), output.indexOf('/** Verify that layout state'))
  assert.ok(runBody.includes('await exerciseWindowsClipboard('))
  assert.ok(!runBody.includes('await exerciseNativeSessionWorkspaces('))
  assert.ok(!runBody.includes('await exerciseReaderPresentation('))
})

test('observer receives the evaluated Electron main PID, not the retained shell launcher', async () => {
  const { createDriver } = await import('./windows-picker-diagnostic-driver.mjs')
  const source = readFileSync(process.env.DSH_PICKER_SOURCE ?? 'apps/desktop/tests/packaged-smoke.ts', 'utf8')
  const output = createDriver(source)
  const start = output.indexOf('async function exerciseWindowsDirectoryPicker(')
  const body = output.slice(start, output.indexOf('async function dismissCredentialOnboarding(', start))
  const executable = 'C:\\isolated\\DeepSeek Harness.exe'
  const harnessHome = 'C:\\isolated\\dsh-home'
  const userData = 'C:\\isolated\\electron-data'
  const stopAfterSpawn = new Error('stop before native observation')
  const commands = []
  const execute = runInNewContext(stripTypeScriptTypes(body) + '\nexerciseWindowsDirectoryPicker', {
    process: { pid: 99, env: { DSH_PICKER_CONTROL: 'C:\\control', DSH_PICKER_EVIDENCE: 'C:\\evidence', DSH_WINDOWS_DESKTOP_EXECUTABLE: executable } },
    repositoryRoot: 'C:\\repository', join: win32.join, resolve: win32.resolve,
    mkdir: async () => undefined,
    execFileAsync: async (file, args) => { commands.push({ file, args: Array.from(args) }) },
    waitDiagnosticMarker: async () => { throw stopAfterSpawn },
  })
  let remote = { pid: 202, execPath: executable, harnessHome, userData }
  const application = {
    process: () => ({ pid: 101 }),
    // Playwright serializes this callback into the Electron main process.
    evaluate: async callback => runInNewContext(`(${callback.toString()})(electron)`, {
      process: { pid: remote.pid, execPath: remote.execPath, env: { DSH_HOME: remote.harnessHome } },
      electron: { app: { getPath: () => remote.userData } },
    }),
  }
  await assert.rejects(execute({}, harnessHome, userData, application), error => error === stopAfterSpawn)
  assert.equal(commands.length, 1)
  assert.equal(commands[0].file, 'powershell.exe')
  const pidArgument = commands[0].args.indexOf('-MainProcessId')
  assert.equal(commands[0].args[pidArgument + 1], '202')
  for (const changed of [{ pid: 0 }, { execPath: 'C:\\foreign.exe' }, { userData: 'C:\\other-data' }, { harnessHome: 'C:\\other-home' }]) {
    remote = { pid: 202, execPath: executable, harnessHome, userData, ...changed }
    await assert.rejects(execute({}, harnessHome, userData, application), error => error.message === 'Installed diagnostic main identity mismatch.')
    assert.equal(commands.length, 1, 'A foreign identity must not start the observer')
  }
})
