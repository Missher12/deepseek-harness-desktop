import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sourceHash = 'a5ef803903cbb3d79e6c0276d24962cd16f5d1fe030ded2aff5e983cde6040ae'
const observer = String.raw`
let diagnosticPhase = 'startup-prefix'
let diagnosticObserver: Promise<boolean> | undefined

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
  await mkdir(join(harnessHome, 'native-picker-selected'), { recursive: true })
  diagnosticPhase = 'observer-start'
  diagnosticObserver = execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(repositoryRoot, 'scripts/windows-picker-diagnostic.ps1'),
    '-MainProcessId', String(mainPid), '-Executable', executable,
    '-ControlRoot', control, '-EvidenceRoot', evidence,
  ], { timeout: 120_000, maxBuffer: 16_384 }).then(() => true, () => false)
  await waitDiagnosticMarker(control, 'observe.ready', 20_000)
  const addWorkspace = page.getByRole('button', { name: /^(?:Add workspace|添加工作区)$/u })
  await addWorkspace.waitFor({ state: 'visible', timeout: 15_000 })
  diagnosticPhase = 'observe-picker'
  await writeFile(join(control, 'observe.go'), 'go', { flag: 'wx' })
  await addWorkspace.click()
  await waitDiagnosticMarker(control, 'observe.done', 65_000)
  diagnosticPhase = 'normal-teardown'
}
`

/** Make a throwaway test-only prefix from one audited source file; never rewrite the source. */
export function createDriver(source) {
  assert.equal(createHash('sha256').update(source).digest('hex'), sourceHash, 'Diagnostic fixture source drift')
  const pickerStart = source.indexOf('async function exerciseWindowsDirectoryPicker(')
  const pickerEnd = source.indexOf('async function dismissCredentialOnboarding(', pickerStart)
  assert.ok(pickerStart > 0 && pickerEnd > pickerStart)
  let output = source.slice(0, pickerStart) + observer + '\n' + source.slice(pickerEnd)
  const afterPicker = output.indexOf('      await exerciseSessionMessenger(page, clipboardSeed, platform)')
  const teardown = output.indexOf('    const mainPid = nativeApp.process().pid', afterPicker)
  assert.ok(afterPicker > 0 && teardown > afterPicker)
  output = output.slice(0, afterPicker) + '    } catch (error) { throw error }\n\n' + output.slice(teardown)
  const invocation = 'await exerciseWindowsDirectoryPicker(page, harnessHome, userData)'
  assert.equal(output.split(invocation).length, 2)
  output = output.replace(invocation, 'await exerciseWindowsDirectoryPicker(page, harnessHome, userData, nativeApp)')
  return output + String.raw`

import { it } from 'vitest'

it('observes only the existing native picker and then disposes the isolated fixture', async () => {
  let primaryError: string | null = null
  let observerOk: boolean | null = null
  const evidence = process.env.DSH_PICKER_EVIDENCE
  const executable = process.env.DSH_WINDOWS_DESKTOP_EXECUTABLE
  if (process.platform !== 'win32' || !evidence || !executable) throw new Error('Native diagnostic inputs are required.')
  try {
    await runPackagedDesktopSmoke(executable, 'win32')
    diagnosticPhase = 'closed'
  } catch (error) {
    primaryError = error instanceof Error ? error.name : 'UnknownError'
  } finally {
    observerOk = diagnosticObserver === undefined ? null : await diagnosticObserver
    await writeFile(join(evidence, 'driver.json'), JSON.stringify({
      schemaVersion: 1, productSourceSha: '5a17c6b29971b6034929bb8a13e3b11cdc4748e8',
      diagnosticSourceSha: process.env.DSH_PICKER_DIAGNOSTIC_SHA,
      fixtureSha256: 'a5ef803903cbb3d79e6c0276d24962cd16f5d1fe030ded2aff5e983cde6040ae',
      phase: diagnosticPhase, primaryError, observerOk, diagnosticOnly: true,
    }) + '\n')
  }
  expect(primaryError, 'Diagnostic prefix or teardown failed; see bounded receipt.').toBeNull()
  expect(observerOk, 'Native observer failed; see bounded receipt.').toBe(true)
}, 300_000)
`
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = readFileSync('apps/desktop/tests/packaged-smoke.ts', 'utf8')
  writeFileSync('apps/desktop/tests/picker-diagnostic-generated.spec.ts', createDriver(source), { flag: 'wx' })
}
