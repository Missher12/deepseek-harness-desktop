import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Windows Desktop runtime evidence wiring', () => {
  it('measures five isolated cold launches and five same-home warm launches before uninstall', () => {
    const smoke = readFileSync(
      new URL('./windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )

    expect(smoke).toContain('[string]$StartupSummaryPath')
    expect(smoke).toContain('[string]$PackageInventoryPath')
    expect(smoke).toContain('function Invoke-DesktopStartupSample')
    expect(smoke).toContain("foreach ($sampleKind in @('cold', 'warm'))")
    expect(smoke).toContain('for ($sampleIndex = 1; $sampleIndex -le 5; $sampleIndex += 1)')
    expect(smoke).toContain("-SampleKind 'warm-prime'")
    expect(smoke).toContain('startup (app-ready|window-prerequisites|loading-visible|fallback-ready|url-reported|harness-ready|desktop-running)')
    expect(smoke).toContain('runtime (profile-compose|loader-mount|loader-settle|activation-audit)')
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
    expect(visual).toContain('function Open-DeepSeekHarnessTrayMenu')
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
    const selectedTarget = packaged.indexOf("activeRow.getAttribute('aria-selected')")
    const promptRail = packaged.indexOf('const turnRail = page.locator')
    const attachedRail = packaged.indexOf("await turnRail.waitFor({ state: 'attached'")
    const populatedRail = packaged.indexOf("turnRail.locator('button[aria-label*=\"\u8df3\u8f6c\"], button[aria-label*=\"jump to\"]')")
    const currentRail = packaged.indexOf("turnRail.locator('button[aria-current=\"true\"]')")
    const workbench = packaged.indexOf('Open workbench|打开工作台')
    expect(selectedTarget).toBeGreaterThan(-1)
    expect(promptRail).toBeGreaterThan(selectedTarget)
    expect(attachedRail).toBeGreaterThan(promptRail)
    expect(populatedRail).toBeGreaterThan(attachedRail)
    expect(currentRail).toBeGreaterThan(populatedRail)
    expect(workbench).toBeGreaterThan(currentRail)
    expect(packaged).toContain('Turn navigation')
    expect(packaged).toContain('Open workbench|打开工作台')
    expect(packaged).toContain('waitForWindowsProcessesStopped')
    expect(workflow).toContain('Windows-native-visual-evidence-${{ steps.source.outputs.sha }}')
    expect(workflow).not.toContain('fixed-milestones/')
    expect(workflow).not.toContain('lifecycle.log')
  })

  it('benchmarks the pinned 0.5.1 parent Setup on the same runner before the candidate', () => {
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
    expect(workflow).toContain('DeepSeek-Harness-Setup-0.5.1-win-x64.exe')
    expect(workflow).toContain('154116788')
    expect(workflow).toContain('f4d661c6ff5fad93a50a6de2801da207efb54c021434c745b4c46c0982e57318')
    expect(workflow).toContain('-RuntimeEvidenceOnly')
    expect(workflow).toContain('desktop-startup-baseline-0.5.1.json')
    expect(workflow).toContain('desktop-package-installed-baseline-0.5.1.json')
    expect(workflow).toContain('desktop-package-setup-baseline-0.5.1.json')
    expect(workflow).toContain('-PackagePolicy windows-x64')
  })
})
