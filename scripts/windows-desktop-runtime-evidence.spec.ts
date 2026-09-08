import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Windows Desktop runtime evidence wiring', () => {
  it.skipIf(process.platform !== 'win32')('rejects background windows, partial queries, ambiguous results and changed foregrounds', () => {
    const source = fileURLToPath(new URL('./windows-desktop-native-visual-smoke.ps1', import.meta.url))
    const command = `
      $tokens = $null; $errors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:DSH_VISUAL_SCRIPT, [ref]$tokens, [ref]$errors)
      if ($errors.Count -ne 0) { throw 'Visual smoke did not parse.' }
      $definitions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Test-SearchProcessName', 'Test-SearchApplicationObservation') }, $true)
      foreach ($definition in $definitions) { . ([scriptblock]::Create($definition.Extent.Text)) }
      @(
        (Test-SearchApplicationObservation SearchHost 'DeepSeek Harness' 1 $true 'DeepSeek Harness')
        (Test-SearchApplicationObservation 'DeepSeek Harness' 'DeepSeek Harness' 1 $true 'DeepSeek Harness')
        (Test-SearchApplicationObservation SearchHost 'DeepSe' 1 $true 'DeepSeek Harness')
        (Test-SearchApplicationObservation SearchHost 'DeepSeek Harness' 0 $true 'DeepSeek Harness')
        (Test-SearchApplicationObservation SearchHost 'DeepSeek Harness' 2 $true 'DeepSeek Harness')
        (Test-SearchApplicationObservation SearchHost 'DeepSeek Harness' 1 $false 'DeepSeek Harness')
        (Test-SearchApplicationObservation SearchHost 'DeepSeek Harness' 1 $true 'DeepSeek Harness Setup')
        (Test-SearchApplicationObservation SearchHost 'DeepSeek Harness' 1 $true 'DeepSeek Harness Notes.txt')
      ) | ConvertTo-Json -Compress
    `
    const result = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      env: { ...process.env, DSH_VISUAL_SCRIPT: source },
      timeout: 30_000,
    })
    expect(JSON.parse(result)).toEqual([true, false, false, false, false, false, false, false])
  })

  it('restricts historical inventory to the pinned baseline and keeps ordinary runtime evidence strict', () => {
    const smoke = readFileSync(new URL('./windows-desktop-setup-smoke.ps1', import.meta.url), 'utf8')
    const workflow = readFileSync(new URL('../.github/workflows/windows-desktop.yml', import.meta.url), 'utf8')
    expect(smoke).toContain('[switch]$HistoricalBaselineInventory')
    expect(smoke).toContain('HistoricalBaselineInventory requires RuntimeEvidenceOnly without a candidate policy or manifest.')
    expect(smoke).toContain("$inventoryArguments += '--historical-baseline'")
    expect(smoke).toContain('-HistoricalBaselineInventory:$HistoricalBaselineInventory')
    expect(workflow.match(/-HistoricalBaselineInventory/g)).toHaveLength(1)
    expect(workflow).toContain('-RuntimeEvidenceOnly `\n            -HistoricalBaselineInventory')
    expect(workflow.indexOf('adb72bcbdc40ee87b37b7eb5867b75f66110cbb50ad91ad55e6f1a910191ca87'))
      .toBeLessThan(workflow.indexOf('-HistoricalBaselineInventory'))
  })

  it('measures ten isolated cold launches and ten same-home warm launches before uninstall', () => {
    const smoke = readFileSync(
      new URL('./windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )

    expect(smoke).toContain('[string]$StartupSummaryPath')
    expect(smoke).toContain('[string]$PackageInventoryPath')
    expect(smoke).toContain('function Invoke-DesktopStartupSample')
    expect(smoke).toContain("foreach ($sampleKind in @('cold', 'warm'))")
    expect(smoke).toContain('for ($sampleIndex = 1; $sampleIndex -le 10; $sampleIndex += 1)')
    expect(smoke).not.toContain('for ($sampleIndex = 1; $sampleIndex -le 5; $sampleIndex += 1)')
    expect(smoke).toContain("-SampleKind 'warm-prime'")
    expect(smoke).toContain('startup (app-ready|window-prerequisites|loading-visible|fallback-ready|url-reported|harness-ready|desktop-running)')
    expect(smoke).toContain(
      'runtime (profile-compose|loader-mount|loader-settle|activation-audit|loader-build-duration|root-include-duration|first-party-import-duration|root-activation-duration|settle-duration|audit-duration)',
    )
    expect(smoke).toContain('$process.CloseMainWindow()')
    expect(smoke).toContain('Get-IsolatedInstalledProcesses -ExecutablePath $ExecutablePath')
    expect(smoke).toContain('run benchmark:startup --output')
    expect(smoke).not.toContain('run benchmark:startup -- --output')
    expect(smoke).toContain('run inventory:package @inventoryArguments')
    expect(smoke).not.toContain('run inventory:package -- @inventoryArguments')
    expect(smoke).toContain("[ValidateSet('windows-x64')]")
    expect(smoke).toContain("'--policy', $PackagePolicy")
    expect(smoke).toContain("'--manifest', $resolvedManifest")
    expect(smoke).toContain('function Assert-ManagedPackageRootsPhysical')
    expect(smoke).toContain("'resources\\app.asar.unpacked\\node_modules'")
    expect(smoke).toContain('[System.IO.FileAttributes]::ReparsePoint')
    expect(smoke).not.toContain('Copy-Item -LiteralPath $lifecyclePath')
  })

  it('uploads only portable startup and package summaries beside the Setup', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )
    expect(workflow).toContain('desktop-startup-summary.json')
    expect(workflow).toContain('desktop-package-installed.json')
    expect(workflow).toContain('desktop-package-staged.json')
    expect(workflow).toContain('-StartupSummaryPath')
    expect(workflow).toContain('-PackageInventoryPath')
    expect(workflow).toContain('runtime-evidence-${{ steps.source.outputs.sha }}')
    expect(workflow).not.toContain('lifecycle.log\n')
    expect(workflow).not.toContain('cpuprofile')
  })

  it('records installed bytes, the inventory digest, and exact shortcut icon ownership', () => {
    const smoke = readFileSync(
      new URL('./windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )

    expect(smoke).toContain('[string]$InstallationEvidencePath')
    expect(smoke).toContain('function Get-InstalledShortcutEvidence')
    expect(smoke).toContain('WScript.Shell')
    expect(smoke).toContain('$shortcut.TargetPath')
    expect(smoke).toContain('$shortcut.IconLocation')
    expect(smoke).toContain('Shortcut icon must resolve to the installed executable')
    expect(smoke).toContain('inventorySha256')
    expect(smoke).toContain('installedBytes')
    expect(smoke).toContain('categories = $inventoryDocument.categories')
    expect(workflow).toContain('desktop-windows-install-evidence.json')
  })

  it('runs installed visual evidence at 100 and 150 percent without leaking raw logs', () => {
    const smoke = readFileSync(
      new URL('./windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )
    const visual = readFileSync(
      new URL('./windows-desktop-native-visual-smoke.ps1', import.meta.url),
      'utf8',
    )
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )
    const packaged = readFileSync(
      new URL('../apps/desktop/tests/windows-packaged-smoke.spec.ts', import.meta.url),
      'utf8',
    )
    const main = readFileSync(
      new URL('../apps/desktop/src/main.ts', import.meta.url),
      'utf8',
    )
    const trayEvidence = readFileSync(
      new URL('../apps/desktop/src/native-visual-tray-evidence.ts', import.meta.url),
      'utf8',
    )

    expect(smoke).toContain('foreach ($dpiPercent in @(100, 150))')
    expect(smoke).toContain('./scripts/windows-desktop-native-visual-smoke.ps1')
    expect(visual).toContain('--force-device-scale-factor=')
    expect(visual).toContain('function Save-NativeScreenCapture')
    const searchWaiter = visual.slice(visual.indexOf('function Wait-SearchApplicationResult'), visual.indexOf('function Invoke-AutomationElement'))
    expect(searchWaiter).toContain('AutomationElement]::FromHandle($foreground)')
    expect(searchWaiter).not.toContain('RootElement')
    expect(searchWaiter).toContain('ValuePattern]::Pattern')
    expect(searchWaiter).toContain('Test-SearchApplicationObservation')
    expect(visual).toContain('[void](Wait-SearchApplicationResult)')
    expect(visual).toContain('DwmGetWindowAttribute(window, 9')
    expect(visual).toContain('SetThreadDpiAwarenessContext(previous)')
    expect(visual).toContain('Contains($windowGeometry.WorkArea, $windowGeometry.VisibleFrame)')
    expect(visual).toContain('windowGeometryPhysicalPixels = $windowGeometry')
    expect(visual).toContain('function Open-DeepSeekHarnessTrayMenu')
    expect(visual).toContain('$maxTrayMenuAttempts = 3')
    expect(visual).toContain(
      'for ($attempt = 1; $attempt -le $maxTrayMenuAttempts; $attempt += 1)',
    )
    expect(visual).toContain('$overflowOpenedAt = [DateTimeOffset]::UtcNow')
    expect(visual).toContain('if ($attempt -eq $maxTrayMenuAttempts)')
    expect(visual).toContain("throw 'Windows did not expose the DeepSeek Harness tray menu after 3 attempts.'")
    expect(visual).toContain('Show DeepSeek Harness')
    expect(visual).toContain("-NamePattern '^Quit$'")
    expect(visual).not.toContain("-NamePattern '^Quit DeepSeek Harness$'")
    expect(visual).toContain('public static void LeftClick(int x, int y)')
    expect(visual).toContain('$hiddenBounds = $hiddenIcons.Current.BoundingRectangle')
    expect(visual).toContain('[NativeVisualInput]::LeftClick(')
    expect(visual).not.toContain("-NamePattern '^DeepSeek Harness' `\n    -ControlType")
    expect(visual).toContain("$trayEvidencePath = Join-Path $UserData 'native-visual-tray.json'")
    expect(visual).toContain('Remove-Item -LiteralPath $trayEvidencePath -Force')
    expect(visual).toContain("$startInfo.Environment['DSH_DESKTOP_NATIVE_VISUAL_EVIDENCE'] = '1'")
    expect(visual).toContain('function Wait-NativeVisualTrayEvidence')
    expect(visual).toContain('$evidenceObservedAt -le $OverflowOpenedAt')
    expect(visual).toContain('[System.Windows.Forms.SystemInformation]::VirtualScreen')
    expect(visual).toContain('($clickX -lt $virtualScreen.Left) -or')
    expect(visual).toContain('($clickX -ge $virtualScreen.Right) -or')
    expect(visual).toContain('($clickY -lt $virtualScreen.Top) -or')
    expect(visual).toContain('($clickY -ge $virtualScreen.Bottom)')
    expect(visual).not.toMatch(/\n\s+-or \$click[XY]/u)
    expect(visual).toContain('$expectedIconSize = if ($DpiPercent -eq 100) { 16 } else { 24 }')
    expect(visual).toContain('tray-overflow-$DpiPercent.png')
    expect(visual).toContain('native-visual-failure-$DpiPercent.png')
    expect(main).toContain("process.env.DSH_DESKTOP_NATIVE_VISUAL_EVIDENCE === '1'")
    expect(main).toContain("join(userData, 'native-visual-tray.json')")
    expect(main).toContain('activeTray.getBounds()')
    expect(main).toContain('screen.dipToScreenPoint')
    expect(main).not.toContain("ipcMain.handle('desktop:native-visual")
    const traySync = main.indexOf('function syncWindowsTray(): void')
    const traySyncStop = main.indexOf('nativeVisualTrayEvidence.stop()', traySync)
    const traySyncDestroy = main.indexOf('tray?.destroy()', traySync)
    const beforeQuit = main.indexOf("app.on('before-quit'")
    const beforeQuitStop = main.indexOf('nativeVisualTrayEvidence.stop()', beforeQuit)
    const beforeQuitDestroy = main.indexOf('tray?.destroy()', beforeQuit)
    expect(traySyncStop).toBeGreaterThan(traySync)
    expect(traySyncDestroy).toBeGreaterThan(traySyncStop)
    expect(beforeQuitStop).toBeGreaterThan(beforeQuit)
    expect(beforeQuitDestroy).toBeGreaterThan(beforeQuitStop)
    expect(trayEvidence).toContain('const SAMPLE_INTERVAL_MS = 250')
    expect(trayEvidence).toContain('timer.unref()')
    expect(trayEvidence).toContain('if (!options.enabled) return')
    expect(trayEvidence).toContain('void options.write({')
    expect(trayEvidence).toContain('}).catch(() => {})')
    expect(visual).toContain('Get-DescendantProcessIds')
    expect(visual).toContain('Wait-ProcessIdsStopped')
    expect(visual).toContain('desktop-shortcut')
    expect(visual).toContain('start-menu-shortcut')
    expect(visual).toContain('taskbar-running')
    expect(visual).toContain('tray-menu')
    expect(packaged).toContain("'--force-device-scale-factor=1.5'")
    expect(packaged).toContain('window.devicePixelRatio')
    expect(packaged).toContain('seeded: WindowsClipboardSmokeState')
    expect(packaged).toContain('const seeded = await runPackagedDesktopSmoke')
    expect(packaged).toContain('exerciseWindows150PercentSurface(executable, seeded)')
    expect(packaged).toContain('hasText: seeded.activeSessionTitle')
    expect(packaged).not.toContain("expect(await page.locator('[class*=\"sidebarCol\"]').count()).toBe(1)")
    expect(packaged).not.toContain("expect(await page.locator('[class*=\"centerCol\"]').count()).toBe(1)")
    expect(packaged).not.toContain("expect(await page.locator('[class*=\"detailsCol\"]').count()).toBe(1)")
    const desktopBody = packaged.indexOf('body[data-dsh-surface="desktop"]')
    const frameColumns = packaged.indexOf('await expect.poll(async () => Promise.all([')
    const rendererScale = packaged.indexOf('window.devicePixelRatio')
    expect(desktopBody).toBeGreaterThan(-1)
    expect(frameColumns).toBeGreaterThan(desktopBody)
    expect(rendererScale).toBeGreaterThan(frameColumns)
    expect(packaged).toContain("page.locator('[class*=\"sidebarCol\"]').count(),")
    expect(packaged).toContain("page.locator('[class*=\"centerCol\"]').count(),")
    expect(packaged).toContain("page.locator('[class*=\"detailsCol\"]').count(),")
    expect(packaged).toContain(']), { timeout: 120_000 }).toEqual([1, 1, 1])')
    expect(packaged).not.toContain(
      "page.getByRole('navigation', { name: /^(?:Previous prompts|过往发言)$/u })\n"
      + "      .waitFor({ state: 'visible', timeout: 30_000 })",
    )
    expect(packaged).toContain('Collapse sidebar|收起侧边栏')
    expect(packaged).not.toContain('Close sidebar|关闭侧边栏')
    const selectedTarget = packaged.indexOf("activeRow.getAttribute('aria-selected')")
    const closeSidebar = packaged.indexOf('const closeSidebar = page.getByRole')
    const collapsedAfterSelection = packaged.indexOf(
      "() => page.locator('[class*=\"frame\"][data-sidebar-collapsed]').count()",
      closeSidebar,
    )
    const promptRail = packaged.indexOf('const turnRail = page.locator')
    const attachedRail = packaged.indexOf("await turnRail.waitFor({ state: 'attached'")
    const track = packaged.indexOf("turnRail.locator('[data-turn-navigation-track]')")
    const visibleTrack = packaged.indexOf("await turnRailTrack.waitFor({ state: 'visible'")
    const populatedRail = packaged.indexOf("turnRail.locator('button[aria-label*=\"\u8df3\u8f6c\"], button[aria-label*=\"jump to\"]')", visibleTrack)
    const currentRail = packaged.indexOf("turnRail.locator('button[aria-current=\"true\"]')")
    const openTooltip = packaged.indexOf("page.getByRole('tooltip').waitFor({ state: 'visible'")
    const workbench = packaged.indexOf('Open workbench|打开工作台')
    expect(selectedTarget).toBeGreaterThan(-1)
    expect(closeSidebar).toBeGreaterThan(selectedTarget)
    expect(collapsedAfterSelection).toBeGreaterThan(closeSidebar)
    expect(promptRail).toBeGreaterThan(collapsedAfterSelection)
    expect(attachedRail).toBeGreaterThan(promptRail)
    expect(track).toBeGreaterThan(attachedRail)
    expect(visibleTrack).toBeGreaterThan(track)
    expect(populatedRail).toBeGreaterThan(visibleTrack)
    expect(currentRail).toBeGreaterThan(populatedRail)
    expect(openTooltip).toBeGreaterThan(currentRail)
    expect(workbench).toBeGreaterThan(openTooltip)
    expect(packaged).toContain('Turn navigation')
    expect(packaged).not.toContain("await turnRail.waitFor({ state: 'visible'")
    expect(packaged).toContain("await turnRail.waitFor({ state: 'attached'")
    expect(packaged).toContain("await turnRailTrack.waitFor({ state: 'visible'")
    expect(packaged).toContain('const turnRailBounds = await turnRailTrack.boundingBox()')
    expect(packaged).toContain('.toBeGreaterThanOrEqual(2)')
    expect(packaged).toContain(
      "expect(await page.getByRole('button', { name: /^(?:Open workbench|打开工作台)$/u }).count()).toBe(0)",
    )
    for (const selector of [
      '[data-desktop-workbench-panel], [data-utility-drawer], [data-side="utility"]',
      '[data-plugin-card="browser-skill"], [data-browser-skill-idle]',
      '[data-plugin-card="open-design"], [data-open-design-state]',
    ]) {
      expect(packaged).toContain(`'${selector}',\n    ).count()).toBe(0)`)
    }
    expect(packaged).not.toContain('await workbenchTrigger.click()')
    expect(packaged).toContain('.toBeGreaterThan(680)')
    expect(packaged).toContain("queryInlineSize <= 584 ? 'hidden' : 'visible'")
    const nativeCapture = packaged.indexOf("path: join(nativeEvidenceRoot, 'renderer-native-150.png')")
    const wideViewport = packaged.indexOf('await page.setViewportSize({ width: 1600, height: 1000 })')
    expect(nativeCapture).toBeGreaterThan(attachedRail)
    expect(wideViewport).toBeGreaterThan(nativeCapture)
    expect(visibleTrack).toBeGreaterThan(wideViewport)
    expect(packaged).toContain('waitForWindowsProcessesStopped')
    const sharedPackaged = readFileSync(
      new URL('../apps/desktop/tests/packaged-smoke.ts', import.meta.url),
      'utf8',
    )
    expect(sharedPackaged.indexOf('await continueButton.click()'))
      .toBeLessThan(sharedPackaged.indexOf('await page.setViewportSize('))
    expect(sharedPackaged).toContain('expect(initialButton.receivesPointer).toBe(true)')
    expect(workflow).toContain('desktop-smoke-first-run-win32.json')
    expect(sharedPackaged).toContain('exerciseComposerAddMenu(page, clipboardSeed)')
    expect(sharedPackaged).toContain('exerciseTurnNavigation(page, clipboardSeed)')
    expect(sharedPackaged).toContain('exerciseWindowsDirectoryPicker(page, harnessHome, userData)')
    expect(sharedPackaged).toContain('assertWorkbenchRemoved(page)')
    expect(sharedPackaged).not.toContain('exerciseDesktopWorkbench(')
    expect(sharedPackaged).not.toContain('seedOpenDesignPluginStatus(')
    expect(sharedPackaged).not.toContain("join(harnessHome, 'profiles', 'open-design')")
    expect(workflow).toContain('Windows-native-visual-evidence-${{ steps.source.outputs.sha }}')
    expect(workflow).not.toContain('fixed-milestones/')
    expect(workflow).not.toContain('lifecycle.log')
  })

  it('benchmarks the pinned public 0.5.3 Setup on the same runner before the candidate', () => {
    const smoke = readFileSync(
      new URL('./windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )

    expect(smoke).toContain('[switch]$RuntimeEvidenceOnly')
    expect(smoke).toContain('if (-not $RuntimeEvidenceOnly)')
    expect(workflow).toContain('DeepSeek-Harness-Setup-0.5.3-win-x64.exe')
    expect(workflow).toContain('152982782')
    expect(workflow).toContain('adb72bcbdc40ee87b37b7eb5867b75f66110cbb50ad91ad55e6f1a910191ca87')
    expect(workflow).not.toContain('DeepSeek-Harness-Setup-0.5.1-win-x64.exe')
    expect(workflow).toContain('-RuntimeEvidenceOnly')
    expect(workflow).toContain('desktop-startup-baseline-0.5.3.json')
    expect(workflow).toContain('desktop-package-installed-baseline-0.5.3.json')
    expect(workflow).toContain('desktop-package-setup-baseline-0.5.3.json')
    expect(workflow).toContain('-PackagePolicy windows-x64')
  })
})
