import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Windows installed Computer Use acceptance', () => {
  it('drives the packaged helper through two harmless windows and one protected target', () => {
    const source = readFileSync(
      new URL('./windows-computer-use-smoke.ps1', import.meta.url),
      'utf8',
    )

    expect(source).toContain('DSH Computer Fixture Alpha')
    expect(source).toContain('DSH Computer Fixture Beta')
    expect(source).toContain('DSH Protected Fixture')
    expect(source).toContain('[System.Diagnostics.ProcessStartInfo]::new($pwsh)')
    expect(source).toContain("ArgumentList.Add('-STA')")
    expect(source).toContain('$fixtureInfo.RedirectStandardError = $true')
    expect(source).toContain('CreateProcessWithLogonW')
    expect(source).toContain('New-LocalUser')
    expect(source).toContain('Remove-LocalUser')
    expect(source).toContain('$env:PUBLIC')
    expect(source).toContain("'*S-1-5-32-545:(OI)(CI)M'")
    expect(source).toContain('-MediumIntegrityChild')
    expect(source).toContain('-ProgressPath')
    expect(source).toContain("Set-SmokeProgress 'helper-started'")
    expect(source).toContain('Standard-user smoke stalled at')
    expect(source).toContain('60000')
    expect(source).toContain("-RequestKind 'list'")
    expect(source).toContain("-RequestKind 'lease.install'")
    expect(source).toContain("-RequestKind 'snapshot'")
    expect(source).toContain('includeImage = $true')
    expect(source).toContain("-RequestKind 'click'")
    expect(source).toContain("-RequestKind 'focus'")
    expect(source).toContain("-RequestKind 'stop'")
    expect(source).toContain("'PERMISSION_DENIED'")
    expect(source).toContain("'LEASE_REVOKED'")
    expect(source).toContain('[byte[]](0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)')
    expect(source).toContain('Get-FileHash')
  })

  it('runs against the exact installed helper before packaged lifecycle and uninstall', () => {
    const setup = readFileSync(
      new URL('./windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )
    const nativeAcceptance = setup.indexOf('./scripts/windows-computer-use-smoke.ps1')
    const packagedLifecycle = setup.indexOf('windows-packaged-smoke.spec.ts')
    const uninstall = setup.indexOf('Invoke-IsolatedUninstall -InstalledUninstaller')

    expect(setup).toContain("Get-ChildItem -LiteralPath $installRoot -Filter 'computer-use-helper.exe' -File -Recurse")
    expect(nativeAcceptance).toBeGreaterThan(-1)
    expect(packagedLifecycle).toBeGreaterThan(nativeAcceptance)
    expect(uninstall).toBeGreaterThan(packagedLifecycle)
  })

  it('runs once against the freshly built helper before the expensive Setup build', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )
    const nativeAcceptance = workflow.indexOf('../../scripts/windows-computer-use-smoke.ps1')
    const immutableInstall = workflow.indexOf('Install immutable dependencies')

    expect(workflow).toContain('cargo build --locked --release')
    expect(nativeAcceptance).toBeGreaterThan(-1)
    expect(immutableInstall).toBeGreaterThan(nativeAcceptance)
  })
})
