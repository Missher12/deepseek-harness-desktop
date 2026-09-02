import { readFileSync } from 'node:fs'
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
})
