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
    expect(source).toContain('NativeInstallerWindow')
    expect(source).toContain('SysListView32')
    expect(source).toContain('Application files installed')
    expect(source).toContain('Completing DeepSeek Harness Setup')
    expect(source).toContain('Run DeepSeek Harness')
    expect(source).toContain('Wait-InstallerToggleOff')
    expect(source).toContain('Complete-InstallerFinish')
    expect(source).toContain('Finish page remained visible after the Finish button was invoked.')
    expect(source).toContain('Finish page closed but Setup did not exit.')
    expect(source).not.toContain('$setup.WaitForExit(30000)')
    const finishObserved = source.indexOf('if ($null -eq $finish)')
    const installedAfterFinish = source.indexOf('$installed = $true', finishObserved)
    const completeFinish = source.indexOf('Complete-InstallerFinish -Setup $setup')
    expect(installedAfterFinish).toBeGreaterThan(finishObserved)
    expect(installedAfterFinish).toBeLessThan(completeFinish)
    expect(source).toContain('Invoke-IsolatedUninstall')
    expect(source).toContain("[Environment]::GetFolderPath('Desktop')")
    expect(source).toContain("[Environment]::GetFolderPath('Programs')")
    expect(source).toContain('$requestedInstallRoot = $temporaryRoot')
    expect(source).toContain('Add("/D=$requestedInstallRoot")')
    expect(source).toContain("Join-Path $temporaryRoot 'DeepSeek Harness'")
    expect(source).toContain('[string]$EvidenceRoot')
    expect(source).toContain('function Save-RedactedInstallerScreenshot')
    expect(source).toContain('[System.Windows.Automation.ControlType]::Edit')
    expect(source).toContain('installer-welcome.png')
    expect(source).toContain('installer-destination.png')
    expect(source).toContain('installer-progress.png')
    expect(source).toContain('installer-finish.png')
  })

  it('is wired into the full native Windows installer consumer without serializing lifecycle', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )
    const installerJob = workflow.indexOf('  installer-ui:')
    const visualJob = workflow.indexOf('  visual:')
    const installerSection = workflow.slice(installerJob, visualJob)

    expect(installerJob).toBeGreaterThan(-1)
    expect(installerSection).toContain('needs: build-candidate')
    expect(installerSection).toContain("if: needs.build-candidate.outputs.mode == 'full'")
    expect(installerSection).toContain('./scripts/windows-desktop-installer-ui-smoke.ps1')
    expect(installerSection).toContain('-EvidenceRoot apps/desktop/release/windows-installer-ui-evidence')
    expect(installerSection).not.toContain('./scripts/windows-desktop-setup-smoke.ps1')
  })
})
