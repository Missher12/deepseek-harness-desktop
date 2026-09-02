param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,
  [Parameter(Mandatory = $true)]
  [string]$HarnessHome,
  [Parameter(Mandatory = $true)]
  [string]$UserData,
  [Parameter(Mandatory = $true)]
  [string]$DesktopShortcut,
  [Parameter(Mandatory = $true)]
  [string]$StartMenuShortcut,
  [Parameter(Mandatory = $true)]
  [string]$EvidenceRoot,
  [Parameter(Mandatory = $true)]
  [ValidateSet(100, 150)]
  [int]$DpiPercent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NativeVisualInput
{
    private const uint MouseLeftDown = 0x0002;
    private const uint MouseLeftUp = 0x0004;
    private const uint MouseRightDown = 0x0008;
    private const uint MouseRightUp = 0x0010;
    private const byte VirtualKeyEscape = 0x1B;
    private const byte VirtualKeyLeftWindows = 0x5B;
    private const byte VirtualKeyD = 0x44;
    private const uint KeyUp = 0x0002;

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr window);

    public static void RightClick(int x, int y)
    {
        SetCursorPos(x, y);
        mouse_event(MouseRightDown, 0, 0, 0, UIntPtr.Zero);
        mouse_event(MouseRightUp, 0, 0, 0, UIntPtr.Zero);
    }

    public static void LeftClick(int x, int y)
    {
        SetCursorPos(x, y);
        mouse_event(MouseLeftDown, 0, 0, 0, UIntPtr.Zero);
        mouse_event(MouseLeftUp, 0, 0, 0, UIntPtr.Zero);
    }

    public static void PressWindowsD()
    {
        keybd_event(VirtualKeyLeftWindows, 0, 0, UIntPtr.Zero);
        keybd_event(VirtualKeyD, 0, 0, UIntPtr.Zero);
        keybd_event(VirtualKeyD, 0, KeyUp, UIntPtr.Zero);
        keybd_event(VirtualKeyLeftWindows, 0, KeyUp, UIntPtr.Zero);
    }

    public static void PressWindows()
    {
        keybd_event(VirtualKeyLeftWindows, 0, 0, UIntPtr.Zero);
        keybd_event(VirtualKeyLeftWindows, 0, KeyUp, UIntPtr.Zero);
    }

    public static void PressEscape()
    {
        keybd_event(VirtualKeyEscape, 0, 0, UIntPtr.Zero);
        keybd_event(VirtualKeyEscape, 0, KeyUp, UIntPtr.Zero);
    }
}
'@

function Get-AutomationElement {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NamePattern,
    [System.Windows.Automation.ControlType]$ControlType
  )

  $elements = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($element in $elements) {
    try {
      $matchesType = $null -eq $ControlType -or $element.Current.ControlType -eq $ControlType
      if ($matchesType -and $element.Current.Name -match $NamePattern -and -not $element.Current.IsOffscreen) {
        return $element
      }
    }
    catch {
      # Shell surfaces can replace an element while UI Automation enumerates it.
    }
  }
  return $null
}

function Wait-AutomationElement {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NamePattern,
    [System.Windows.Automation.ControlType]$ControlType,
    [int]$TimeoutSeconds = 15
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $element = Get-AutomationElement -NamePattern $NamePattern -ControlType $ControlType
    if ($null -ne $element) {
      return $element
    }
    Start-Sleep -Milliseconds 200
  }
  throw "Timed out waiting for native Windows element: $NamePattern"
}

function Invoke-AutomationElement {
  param([Parameter(Mandatory = $true)]$Element)

  $pattern = $null
  if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
    return
  }
  if ($Element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$pattern)) {
    ([System.Windows.Automation.LegacyIAccessiblePattern]$pattern).DoDefaultAction()
    return
  }
  throw "Native Windows element cannot be invoked: $($Element.Current.Name)"
}

function Save-NativeScreenCapture {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $resolved = [System.IO.Path]::GetFullPath($Path)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolved) | Out-Null
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
    $bitmap.Save($resolved, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Get-DescendantProcessIds {
  param([Parameter(Mandatory = $true)][int]$RootProcessId)

  $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  $found = [System.Collections.Generic.List[int]]::new()
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $found.Add($RootProcessId)
  [void]$seen.Add($RootProcessId)
  for ($index = 0; $index -lt $found.Count; $index += 1) {
    foreach ($row in @($rows | Where-Object { $_.ParentProcessId -eq $found[$index] })) {
      $child = [int]$row.ProcessId
      if ($seen.Add($child)) {
        $found.Add($child)
      }
    }
  }
  return @($found)
}

function Wait-ProcessIdsStopped {
  param(
    [Parameter(Mandatory = $true)]
    [int[]]$ProcessIds,
    [int]$TimeoutSeconds = 30
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $remaining = @($ProcessIds | Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
  while ($remaining.Count -ne 0 -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $remaining = @($ProcessIds | Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
  }
  if ($remaining.Count -ne 0) {
    throw "Native visual smoke left $($remaining.Count) process(es) running."
  }
}

function Wait-NativeVisualTrayEvidence {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$OverflowOpenedAt,
    [Parameter(Mandatory = $true)]
    [int]$ExpectedIconSize,
    [int]$TimeoutSeconds = 15
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $virtualScreen = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $expectedProperties = @('bounds', 'clickPoint', 'iconSize', 'observedAt', 'schemaVersion')
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      try {
        $evidence = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        $properties = @($evidence.PSObject.Properties.Name | Sort-Object)
        if (@(Compare-Object $expectedProperties $properties).Count -ne 0) {
          throw 'Native tray evidence contains unexpected fields.'
        }
        $evidenceObservedAt = [DateTimeOffset]($evidence.observedAt)
        if ($evidenceObservedAt -le $OverflowOpenedAt) {
          Start-Sleep -Milliseconds 100
          continue
        }
        if ([int]($evidence.schemaVersion) -ne 1 -or [int]($evidence.iconSize) -ne $ExpectedIconSize) {
          throw 'Native tray evidence has the wrong schema or icon size.'
        }
        $boundsWidth = [double]($evidence.bounds.width)
        $boundsHeight = [double]($evidence.bounds.height)
        if ($boundsWidth -le 0 -or $boundsHeight -le 0) {
          throw 'Native tray evidence has no positive shell bounds.'
        }
        $clickX = [int][Math]::Round([double]($evidence.clickPoint.x))
        $clickY = [int][Math]::Round([double]($evidence.clickPoint.y))
        if (
          $clickX -lt $virtualScreen.Left
          -or $clickX -ge $virtualScreen.Right
          -or $clickY -lt $virtualScreen.Top
          -or $clickY -ge $virtualScreen.Bottom
        ) {
          throw 'Native tray evidence click point is outside the virtual screen.'
        }
        return [pscustomobject]@{
          clickX = $clickX
          clickY = $clickY
        }
      }
      catch {
        # Atomic evidence can be replaced between discovery and parsing; wait for the next sample.
      }
    }
    Start-Sleep -Milliseconds 100
  }
  throw 'Timed out waiting for fresh bounded native tray evidence.'
}

function Open-DeepSeekHarnessTrayMenu {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TrayEvidencePath,
    [Parameter(Mandatory = $true)]
    [int]$ExpectedIconSize,
    [Parameter(Mandatory = $true)]
    [string]$EvidenceRoot,
    [Parameter(Mandatory = $true)]
    [int]$DpiPercent
  )

  $hiddenIcons = Wait-AutomationElement `
    -NamePattern '^(?:Show hidden icons|显示隐藏的图标)$' `
    -ControlType ([System.Windows.Automation.ControlType]::Button)
  $hiddenBounds = $hiddenIcons.Current.BoundingRectangle
  if ($hiddenBounds.Width -le 0 -or $hiddenBounds.Height -le 0) {
    throw 'Show hidden icons has no visible Windows bounds.'
  }
  [NativeVisualInput]::LeftClick(
    [int][Math]::Round($hiddenBounds.Left + ($hiddenBounds.Width / 2)),
    [int][Math]::Round($hiddenBounds.Top + ($hiddenBounds.Height / 2))
  )
  $overflowOpenedAt = [DateTimeOffset]::UtcNow
  $trayEvidence = Wait-NativeVisualTrayEvidence `
    -Path $TrayEvidencePath `
    -OverflowOpenedAt $overflowOpenedAt `
    -ExpectedIconSize $ExpectedIconSize
  Save-NativeScreenCapture -Path (Join-Path $EvidenceRoot "tray-overflow-$DpiPercent.png")
  [NativeVisualInput]::RightClick(
    [int]($trayEvidence.clickX),
    [int]($trayEvidence.clickY)
  )

  [void](Wait-AutomationElement `
    -NamePattern '^Show DeepSeek Harness$' `
    -ControlType ([System.Windows.Automation.ControlType]::MenuItem))
  return Wait-AutomationElement `
    -NamePattern '^Quit$' `
    -ControlType ([System.Windows.Automation.ControlType]::MenuItem)
}

function Assert-ShortcutVisible {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ShortcutPath
  )

  if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) {
    throw "Native visual smoke is missing a shortcut: $ShortcutPath"
  }
  [void](Wait-AutomationElement -NamePattern '^DeepSeek Harness(?:\s|$)' -TimeoutSeconds 10)
}

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$resolvedEvidenceRoot = [System.IO.Path]::GetFullPath($EvidenceRoot)
$scaleFactor = $DpiPercent / 100.0
$preferencesPath = Join-Path $UserData 'desktop-preferences.json'
$lifecyclePath = Join-Path $UserData 'logs\lifecycle.log'
$trayEvidencePath = Join-Path $UserData 'native-visual-tray.json'
$process = $null
$trackedProcessIds = @()
$nativeDpi = 0

try {
  New-Item -ItemType Directory -Force -Path $HarnessHome, $UserData, $resolvedEvidenceRoot | Out-Null
  [System.IO.File]::WriteAllText(
    $preferencesPath,
    "{`"closeBehavior`":`"keep-running`",`"tieredPricingEstimates`":true}`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  if (Test-Path -LiteralPath $lifecyclePath) {
    Remove-Item -LiteralPath $lifecyclePath -Force
  }
  if (Test-Path -LiteralPath $trayEvidencePath) {
    Remove-Item -LiteralPath $trayEvidencePath -Force
  }

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new($resolvedExecutable)
  $startInfo.UseShellExecute = $false
  $startInfo.WorkingDirectory = Split-Path -Parent $resolvedExecutable
  $startInfo.ArgumentList.Add("--user-data-dir=$UserData")
  $startInfo.ArgumentList.Add("--force-device-scale-factor=$scaleFactor")
  $startInfo.Environment['DSH_HOME'] = $HarnessHome
  $startInfo.Environment['DSH_TELEMETRY_DISABLED'] = '1'
  $startInfo.Environment['DSH_DESKTOP_NATIVE_VISUAL_EVIDENCE'] = '1'
  $startInfo.Environment['DEEPSEEK_API_KEY'] = ''
  $process = [System.Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) {
    throw "Windows did not start the $DpiPercent percent native visual sample."
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  $running = $false
  while (-not $running -and [DateTime]::UtcNow -lt $deadline) {
    if ($process.HasExited) {
      throw "The $DpiPercent percent native visual sample exited before desktop-running."
    }
    $process.Refresh()
    if (Test-Path -LiteralPath $lifecyclePath -PathType Leaf) {
      $running = [bool](Select-String -LiteralPath $lifecyclePath -Quiet -Pattern ' startup desktop-running: [0-9]+ms$')
    }
    if (-not $running -or $process.MainWindowHandle -eq [IntPtr]::Zero) {
      $running = $false
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $running) {
    throw "The $DpiPercent percent native visual sample missed its startup deadline."
  }

  $trackedProcessIds = @(Get-DescendantProcessIds -RootProcessId $process.Id)
  $nativeDpi = [NativeVisualInput]::GetDpiForWindow($process.MainWindowHandle)
  [void][NativeVisualInput]::SetForegroundWindow($process.MainWindowHandle)
  Start-Sleep -Seconds 1
  Save-NativeScreenCapture -Path (Join-Path $resolvedEvidenceRoot "taskbar-running-$DpiPercent.png")

  [NativeVisualInput]::PressWindowsD()
  Start-Sleep -Milliseconds 750
  Assert-ShortcutVisible -ShortcutPath $DesktopShortcut
  Save-NativeScreenCapture -Path (Join-Path $resolvedEvidenceRoot "desktop-shortcut-$DpiPercent.png")
  [NativeVisualInput]::PressWindowsD()
  Start-Sleep -Milliseconds 500

  [NativeVisualInput]::PressWindows()
  Start-Sleep -Milliseconds 500
  [System.Windows.Forms.SendKeys]::SendWait('DeepSeek Harness')
  [void](Wait-AutomationElement -NamePattern '^DeepSeek Harness(?:\s|$)' -TimeoutSeconds 10)
  Save-NativeScreenCapture -Path (Join-Path $resolvedEvidenceRoot "start-menu-shortcut-$DpiPercent.png")
  [NativeVisualInput]::PressEscape()
  Start-Sleep -Milliseconds 300

  $process.Refresh()
  if (-not $process.CloseMainWindow()) {
    throw "The $DpiPercent percent native visual sample did not expose a closable window."
  }
  Start-Sleep -Seconds 1
  if ($process.HasExited) {
    throw 'CloseMainWindow exited instead of preserving the keep-running tray process.'
  }
  $expectedIconSize = if ($DpiPercent -eq 100) { 16 } else { 24 }
  $quitMenuItem = Open-DeepSeekHarnessTrayMenu `
    -TrayEvidencePath $trayEvidencePath `
    -ExpectedIconSize $expectedIconSize `
    -EvidenceRoot $resolvedEvidenceRoot `
    -DpiPercent $DpiPercent
  Save-NativeScreenCapture -Path (Join-Path $resolvedEvidenceRoot "tray-menu-$DpiPercent.png")
  Invoke-AutomationElement -Element $quitMenuItem
  if (-not $process.WaitForExit(60000)) {
    throw "The $DpiPercent percent native visual sample did not exit from its tray menu."
  }
  Wait-ProcessIdsStopped -ProcessIds $trackedProcessIds

  $evidence = [ordered]@{
    schemaVersion = 1
    requestedPercent = $DpiPercent
    scaleMode = 'electron-force-device-scale-factor'
    nativeWindowDpi = $nativeDpi
    processTreeCount = $trackedProcessIds.Count
    shortcuts = @(
      [System.IO.Path]::GetFileName($DesktopShortcut),
      [System.IO.Path]::GetFileName($StartMenuShortcut)
    )
    captures = @(
      "taskbar-running-$DpiPercent.png",
      "desktop-shortcut-$DpiPercent.png",
      "start-menu-shortcut-$DpiPercent.png",
      "tray-overflow-$DpiPercent.png",
      "tray-menu-$DpiPercent.png"
    )
  }
  [System.IO.File]::WriteAllText(
    (Join-Path $resolvedEvidenceRoot "native-visual-$DpiPercent.json"),
    (($evidence | ConvertTo-Json -Depth 5) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
}
catch {
  try {
    Save-NativeScreenCapture -Path (Join-Path $resolvedEvidenceRoot "native-visual-failure-$DpiPercent.png")
  }
  catch {
    # Failure evidence is best effort and must not replace the original exception.
  }
  throw
}
finally {
  [NativeVisualInput]::PressEscape()
  if ($null -ne $process) {
    $fallbackIds = if ($trackedProcessIds.Count -eq 0) {
      if ($process.HasExited) { @() } else { @(Get-DescendantProcessIds -RootProcessId $process.Id) }
    }
    else {
      $trackedProcessIds
    }
    foreach ($processId in @($fallbackIds | Sort-Object -Descending)) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
  if ($null -ne $process) {
    $process.Dispose()
  }
}
