import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Windows Desktop assisted installer smoke', () => {
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
    expect(source).toContain('Application files installed')
    expect(source).toContain('Completing DeepSeek Harness Setup')
    expect(source).toContain('Run DeepSeek Harness')
    expect(source).toContain('Invoke-IsolatedUninstall')
    expect(source).toContain("[Environment]::GetFolderPath('Desktop')")
    expect(source).toContain("[Environment]::GetFolderPath('Programs')")
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
