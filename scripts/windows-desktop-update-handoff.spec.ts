import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  const file = new URL(path, import.meta.url)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

describe('installed Windows update handoff entrance', () => {
  it('uses the same fixed Utility import for exact-worker cleanup before its first JSON command', () => {
    const installer = source('../apps/desktop/src/update/windows-installer.ts')
    const cleanup = installer.slice(installer.indexOf('export async function stopWindowsUpdateWorker'), installer.indexOf('interface WindowsUpdateCommandOptions'))
    expect(cleanup).toContain("$PSModuleAutoLoadingPreference = 'None'")
    expect(cleanup.indexOf('${utilityModule}')).toBeGreaterThan(0)
    expect(cleanup.indexOf('${utilityModule}')).toBeLessThan(cleanup.indexOf('| ConvertFrom-Json'))
    expect(cleanup).not.toMatch(/ExecutionPolicy|PSModulePath/u)
  })
  it('parses both generated scripts from owned files without waiting on console stdin', () => {
    const driver = source('../apps/desktop/tests/windows-update-installer.spec.ts')
    const parser = driver.slice(driver.indexOf("'parses both the real bootstrap"), driver.indexOf("'validates the real payload"))
    expect(parser).toContain('Parser]::ParseFile')
    expect(parser).toContain("['ignore', 'pipe', 'pipe']")
    expect(parser).toContain("'bootstrap.ps1','worker.ps1'")
    expect(parser).not.toContain('[Console]::In.ReadToEnd()')
    expect(parser).toContain('DSH_PARSE')
  })
  it('uses the real installed application and production command, not a fake bridge or inert executable', () => {
    const driver = source('../apps/desktop/tests/windows-update-handoff-smoke.spec.ts')
    expect(driver).toContain("import { createWindowsUpdateCommand, stopWindowsUpdateWorker } from '../src/update/windows-installer.ts'")
    expect(driver).toContain('await electron.launch(')
    expect(driver).toContain('bootstrap = await application.evaluateHandle(')
    expect(driver).toContain("process.getBuiltinModule('node:child_process')")
    expect(driver).toContain('expect(creator?.ParentProcessId).toBe(mainPid)')
    expect(driver).toContain("'-HandoffWorkerCreated', waiting.Created")
    expect(driver).toContain('detached: false')
    expect(driver).toContain('process.execPath')
    expect(driver).toContain('DSH_UPDATE_READY')
    expect(driver).toContain('DSH_HANDOFF_OBSERVER_READY')
    expect(driver).toContain('app.quit()')
    expect(driver).toContain('parentPid: identity.pid, parentExecutable: identity.executable')
    expect(driver).not.toMatch(/updatePayload|copyFile\(process\.execPath|ipcMain\.handle|setInterval|getUpdateStatus\s*=/u)
    expect(driver).toContain('await verifyDesktopUpdateFile(descriptor)')
    expect(driver).toContain("'body[data-dsh-surface=\"desktop\"]'")
    expect(driver).toContain('waitForStopped')
    expect(driver).toContain('protectedBefore')
  })

  it('runs once inside the existing isolated installed lifecycle before uninstall with the same Setup', () => {
    const lifecycle = source('./windows-desktop-setup-smoke.ps1')
    const entrance = 'apps/desktop/tests/windows-update-handoff-smoke.spec.ts'
    expect(lifecycle.match(new RegExp(entrance.replaceAll('.', '\\.'), 'gu'))).toHaveLength(1)
    expect(lifecycle).toContain('$env:DSH_WINDOWS_UPDATE_SETUP = $resolvedSetup')
    expect(lifecycle).toContain('$env:DSH_WINDOWS_UPDATE_SETUP_SHA256')
    expect(lifecycle).toContain('$env:DSH_WINDOWS_UPDATE_HANDOFF = \'1\'')
    expect(lifecycle).toContain('Remove-Item Env:DSH_WINDOWS_UPDATE_HANDOFF')
    expect(lifecycle.indexOf(entrance)).toBeGreaterThan(lifecycle.indexOf('apps/desktop/tests/windows-packaged-smoke.spec.ts'))
    expect(lifecycle.indexOf(entrance)).toBeLessThan(lifecycle.lastIndexOf('Invoke-IsolatedUninstall -InstalledUninstaller $uninstaller'))
  })

  it('keeps native proof separate from early contracts and uploads only the bounded handoff evidence', () => {
    const workflow = source('../.github/workflows/windows-desktop.yml')
    expect(workflow).toContain('scripts/windows-desktop-update-handoff.spec.ts')
    expect(workflow).not.toContain('apps/desktop/tests/windows-update-handoff-smoke.spec.ts')
    expect(workflow).toContain('s/apps/desktop/release/windows-update-handoff-evidence/handoff.json')
    expect(workflow).toContain('s/apps/desktop/release/windows-update-handoff-evidence/handoff-welcome.png')
    expect(workflow).not.toContain('windows-update-handoff-evidence/*')
  })
})
