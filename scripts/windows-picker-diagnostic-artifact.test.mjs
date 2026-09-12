import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { win32 } from 'node:path'
import { runInNewContext } from 'node:vm'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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
  assert.ok(runBody.includes('await exerciseNativeSessionWorkspaces('))
  assert.ok(runBody.includes('await exerciseReaderPresentation('))
})

test('native picker receipts exclude raw failure messages and reject false success or arbitrary fields', async () => {
  const parser = await import('./windows-picker-diagnostic-driver.mjs')
  assert.equal(typeof parser.pickerReceipt, 'function')
  const facts = { phase: 'complete', ownerMatches: true, foregroundMatches: true,
    dialogKeyboardFocusable: false, dialogEnabled: true, dialogWindowPattern: true,
    addressKeyboardFocusable: true, addressValuePattern: true, addressReadOnly: false,
    pathWritten: true, anchorCount: 0, selectedHwnd: 66190, resolution: [], resolutionLast: null, address: null, acceptInvoked: true }
  assert.equal(parser.pickerReceipt('DSH_PICKER ' + JSON.stringify(facts)).status, 'success')
  assert.throws(() => parser.pickerReceipt('DSH_PICKER ' + JSON.stringify({ ...facts, pathWritten: false })))
  assert.throws(() => parser.pickerReceipt('DSH_PICKER ' + JSON.stringify({ ...facts, absolutePath: 'C:\\private' })))
  const failed = parser.pickerReceipt('DSH_PICKER_FAILED ' + JSON.stringify({ facts: { ...facts, phase: 'find', pathWritten: false }, name: 'RuntimeException', message: 'private path or token' }))
  assert.equal(failed.status, 'failure')
  assert.equal(failed.firstErrorType, 'RuntimeException')
  assert.ok(!JSON.stringify(failed).includes('private path or token'))
  assert.equal(parser.pickerReceipt('DSH_PICKER_FAILED ' + JSON.stringify({
    facts: { ...facts, phase: 'find', pathWritten: false, resolutionLast: { state: { candidates: [{ error: 'Win32Exception' }] } } },
    name: 'Win32Exception', message: 'private',
  })).firstErrorType, 'Win32Exception')
  assert.throws(() => parser.pickerReceipt('DSH_PICKER {}\nDSH_PICKER {}'))
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

test('accepts a bounded diagnostic-only modal summary but refuses values, excess items and unredacted strings', async () => {
  const { pickerReceipt } = await import('./windows-picker-diagnostic-driver.mjs')
  const facts = { phase: 'diagnostic-modal', ownerMatches: true, foregroundMatches: true,
    dialogKeyboardFocusable: true, dialogEnabled: true, dialogWindowPattern: true,
    addressKeyboardFocusable: null, addressValuePattern: null, addressReadOnly: null,
    pathWritten: false, anchorCount: 1, selectedHwnd: 66194, resolution: [], resolutionLast: null, address: null, acceptInvoked: false,
    diagnosticOnly: true, failureCode: 'DIAGNOSTIC_MODAL_CAPTURE',
    modalSummary: { caption: 'Location is unavailable', truncated: false, error: null,
      items: [{ kind: 'Text', name: '[owned-root]\\Desktop is unavailable.', automationId: '65535', invokePattern: false, textPattern: true, error: null }] } }
  const outcome = change => pickerReceipt('DSH_PICKER_FAILED ' + JSON.stringify({ name: 'RuntimeException', facts: { ...facts, ...change }, message: 'omitted' }))
  assert.equal(outcome({}).facts.failureCode, 'DIAGNOSTIC_MODAL_CAPTURE')
  assert.doesNotThrow(() => outcome({ modalSummary: { ...facts.modalSummary, caption: 'token=[redacted-token]' } }))
  const item = facts.modalSummary.items[0]
  for (const changed of [
    { diagnosticOnly: false }, { failureCode: 'ignored' }, { pathWritten: true }, { acceptInvoked: true },
    { modalSummary: { ...facts.modalSummary, caption: 'C:\\Users\\private\\Desktop' } },
    { modalSummary: { ...facts.modalSummary, caption: 'a '.repeat(257) } },
    { modalSummary: { ...facts.modalSummary, caption: 'password=visible' } },
    { modalSummary: { ...facts.modalSummary, items: Array.from({ length: 17 }, () => item) } },
    { modalSummary: { ...facts.modalSummary, items: [{ ...item, kind: 'Edit' }] } },
    { modalSummary: { ...facts.modalSummary, items: [{ ...item, value: 'not allowed' }] } },
  ]) assert.throws(() => outcome(changed))
})

test('native text sanitizer masks fixture/runner paths and secrets and caps strings', { skip: process.platform !== 'win32' }, () => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference='Stop';$tokens=$null;$errors=$null
    $ast=[System.Management.Automation.Language.Parser]::ParseFile($env:DSH_MESSAGE_SOURCE,[ref]$tokens,[ref]$errors)
    if($errors.Count){throw 'Selector parse error'}
    $function=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Protect-PickerDiagnosticText'},$true)
    . ([scriptblock]::Create($function.Extent.Text))
    @(
      (Protect-PickerDiagnosticText 'C:\\owned\\Desktop is unavailable.')
      (Protect-PickerDiagnosticText 'D:\\runner-temp\\cache is missing.')
      (Protect-PickerDiagnosticText 'C:\\unknown\\private')
      (Protect-PickerDiagnosticText ('sk-' + ('x' * 40)))
      (Protect-PickerDiagnosticText ('a ' * 600)).Length
    ) | ConvertTo-Json -Compress
  `], { env: { ...process.env, DSH_MESSAGE_SOURCE: fileURLToPath(new URL('./windows-directory-picker-ui-smoke.ps1', import.meta.url)), DSH_DESKTOP_SMOKE_ROOT: 'C:\\owned', RUNNER_TEMP: 'D:\\runner-temp' }, encoding: 'utf8', timeout: 15_000 })
  assert.equal(r.status, 0)
  assert.deepEqual(JSON.parse(r.stdout), ['[owned-root]\\Desktop is unavailable.', '[runner-temp]\\cache is missing.', '[path]', '[redacted-token]', 512])
})
