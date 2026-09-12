import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Windows installed directory-picker acceptance', () => {
  it('selects an exact existing folder through the native dialog', () => {
    const automation = readFileSync(
      new URL('./windows-directory-picker-ui-smoke.ps1', import.meta.url),
      'utf8',
    )
    const packagedSmoke = readFileSync(
      new URL('../apps/desktop/tests/packaged-smoke.ts', import.meta.url),
      'utf8',
    )

    expect(automation).toContain('Select Workspace Directory')
    expect(automation).toContain('[System.Windows.Forms.SendKeys]::SendWait')
    expect(automation).toContain("SendWait('^l')")
    expect(automation).toContain("SendWait('{ENTER}')")
    expect(automation).not.toContain('$dialog.SetFocus()')
    expect(automation).toContain('GetForegroundWindow')
    expect(automation).toContain('DSH_WINDOWS_DESKTOP_EXECUTABLE')
    expect(automation).toContain('[void]$script:PickerOwner.Handle')
    expect(automation).toContain('ValuePattern]$address.Pattern).SetValue($resolvedFolder)')
    expect(automation.indexOf('Test-PickerPathReadback -Expected $resolvedFolder')).toBeLessThan(
      automation.indexOf("SendWait('{ENTER}')"),
    )
    expect(automation).toContain('Invoke-DirectoryPickerAccept')
    expect(automation).toContain('[System.Windows.Automation.InvokePattern]::Pattern')
    expect(automation).toContain("AutomationId -eq '1'")
    expect(packagedSmoke).toContain('windows-directory-picker-ui-smoke.ps1')
    expect(packagedSmoke).toContain('native-picker-selected')
    expect(packagedSmoke).toContain('page.locator(\'[role="treeitem"][aria-expanded]\')')
    expect(packagedSmoke).not.toContain(
      'await page.getByText(basename(selectedDirectory), { exact: true })',
    )
    expect(packagedSmoke).toContain('nativeBlankSession')
    expect(packagedSmoke).toContain('await dismissCredentialOnboarding(page, false)')
    expect(packagedSmoke).toContain("expect(lifecycle).not.toContain('FATAL ERROR')")
  })

  it.skipIf(process.platform !== 'win32')('rejects unwritten paths and foreign or unfocused targets in the actual PowerShell guard', () => {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
      $ErrorActionPreference='Stop'
      $tokens=$null; $errors=$null
      $ast=[System.Management.Automation.Language.Parser]::ParseFile($env:DSH_PICKER_SOURCE,[ref]$tokens,[ref]$errors)
      if($errors.Count){throw 'Picker parser failed'}
      $definition=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-PickerPathReadback'},$true)
      . ([scriptblock]::Create($definition.Extent.Text))
      $path='C:\\isolated\\selected'
      @(
        (Test-PickerPathReadback $path $path $true $true $true)
        (Test-PickerPathReadback $path '' $true $true $true)
        (Test-PickerPathReadback $path 'C:\\other' $true $true $true)
        (Test-PickerPathReadback $path $path $false $true $true)
        (Test-PickerPathReadback $path $path $true $false $true)
        (Test-PickerPathReadback $path $path $true $true $false)
      ) | ConvertTo-Json -Compress
    `], { env: { ...process.env, DSH_PICKER_SOURCE: fileURLToPath(new URL('./windows-directory-picker-ui-smoke.ps1', import.meta.url)) },
      encoding: 'utf8', timeout: 15_000 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([true, false, false, false, false, false])
  })
})
