import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sourceHash = 'a5ef803903cbb3d79e6c0276d24962cd16f5d1fe030ded2aff5e983cde6040ae'

/** Keep only the bounded, path-free facts emitted by the owned native selector. */
export function pickerReceipt(stdout) {
  assert.equal(typeof stdout, 'string')
  assert.ok(stdout.length <= 100_000)
  const lines = stdout.split(/\r?\n/).filter(line => /^DSH_PICKER(?:_FAILED)? /.test(line))
  assert.equal(lines.length, 1, 'Expected exactly one native picker outcome')
  const failed = lines[0].startsWith('DSH_PICKER_FAILED ')
  const value = JSON.parse(lines[0].slice(failed ? 18 : 11))
  const facts = failed ? value.facts : value
  const fields = ['phase', 'ownerMatches', 'foregroundMatches', 'dialogKeyboardFocusable', 'dialogEnabled',
    'dialogWindowPattern', 'addressKeyboardFocusable', 'addressValuePattern', 'addressReadOnly', 'pathWritten',
    'anchorCount', 'selectedHwnd', 'resolution', 'resolutionLast', 'address', 'acceptInvoked']
  const modalCapture = 'diagnosticOnly' in facts
  if (modalCapture) {
    fields.push('diagnosticOnly', 'failureCode', 'modalSummary')
    assert.equal(failed, true)
    assert.equal(facts.diagnosticOnly, true)
    assert.equal(facts.failureCode, 'DIAGNOSTIC_MODAL_CAPTURE')
    assert.equal(facts.phase, 'diagnostic-modal')
    assert.equal(facts.pathWritten, false)
    assert.equal(facts.acceptInvoked, false)
    const exactKeys = (object, expected) => assert.deepEqual(Object.keys(object).sort(), [...expected].sort())
    const safeText = (text, limit) => {
      if (text === null) return
      assert.equal(typeof text, 'string')
      assert.ok(text.length <= limit && !/[\x00-\x1f\x7f]/.test(text))
      assert.ok(!/\b[a-z]:[\\/]|\\\\/i.test(text), 'Unredacted native path')
      assert.ok(!/\b[A-Za-z0-9_-]{32,}\b/.test(text), 'Unredacted opaque token')
      assert.ok(!/\b(?:api[_ -]?key|token|password|secret)\s*[:=]\s*(?!\[redacted-token\])\S+/i.test(text), 'Unredacted credential label')
    }
    const errorType = error => assert.ok(error === null || /^(?:[A-Za-z][A-Za-z0-9]{0,70})?Exception$/.test(error))
    const summary = facts.modalSummary
    exactKeys(summary, ['caption', 'items', 'truncated', 'error'])
    safeText(summary.caption, 512)
    assert.equal(typeof summary.truncated, 'boolean')
    errorType(summary.error)
    assert.ok(Array.isArray(summary.items) && summary.items.length <= 16)
    for (const item of summary.items) {
      exactKeys(item, ['kind', 'name', 'automationId', 'invokePattern', 'textPattern', 'error'])
      assert.ok(item.kind === 'Text' || item.kind === 'Button')
      safeText(item.name, 512)
      safeText(item.automationId, 96)
      for (const key of ['invokePattern', 'textPattern']) assert.ok(item[key] === null || typeof item[key] === 'boolean')
      errorType(item.error)
    }
  }
  assert.deepEqual(Object.keys(facts).sort(), [...fields].sort())
  const keys = new Set([...fields, 'elapsedMs', 'state', 'anchorHwnd', 'workerPid', 'candidates', 'hwnd',
    'nativePid', 'ownerPid', 'ownerAlive', 'related', 'relationship', 'self', 'child', 'ancestor', 'ownedPopup',
    'root', 'owners', 'pid', 'foreground', 'popup', 'isWindow', 'nativeEnabled', 'nativeVisible', 'uiaHwnd',
    'enabled', 'offscreen', 'windowPattern', 'interactionState', 'modal', 'bounds', 'error', 'x', 'y', 'width', 'height',
    'rootHwnd', 'inside', 'focused', 'edit'])
  const labels = new Set(['find', 'foreground', 'address', 'readback', 'accept', 'close', 'complete',
    'diagnostic-modal', 'DIAGNOSTIC_MODAL_CAPTURE',
    'Running', 'Closing', 'ReadyForUserInteraction', 'BlockedByModalWindow', 'NotResponding'])
  const walk = (item, key = '', depth = 0) => {
    assert.ok(depth <= 10)
    if (item === null || typeof item === 'boolean') return
    if (typeof item === 'number') { assert.ok(Number.isFinite(item) && Math.abs(item) <= Number.MAX_SAFE_INTEGER); return }
    if (typeof item === 'string') {
      assert.ok(labels.has(item) || (key === 'error' && /^(?:[A-Za-z][A-Za-z0-9]{0,70})?Exception$/.test(item)))
      return
    }
    if (Array.isArray(item)) {
      assert.ok(item.length <= (key === 'candidates' ? 3 : 16))
      item.forEach(child => walk(child, key, depth + 1))
      return
    }
    assert.equal(typeof item, 'object')
    for (const [childKey, child] of Object.entries(item)) {
      assert.ok(keys.has(childKey), 'Unexpected native picker evidence field')
      walk(child, childKey, depth + 1)
    }
  }
  walk(modalCapture ? { ...facts, modalSummary: null } : facts)
  if (!failed) {
    assert.equal(facts.phase, 'complete')
    for (const key of ['pathWritten', 'acceptInvoked', 'ownerMatches', 'foregroundMatches', 'dialogEnabled']) assert.equal(facts[key], true)
  } else assert.match(value.name, /^(?:[A-Za-z][A-Za-z0-9]{0,70})?Exception$/)
  return { status: failed ? 'failure' : 'success', firstErrorType: failed ? value.name : null, facts }
}

const observer = String.raw`
let diagnosticPhase = 'startup-prefix'
let diagnosticObserver: Promise<boolean> | undefined
let diagnosticReceiptError: string | null = null

async function savePickerReceipt(stdout: string, evidence: string): Promise<void> {
  const receipt = pickerReceipt(stdout)
  await writeFile(join(evidence, 'picker.json'), JSON.stringify({
    schemaVersion: 1, productSourceSha: '5a17c6b29971b6034929bb8a13e3b11cdc4748e8',
    diagnosticSourceSha: process.env.DSH_PICKER_DIAGNOSTIC_SHA, ...receipt,
  }) + '\n')
}

async function waitDiagnosticMarker(root: string, name: string, timeout: number): Promise<void> {
  await expect.poll(async () => {
    try { return await readFile(join(root, name), 'utf8') }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
      throw error
    }
  }, { timeout }).toBe(name === 'observe.ready' ? 'ready' : 'done')
}

async function exerciseWindowsDirectoryPicker(
  page: Page, harnessHome: string, userData: string, application: ElectronApplication,
): Promise<void> {
  const control = process.env.DSH_PICKER_CONTROL
  const evidence = process.env.DSH_PICKER_EVIDENCE
  const executable = process.env.DSH_WINDOWS_DESKTOP_EXECUTABLE
  if (!control || !evidence || !executable) throw new Error('Missing isolated diagnostic inputs.')
  const identity = await application.evaluate(({ app }) => ({
    pid: process.pid, executable: process.execPath,
    userData: app.getPath('userData'), harnessHome: process.env.DSH_HOME,
  }))
  if (!Number.isSafeInteger(identity.pid) || identity.pid <= 0
    || resolve(identity.executable).toLowerCase() !== resolve(executable).toLowerCase()
    || resolve(identity.userData).toLowerCase() !== resolve(userData).toLowerCase()
    || identity.harnessHome !== harnessHome) {
    throw new Error('Installed diagnostic main identity mismatch.')
  }
  const mainPid = identity.pid
  const selectedDirectory = join(harnessHome, 'native-picker-selected')
  await mkdir(selectedDirectory, { recursive: true })
  diagnosticPhase = 'observer-start'
  diagnosticObserver = execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(repositoryRoot, 'scripts/windows-picker-diagnostic.ps1'),
    '-MainProcessId', String(mainPid), '-Executable', executable,
    '-ControlRoot', control, '-EvidenceRoot', evidence,
    '-MonitorUntilExit',
  ], { timeout: 335_000, maxBuffer: 16_384 }).then(() => true, () => false)
  await waitDiagnosticMarker(control, 'observe.ready', 20_000)
  const addWorkspace = page.getByRole('button', { name: /^(?:Add workspace|添加工作区)$/u })
  await addWorkspace.waitFor({ state: 'visible', timeout: 15_000 })
  diagnosticPhase = 'observe-picker'
  await writeFile(join(control, 'observe.go'), 'go', { flag: 'wx' })
  const automation = execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(repositoryRoot, 'scripts/windows-directory-picker-ui-smoke.ps1'),
    '-FolderPath', selectedDirectory,
  ], { timeout: 90_000 }).then(async result => {
    await savePickerReceipt(result.stdout, evidence)
    return result
  }, async (error: unknown) => {
    try {
      const stdout = error !== null && typeof error === 'object' && 'stdout' in error && typeof error.stdout === 'string'
        ? error.stdout : ''
      await savePickerReceipt(stdout, evidence)
    } catch (receiptError) { diagnosticReceiptError = receiptError instanceof Error ? receiptError.name : 'UnknownError' }
    await writeFile(join(control, 'observe.stop'), 'stop')
    throw error
  })
  await addWorkspace.click()
  await automation
  diagnosticPhase = 'picker-ui-validation'
  // RESTORE_PICKER_UI
}
`

/** Make a throwaway driver from one audited source file; never rewrite the source or rebuild the app. */
export function createDriver(source) {
  assert.equal(createHash('sha256').update(source).digest('hex'), sourceHash, 'Diagnostic fixture source drift')
  const pickerStart = source.indexOf('async function exerciseWindowsDirectoryPicker(')
  const pickerEnd = source.indexOf('async function dismissCredentialOnboarding(', pickerStart)
  assert.ok(pickerStart > 0 && pickerEnd > pickerStart)
  const originalPicker = source.slice(pickerStart, pickerEnd)
  const uiStart = originalPicker.indexOf('  const selectedWorkspace =')
  assert.ok(uiStart > 0)
  const ui = originalPicker.slice(uiStart, originalPicker.lastIndexOf('\n}'))
  let output = source.slice(0, pickerStart) + observer.replace('  // RESTORE_PICKER_UI', ui) + '\n' + source.slice(pickerEnd)
  const invocation = 'await exerciseWindowsDirectoryPicker(page, harnessHome, userData)'
  assert.equal(output.split(invocation).length, 2)
  output = output.replace(invocation, 'await exerciseWindowsDirectoryPicker(page, harnessHome, userData, nativeApp)')
  const runStart = output.indexOf('export async function runPackagedDesktopSmoke(')
  let run = output.slice(runStart)
  for (const name of ['exerciseSessionMessenger', 'exerciseComposerAddMenu', 'assertWorkbenchRemoved',
    'exerciseTurnNavigation', 'exerciseExistingSessionModelSwitch', 'exerciseComposerContinuity', 'exerciseReasoningEffort',
    'exerciseUsageInsights', 'exercisePersonalization', 'exerciseSystemUpdate', 'exercisePluginMarket',
    'exerciseReaderPresentation', 'exerciseNativeSessionWorkspaces']) {
    const call = `await ${name}(`
    assert.ok(run.includes(call))
    run = run.replace(call, `diagnosticPhase = '${name}'\n    ${call}`)
  }
  output = output.slice(0, runStart) + run
  return output + String.raw`

import { it } from 'vitest'
import { pickerReceipt } from '../../../scripts/windows-picker-diagnostic-driver.mjs'
import { verifySessionWorkspaceReceipt } from '../../../scripts/desktop-session-workspace-receipt.ts'

it('selects through the native picker then probes the existing full packaged tail on the same bytes', async () => {
  let primaryError: string | null = null
  let observerOk: boolean | null = null
  const evidence = process.env.DSH_PICKER_EVIDENCE
  const executable = process.env.DSH_WINDOWS_DESKTOP_EXECUTABLE
  if (process.platform !== 'win32' || !evidence || !executable) throw new Error('Native diagnostic inputs are required.')
  try {
    await runPackagedDesktopSmoke(executable, 'win32')
    diagnosticPhase = 'session-workspace-receipt'
    const path = join(repositoryRoot, 'apps/desktop/release/desktop-smoke-session-workspaces-win32.json')
    await verifySessionWorkspaceReceipt(path)
    await writeFile(join(evidence, 'session-workspaces.json'), JSON.stringify({
      productSourceSha: '5a17c6b29971b6034929bb8a13e3b11cdc4748e8',
      diagnosticSourceSha: process.env.DSH_PICKER_DIAGNOSTIC_SHA,
      receipt: JSON.parse(await readFile(path, 'utf8')) as unknown,
    }) + '\n')
    diagnosticPhase = 'closed'
  } catch (error) {
    primaryError = error instanceof Error ? error.name : 'UnknownError'
  } finally {
    const control = process.env.DSH_PICKER_CONTROL
    if (control) await writeFile(join(control, 'observe.stop'), 'stop')
    observerOk = diagnosticObserver === undefined ? null : await diagnosticObserver
    await writeFile(join(evidence, 'driver.json'), JSON.stringify({
      schemaVersion: 1, productSourceSha: '5a17c6b29971b6034929bb8a13e3b11cdc4748e8',
      diagnosticSourceSha: process.env.DSH_PICKER_DIAGNOSTIC_SHA,
      fixtureSha256: 'a5ef803903cbb3d79e6c0276d24962cd16f5d1fe030ded2aff5e983cde6040ae',
      phase: diagnosticPhase, primaryError, observerOk, diagnosticReceiptError, diagnosticOnly: true,
    }) + '\n')
  }
  expect(primaryError, 'Native selection, packaged features or teardown failed; see bounded receipt.').toBeNull()
  expect(observerOk, 'Native observer failed; see bounded receipt.').toBe(true)
}, 300_000)
`
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = readFileSync('apps/desktop/tests/packaged-smoke.ts', 'utf8')
  writeFileSync('apps/desktop/tests/picker-diagnostic-generated.spec.ts', createDriver(source), { flag: 'wx' })
}
