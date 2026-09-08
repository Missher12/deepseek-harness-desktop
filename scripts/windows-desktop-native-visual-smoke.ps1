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
using System.Collections.Generic;
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

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    public static uint WindowProcessId(IntPtr window)
    {
        uint processId;
        return GetWindowThreadProcessId(window, out processId) == 0 ? 0 : processId;
    }

    private delegate bool EnumCallback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumCallback callback, IntPtr data);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr window, uint command);

    public static IntPtr[] VisibleRoots(uint processId)
    {
        var windows = new List<IntPtr>();
        if (!EnumWindows((window, data) => {
            Rect bounds;
            if (WindowProcessId(window) == processId && IsWindowVisible(window) &&
                GetWindow(window, 4) == IntPtr.Zero && GetWindowRect(window, out bounds) &&
                bounds.Right > bounds.Left && bounds.Bottom > bounds.Top) windows.Add(window);
            return true;
        }, IntPtr.Zero)) throw new InvalidOperationException("Window enumeration failed.");
        return windows.ToArray();
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }

    public sealed class WindowGeometry
    {
        public Rect WindowRect, VisibleFrame, WorkArea, VirtualScreen;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);

    [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW", SetLastError = true)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr window, uint attribute, out Rect rect, int size);

    public static WindowGeometry ReadWindowGeometry(IntPtr window)
    {
        var previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (previous == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        try
        {
            var geometry = new WindowGeometry();
            if (!GetWindowRect(window, out geometry.WindowRect))
                throw new System.ComponentModel.Win32Exception();
            int result = DwmGetWindowAttribute(window, 9, out geometry.VisibleFrame, Marshal.SizeOf(typeof(Rect)));
            Marshal.ThrowExceptionForHR(result);
            var monitor = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
            if (!GetMonitorInfo(MonitorFromWindow(window, 2), ref monitor))
                throw new System.ComponentModel.Win32Exception();
            geometry.WorkArea = monitor.Work;
            int left = GetSystemMetrics(76), top = GetSystemMetrics(77);
            geometry.VirtualScreen = new Rect {
                Left = left, Top = top, Right = left + GetSystemMetrics(78), Bottom = top + GetSystemMetrics(79)
            };
            return geometry;
        }
        finally { SetThreadDpiAwarenessContext(previous); }
    }

    public static bool Contains(Rect outer, Rect inner)
    {
        return inner.Right > inner.Left && inner.Bottom > inner.Top
            && inner.Left >= outer.Left && inner.Top >= outer.Top
            && inner.Right <= outer.Right && inner.Bottom <= outer.Bottom;
    }

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

    public static void PressEnter()
    {
        keybd_event(0x0D, 0, 0, UIntPtr.Zero);
        keybd_event(0x0D, 0, KeyUp, UIntPtr.Zero);
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

function Test-SearchProcessName {
  param([string]$ProcessName)
  return $ProcessName -in @('SearchHost', 'SearchApp', 'SearchUI', 'StartMenuExperienceHost')
}

function Test-SearchQueryObservation {
  param(
    [string]$ProcessName,
    [string]$ObservedQuery,
    [int]$QueryCount,
    [bool]$ForegroundUnchanged,
    [bool]$WindowProcessMatches
  )

  return (
    (Test-SearchProcessName $ProcessName) -and
    $ObservedQuery -ceq 'DeepSeek Harness' -and
    $QueryCount -eq 1 -and
    $WindowProcessMatches -and
    $ForegroundUnchanged
  )
}

function Get-VerifiedSearchQuery {
  $foreground = [NativeVisualInput]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero) { return $null }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($foreground)
  $searchProcess = Get-Process -Id $root.Current.ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $searchProcess -or -not (Test-SearchProcessName $searchProcess.ProcessName) -or
    $root.Current.IsOffscreen -or -not $root.Current.IsEnabled) { return $null }
  $elements = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )
  )
  $queryCount = 0
  $observedQuery = ''
  foreach ($element in $elements) {
    if ($element.Current.IsOffscreen -or -not $element.Current.IsEnabled) { continue }
    $bounds = $element.Current.BoundingRectangle
    $value = $null
    if (
      $bounds.Width -gt 0 -and $bounds.Height -gt 0 -and $root.Current.BoundingRectangle.Contains($bounds) -and
      $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value) -and
      $value.Current.Value -ceq 'DeepSeek Harness'
    ) {
      $observedQuery = $value.Current.Value
      $queryCount += 1
    }
  }
  if (Test-SearchQueryObservation `
    -ProcessName $searchProcess.ProcessName -ObservedQuery $observedQuery -QueryCount $queryCount `
    -WindowProcessMatches ([NativeVisualInput]::WindowProcessId($foreground) -eq $searchProcess.Id) `
    -ForegroundUnchanged ([NativeVisualInput]::GetForegroundWindow() -eq $foreground)) {
    return $foreground
  }
  return $null
}

function Wait-SearchQuery {
  param([int]$TimeoutSeconds = 15)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $foreground = Get-VerifiedSearchQuery
      if ($null -ne $foreground) { return $foreground }
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
      # Search replaces its accessibility tree while accepting the query.
    }
    Start-Sleep -Milliseconds 200
  }
  throw 'Windows Search did not expose the complete query in its foreground window.'
}

function Test-SearchLaunchObservation {
  param(
    [string]$ObservedExecutable, [string]$ExpectedExecutable, [bool]$SeenBefore,
    [datetime]$CreatedAt, [datetime]$EnteredAt, [int]$ProcessId,
    [int]$WindowProcessId, [int]$ForegroundProcessId, [bool]$DesktopRunning
  )
  return (
    -not [string]::IsNullOrEmpty($ObservedExecutable) -and
    [StringComparer]::OrdinalIgnoreCase.Equals([System.IO.Path]::GetFullPath($ObservedExecutable), $ExpectedExecutable) -and
    -not $SeenBefore -and $CreatedAt -ge $EnteredAt -and $ProcessId -gt 0 -and
    $WindowProcessId -eq $ProcessId -and $ForegroundProcessId -eq $ProcessId -and $DesktopRunning
  )
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
          ($clickX -lt $virtualScreen.Left) -or
          ($clickX -ge $virtualScreen.Right) -or
          ($clickY -lt $virtualScreen.Top) -or
          ($clickY -ge $virtualScreen.Bottom)
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

  $maxTrayMenuAttempts = 3
  for ($attempt = 1; $attempt -le $maxTrayMenuAttempts; $attempt += 1) {
    try {
      [NativeVisualInput]::PressEscape()
      Start-Sleep -Milliseconds 250
      $hiddenIcons = Wait-AutomationElement `
        -NamePattern '^(?:Show hidden icons|显示隐藏的图标)$' `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -TimeoutSeconds 10
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
        -ControlType ([System.Windows.Automation.ControlType]::MenuItem) `
        -TimeoutSeconds 5)
      return Wait-AutomationElement `
        -NamePattern '^Quit$' `
        -ControlType ([System.Windows.Automation.ControlType]::MenuItem) `
        -TimeoutSeconds 5
    }
    catch {
      [NativeVisualInput]::PressEscape()
      if ($attempt -eq $maxTrayMenuAttempts) {
        throw 'Windows did not expose the DeepSeek Harness tray menu after 3 attempts.'
      }
    }
  }
}

function Invoke-SearchApplicationLaunch {
  param([string]$ExpectedExecutable, [string]$EvidenceRoot)

  if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Search launch requires a disposable hosted Windows runner.'
  }
  # Search inherits Explorer's environment, not this script's isolated DPI profile.
  $defaultHome = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh'
  $defaultUserData = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'DeepSeek Harness'
  foreach ($variable in @('DSH_HOME', 'DSH_DESKTOP_USER_DATA_DIR')) {
    foreach ($scope in @('User', 'Machine')) {
      if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($variable, $scope))) {
        throw 'Search launch refuses a shell-level profile override.'
      }
    }
  }
  if ((Test-Path -LiteralPath $defaultHome) -or (Test-Path -LiteralPath $defaultUserData)) {
    throw 'Search launch requires initially absent disposable default profiles.'
  }
  $lifecycle = Join-Path $defaultUserData 'logs\lifecycle.log'
  $owned = @{}
  $beforeIds = @{}
  $enteredAt = $null
  $targetProcess = $null
  $report = [ordered]@{
    launchMethod = 'verified-search-enter'
    profileMode = 'fresh-disposable-runner-defaults'
    exactQuery = $false; foregroundStableBeforeEnter = $false; enterSent = $false
    freshProcess = $false; executablePathMatches = $false; windowProcessMatches = $false
    desktopRunning = $false; ownedProcessesObserved = 0; ownedProcessesRemaining = $null
    cleanupMethod = 'owned-tree-cleanup-not-tray-acceptance'
    capture = 'start-menu-launch-100.png'
  }

  function Get-SearchProcessSnapshot {
    return @(Get-CimInstance Win32_Process -Property Name, ProcessId, ParentProcessId, CreationDate, ExecutablePath)
  }
  function Test-SearchExecutable($Row) {
    return (-not [string]::IsNullOrEmpty($Row.ExecutablePath) -and
      [StringComparer]::OrdinalIgnoreCase.Equals([System.IO.Path]::GetFullPath([string]$Row.ExecutablePath), $ExpectedExecutable))
  }
  function Get-SearchCreationTicks($Row) { return ([datetime]$Row.CreationDate).ToUniversalTime().Ticks }
  function Update-SearchOwnedProcesses($Rows) {
    if ($null -eq $enteredAt) { return }
    foreach ($row in $Rows) {
      $key = [int]$row.ProcessId
      if ((Test-SearchExecutable $row) -and -not $beforeIds.ContainsKey($key) -and (Get-SearchCreationTicks $row) -ge $enteredAt.Ticks) {
        $owned[$key] = Get-SearchCreationTicks $row
      }
    }
    do {
      $added = $false
      $liveParents = @{}
      foreach ($row in $Rows) {
        $key = [int]$row.ProcessId
        if ($owned.ContainsKey($key) -and $owned[$key] -eq (Get-SearchCreationTicks $row)) { $liveParents[$key] = $owned[$key] }
      }
      foreach ($row in $Rows) {
        $key = [int]$row.ProcessId
        $parentKey = [int]$row.ParentProcessId
        if (-not $owned.ContainsKey($key) -and -not $beforeIds.ContainsKey($key) -and
          $liveParents.ContainsKey($parentKey) -and (Get-SearchCreationTicks $row) -ge $liveParents[$parentKey]) {
          $owned[$key] = Get-SearchCreationTicks $row
          $added = $true
        }
      }
    } while ($added)
  }
  function Get-LiveSearchOwnedProcesses($Rows) {
    return @($Rows | Where-Object {
      $key = [int]$_.ProcessId
      $owned.ContainsKey($key) -and $owned[$key] -eq (Get-SearchCreationTicks $_)
    })
  }

  try {
    [NativeVisualInput]::PressWindows()
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait('DeepSeek Harness')
    $searchWindow = Wait-SearchQuery
    Save-NativeScreenCapture -Path (Join-Path $EvidenceRoot 'start-menu-shortcut-100.png')
    $before = Get-SearchProcessSnapshot
    if (@($before | Where-Object { $_.Name -ieq 'DeepSeek Harness.exe' }).Count -ne 0) {
      throw 'Search launch cannot reuse an already-running application.'
    }
    foreach ($row in $before) { $beforeIds[[int]$row.ProcessId] = $true }
    $confirmed = Get-VerifiedSearchQuery
    if ($null -eq $confirmed -or $confirmed -ne $searchWindow) {
      throw 'Search foreground or query changed after capture.'
    }
    $report.exactQuery = $true
    $report.foregroundStableBeforeEnter = $true
    $enteredAt = [DateTime]::UtcNow
    $report.enterAtUtc = $enteredAt.ToString('o')
    [NativeVisualInput]::PressEnter()
    $report.enterSent = $true
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $mainWindow = [IntPtr]::Zero
    while ([DateTime]::UtcNow -lt $deadline) {
      $snapshot = Get-SearchProcessSnapshot
      Update-SearchOwnedProcesses $snapshot
      $mainWindow = [IntPtr]::Zero
      $running = $false
      if (Test-Path -LiteralPath $lifecycle -PathType Leaf) {
        $running = [bool](@(Get-Content -LiteralPath $lifecycle -Tail 100 | Where-Object { $_ -match ' startup desktop-running: [0-9]+ms$' }).Count)
      }
      foreach ($row in @(Get-LiveSearchOwnedProcesses $snapshot | Where-Object { Test-SearchExecutable $_ })) {
        foreach ($window in [NativeVisualInput]::VisibleRoots([uint32]$row.ProcessId)) {
          if (Test-SearchLaunchObservation `
            -ObservedExecutable $row.ExecutablePath -ExpectedExecutable $ExpectedExecutable `
            -SeenBefore ($beforeIds.ContainsKey([int]$row.ProcessId)) `
            -CreatedAt (([datetime]$row.CreationDate).ToUniversalTime()) -EnteredAt $enteredAt `
            -ProcessId ([int]$row.ProcessId) -WindowProcessId ([NativeVisualInput]::WindowProcessId($window)) `
            -ForegroundProcessId ([NativeVisualInput]::WindowProcessId([NativeVisualInput]::GetForegroundWindow())) `
            -DesktopRunning $running) {
            $mainWindow = $window
            $targetProcess = $row
            break
          }
        }
        if ($mainWindow -ne [IntPtr]::Zero) { break }
      }
      if ($mainWindow -ne [IntPtr]::Zero) { break }
      Start-Sleep -Milliseconds 300
    }
    if ($mainWindow -eq [IntPtr]::Zero) { throw 'Search Enter did not launch a fresh exact-image desktop window before the deadline.' }
    $current = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$targetProcess.ProcessId)
    if ($null -eq $current -or -not (Test-SearchExecutable $current) -or
      (Get-SearchCreationTicks $current) -ne (Get-SearchCreationTicks $targetProcess) -or
      [NativeVisualInput]::WindowProcessId($mainWindow) -ne $current.ProcessId -or
      [NativeVisualInput]::WindowProcessId([NativeVisualInput]::GetForegroundWindow()) -ne $current.ProcessId) {
      throw 'The Search-launched process or foreground changed before capture.'
    }
    Save-NativeScreenCapture -Path (Join-Path $EvidenceRoot $report.capture)
    $report.targetPid = [int]$current.ProcessId
    $report.targetCreatedAtUtc = ([datetime]$current.CreationDate).ToUniversalTime().ToString('o')
    $report.freshProcess = $true
    $report.executablePathMatches = $true
    $report.windowProcessMatches = $true
    $report.desktopRunning = $true
  }
  finally {
    # The DPI sample has already passed real Tray Quit; this only owns the separate Search launch.
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    do {
      $snapshot = Get-SearchProcessSnapshot
      Update-SearchOwnedProcesses $snapshot
      $remaining = @(Get-LiveSearchOwnedProcesses $snapshot)
      if ($remaining.Count -eq 0) { break }
      foreach ($row in $remaining) {
        $current = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$row.ProcessId) -Property ProcessId, CreationDate
        if ($null -eq $current -or (Get-SearchCreationTicks $current) -ne $owned[[int]$row.ProcessId]) { continue }
        $killInfo = [System.Diagnostics.ProcessStartInfo]::new('taskkill.exe')
        $killInfo.UseShellExecute = $false
        $killInfo.CreateNoWindow = $true
        $killInfo.RedirectStandardOutput = $true
        $killInfo.RedirectStandardError = $true
        $killInfo.Arguments = '/PID ' + [int]$row.ProcessId + ' /T /F'
        $termination = [System.Diagnostics.Process]::Start($killInfo)
        try {
          $stdout = $termination.StandardOutput.ReadToEndAsync()
          $stderr = $termination.StandardError.ReadToEndAsync()
          if (-not $termination.WaitForExit(10000)) { $termination.Kill($true); throw 'Search process cleanup timed out.' }
          [void]$stdout.GetAwaiter().GetResult()
          [void]$stderr.GetAwaiter().GetResult()
        }
        finally { $termination.Dispose() }
      }
      Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    $report.ownedProcessesObserved = $owned.Count
    $report.ownedProcessesRemaining = @(Get-LiveSearchOwnedProcesses (Get-SearchProcessSnapshot)).Count
    if ($report.ownedProcessesRemaining -ne 0) { throw 'Search-launched processes remain after cleanup.' }
    [NativeVisualInput]::PressEscape()
  }
  return $report
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
$searchLaunch = $null

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
  $windowGeometry = [NativeVisualInput]::ReadWindowGeometry($process.MainWindowHandle)
  Save-NativeScreenCapture -Path (Join-Path $resolvedEvidenceRoot "taskbar-running-$DpiPercent.png")
  if (
    -not [NativeVisualInput]::Contains($windowGeometry.WorkArea, $windowGeometry.VisibleFrame) -or
    -not [NativeVisualInput]::Contains($windowGeometry.VirtualScreen, $windowGeometry.VisibleFrame)
  ) {
    throw "Native window is outside the physical work area: $($windowGeometry | ConvertTo-Json -Depth 3 -Compress)"
  }

  [NativeVisualInput]::PressWindowsD()
  Start-Sleep -Milliseconds 750
  Assert-ShortcutVisible -ShortcutPath $DesktopShortcut
  Save-NativeScreenCapture -Path (Join-Path $resolvedEvidenceRoot "desktop-shortcut-$DpiPercent.png")
  [NativeVisualInput]::PressWindowsD()
  Start-Sleep -Milliseconds 500

  [NativeVisualInput]::PressWindows()
  Start-Sleep -Milliseconds 500
  [System.Windows.Forms.SendKeys]::SendWait('DeepSeek Harness')
  [void](Wait-SearchQuery)
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
  $process.Dispose()
  $process = $null

  if ($DpiPercent -eq 100) {
    $searchLaunch = Invoke-SearchApplicationLaunch -ExpectedExecutable $resolvedExecutable -EvidenceRoot $resolvedEvidenceRoot
  }

  $evidence = [ordered]@{
    schemaVersion = 1
    requestedPercent = $DpiPercent
    scaleMode = 'electron-force-device-scale-factor'
    nativeWindowDpi = $nativeDpi
    windowGeometryPhysicalPixels = $windowGeometry
    processTreeCount = $trackedProcessIds.Count
    searchLaunch = $searchLaunch
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
