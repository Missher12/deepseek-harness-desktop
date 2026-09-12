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
    expect(automation).toContain('[System.Windows.Automation.AutomationElement]::FromHandle')
    expect(automation).toContain('GetLastActivePopup')
    expect(automation).toContain('Get-PickerNativeRelationship')
    expect(automation).toContain('Select-PickerTarget')
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

  it.skipIf(process.platform !== 'win32')('selects the owned interactive popup and rejects unrelated, disabled, stale and ambiguous windows', () => {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
      $ErrorActionPreference='Stop'
      $tokens=$null; $errors=$null
      $ast=[System.Management.Automation.Language.Parser]::ParseFile($env:DSH_PICKER_SOURCE,[ref]$tokens,[ref]$errors)
      if($errors.Count){throw 'Picker parser failed'}
      foreach($name in @('Test-PickerTargetFacts','Select-PickerTarget')) {
        $definition=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
        if($null -eq $definition){throw 'Missing target selection function'}
        . ([scriptblock]::Create($definition.Extent.Text))
      }
      $good=@{hwnd=66190L;uiaHwnd=66190L;pid=7836;nativePid=7836;ownerPid=7836;ownerAlive=$true;related=$true;enabled=$true;offscreen=$false;nativeEnabled=$true;nativeVisible=$true;isWindow=$true;error=$null}
      $anchor=$good.Clone();$anchor.hwnd=327792L;$anchor.uiaHwnd=327792L;$anchor.enabled=$false;$anchor.nativeEnabled=$false
      $results=@((Select-PickerTarget @($anchor,$good)).hwnd -eq 66190)
      foreach($change in @(
        @{related=$false},@{pid=99},@{nativePid=99},@{ownerAlive=$false},@{uiaHwnd=327792L},
        @{enabled=$false},@{offscreen=$true},@{nativeEnabled=$false},@{nativeVisible=$false},@{isWindow=$false},@{error='Unavailable'}
      )) {
        $bad=$good.Clone();foreach($key in $change.Keys){$bad[$key]=$change[$key]}
        $results+=($null -eq (Select-PickerTarget @($anchor,$bad)))
      }
      $second=$good.Clone();$second.hwnd=123L;$second.uiaHwnd=123L
      try { Select-PickerTarget @($good,$second) | Out-Null; $results+=$false }
      catch { $results+=($_.Exception.Message -eq 'Directory picker has multiple interactive related windows.') }
      $results | ConvertTo-Json -Compress
    `], { env: { ...process.env, DSH_PICKER_SOURCE: fileURLToPath(new URL('./windows-directory-picker-ui-smoke.ps1', import.meta.url)) },
      encoding: 'utf8', timeout: 15_000 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(Array.from({ length: 13 }, () => true))
  })

  it.skipIf(process.platform !== 'win32')('measures native child and owner links without treating every same-process window as related', () => {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
      $ErrorActionPreference='Stop'
      Add-Type -AssemblyName System.Windows.Forms
      $tokens=$null;$errors=$null
      $ast=[System.Management.Automation.Language.Parser]::ParseFile($env:DSH_PICKER_SOURCE,[ref]$tokens,[ref]$errors)
      if($errors.Count){throw 'Picker parser failed'}
      $native=$ast.Find({param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $node.Value.Contains('public static class NativePickerWindow')},$true)
      Add-Type -TypeDefinition $native.Value
      $definition=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-PickerNativeRelationship'},$true)
      . ([scriptblock]::Create($definition.Extent.Text))
      $anchor=[System.Windows.Forms.Form]::new();$popup=[System.Windows.Forms.Form]::new()
      $child=[System.Windows.Forms.Form]::new();$other=[System.Windows.Forms.Form]::new()
      $script:PickerOwner=[Diagnostics.Process]::GetCurrentProcess()
      try {
        [void]$script:PickerOwner.Handle
        $anchor.Show();$script:PickerAnchor=$anchor.Handle
        $popup.Show($anchor)
        $child.TopLevel=$false;$anchor.Controls.Add($child);$child.Show()
        $other.Show()
        @(
          (Get-PickerNativeRelationship $anchor.Handle).self
          (Get-PickerNativeRelationship $popup.Handle).ownedPopup
          (Get-PickerNativeRelationship $child.Handle).child
          (Get-PickerNativeRelationship $other.Handle).related
        ) | ConvertTo-Json -Compress
      } finally {
        $child.Dispose();$popup.Dispose();$other.Dispose();$anchor.Dispose();$script:PickerOwner.Dispose()
      }
    `], { env: { ...process.env, DSH_PICKER_SOURCE: fileURLToPath(new URL('./windows-directory-picker-ui-smoke.ps1', import.meta.url)) },
      encoding: 'utf8', timeout: 15_000 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([true, true, true, false])
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
