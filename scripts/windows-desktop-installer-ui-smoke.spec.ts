import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Windows Desktop assisted installer smoke', () => {
  it('re-enables visible installer details before reporting bounded setup stages', () => {
    const source = readFileSync(
      new URL('../apps/desktop/build/installer.nsh', import.meta.url),
      'utf8',
    )
    const details = source.indexOf('SetDetailsPrint both')

    expect(details).toBeGreaterThan(-1)
    expect(source.indexOf('Application files installed and verified')).toBeGreaterThan(details)
    expect(source.indexOf('Native computer-control helper installed')).toBeGreaterThan(details)
    expect(source.indexOf('Desktop and Start menu shortcuts are ready')).toBeGreaterThan(details)
    expect(source.indexOf('Existing DeepSeek Harness workspace data was preserved')).toBeGreaterThan(details)
    expect(source.indexOf('DeepSeek Harness is ready to launch')).toBeGreaterThan(details)
    expect(source).not.toContain('installed to $INSTDIR')
  })

  it('walks the visible welcome, destination, progress/details, and finish pages', () => {
    const source = readFileSync(
      new URL('./windows-desktop-installer-ui-smoke.ps1', import.meta.url),
      'utf8',
    )

    expect(source).toContain('UIAutomationClient')
    expect(source).toContain('$script:InstallerProcessId')
    expect(source).toContain('Welcome to DeepSeek Harness Setup')
    expect(source).toContain('Choose Install Location')
    expect(source).toContain('[System.Windows.Automation.ControlType]::ProgressBar')
    expect(source).toContain('NativeInstallerWindow')
    expect(source).toContain('SysListView32')
    expect(source).toContain('Application files installed')
    expect(source).toContain('Completing DeepSeek Harness Setup')
    expect(source).toContain('Run DeepSeek Harness')
    expect(source).toContain('Invoke-IsolatedUninstall')
    expect(source).toContain("[Environment]::GetFolderPath('Desktop')")
    expect(source).toContain("[Environment]::GetFolderPath('Programs')")
    expect(source).toContain('$requestedInstallRoot = $temporaryRoot')
    expect(source).toContain('Add("/D=$requestedInstallRoot")')
    expect(source).toContain("Join-Path $temporaryRoot 'DeepSeek Harness'")
  })

  it('is wired into native Windows CI before the packaged lifecycle smoke', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )
    const visible = workflow.indexOf('./scripts/windows-desktop-installer-ui-smoke.ps1')
    const lifecycle = workflow.indexOf('./scripts/windows-desktop-setup-smoke.ps1')

    expect(visible).toBeGreaterThan(-1)
    expect(lifecycle).toBeGreaterThan(visible)
  })
})
