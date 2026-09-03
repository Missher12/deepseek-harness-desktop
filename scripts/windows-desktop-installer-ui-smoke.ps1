param(
  [Parameter(Mandatory = $true)]
  [string]$SetupPath,
  [string]$EvidenceRoot = 'apps/desktop/release/windows-installer-ui-evidence'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeInstallerWindow
{
    private delegate bool EnumChildProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(
        IntPtr parent,
        EnumChildProc callback,
        IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(
        IntPtr window,
        StringBuilder className,
        int maximumCount);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect rectangle);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    public static bool HasVisibleChildClass(IntPtr parent, string expectedClass)
    {
        var found = false;
        EnumChildWindows(parent, (window, parameter) =>
        {
            var className = new StringBuilder(256);
            Rect rectangle;
            if (GetClassName(window, className, className.Capacity) > 0 &&
                String.Equals(className.ToString(), expectedClass, StringComparison.Ordinal) &&
                IsWindowVisible(window) &&
                GetWindowRect(window, out rectangle) &&
                rectangle.Right > rectangle.Left &&
                rectangle.Bottom > rectangle.Top)
            {
                found = true;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@

$script:InstallerProcessId = 0

function Get-InstallerWindow {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($window in $windows) {
    try {
      $matchesProcess = $script:InstallerProcessId -gt 0 -and `
        $window.Current.ProcessId -eq $script:InstallerProcessId
      $matchesProductName = $window.Current.Name -match '^DeepSeek Harness(?: Setup)?$'
      if ($matchesProcess -or $matchesProductName) {
        return $window
      }
    }
    catch {
      # A top-level window can disappear while UI Automation enumerates it.
    }
  }
  return $null
}

function Get-AutomationText {
  param([Parameter(Mandatory = $true)]$Element)

  $names = foreach ($child in $Element.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )) {
    try {
      if (-not [string]::IsNullOrWhiteSpace($child.Current.Name)) {
        $child.Current.Name
      }
    }
    catch {
      # Ignore controls replaced during a page transition.
    }
  }
  return (@($names | Select-Object -Unique) -join "`n")
}

function Wait-InstallerPage {
  param(
    [Parameter(Mandatory = $true)][string]$Pattern,
    [int]$TimeoutSeconds = 45
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastText = '[installer window not found]'
  while ([DateTime]::UtcNow -lt $deadline) {
    $window = Get-InstallerWindow
    if ($null -ne $window) {
      $lastText = Get-AutomationText -Element $window
      if ($lastText -match $Pattern) {
        return $window
      }
    }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out waiting for installer page '$Pattern'. Last UI text: $lastText"
}

function Find-Control {
  param(
    [Parameter(Mandatory = $true)]$Element,
    [Parameter(Mandatory = $true)]$ControlType,
    [string]$NamePattern = '.*'
  )

  foreach ($control in $Element.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )) {
    try {
      if ($control.Current.ControlType -eq $ControlType -and $control.Current.Name -match $NamePattern) {
        return $control
      }
    }
    catch {
      # Ignore controls replaced during a page transition.
    }
  }
  return $null
}

function Save-RedactedInstallerScreenshot {
  param(
    [Parameter(Mandatory = $true)]$Window,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $bounds = $Window.Current.BoundingRectangle
  $width = [int][Math]::Ceiling($bounds.Width)
  $height = [int][Math]::Ceiling($bounds.Height)
  if ($width -le 0 -or $height -le 0) {
    throw 'Installer window has no visible bounds for its screenshot.'
  }
  $resolved = [System.IO.Path]::GetFullPath($Path)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolved) | Out-Null
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 224, 228, 235))
  try {
    $graphics.CopyFromScreen(
      [int][Math]::Floor($bounds.Left),
      [int][Math]::Floor($bounds.Top),
      0,
      0,
      [System.Drawing.Size]::new($width, $height)
    )
    $sensitiveTypes = @(
      [System.Windows.Automation.ControlType]::Edit,
      [System.Windows.Automation.ControlType]::List
    )
    foreach ($control in $Window.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )) {
      try {
        if ($sensitiveTypes -notcontains $control.Current.ControlType) {
          continue
        }
        $redact = $control.Current.BoundingRectangle
        $left = [int][Math]::Max(0, [Math]::Floor($redact.Left - $bounds.Left))
        $top = [int][Math]::Max(0, [Math]::Floor($redact.Top - $bounds.Top))
        $right = [int][Math]::Min($width, [Math]::Ceiling($redact.Right - $bounds.Left))
        $bottom = [int][Math]::Min($height, [Math]::Ceiling($redact.Bottom - $bounds.Top))
        if ($right -gt $left -and $bottom -gt $top) {
          $graphics.FillRectangle($brush, $left, $top, $right - $left, $bottom - $top)
        }
      }
      catch {
        # A transient installer control can disappear after the screen pixels were captured.
      }
    }
    $bitmap.Save($resolved, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $brush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Invoke-InstallerButton {
  param(
    [Parameter(Mandatory = $true)]$Window,
    [Parameter(Mandatory = $true)][string]$NamePattern
  )

  $button = Find-Control -Element $Window `
    -ControlType ([System.Windows.Automation.ControlType]::Button) `
    -NamePattern $NamePattern
  if ($null -eq $button) {
    throw "Installer button not found: $NamePattern"
  }
  $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
}

function Wait-InstallerToggleOff {
  param([int]$TimeoutSeconds = 10)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $toggleRequested = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    $window = Get-InstallerWindow
    if ($null -eq $window) {
      throw 'Installer window disappeared before the Run option was disabled.'
    }
    $text = Get-AutomationText -Element $window
    if ($text -notmatch 'Completing DeepSeek Harness Setup') {
      throw 'Installer left the Finish page before the Run option was disabled.'
    }
    $checkbox = Find-Control -Element $window `
      -ControlType ([System.Windows.Automation.ControlType]::CheckBox) `
      -NamePattern 'Run DeepSeek Harness'
    if ($null -eq $checkbox) {
      throw 'The finish page did not expose the Run DeepSeek Harness option.'
    }
    $toggle = $checkbox.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) {
      return
    }
    if (-not $toggleRequested) {
      $toggle.Toggle()
      $toggleRequested = $true
    }
    Start-Sleep -Milliseconds 100
  }
  throw 'The Run DeepSeek Harness option did not settle to Off.'
}

function Complete-InstallerFinish {
  param(
    [Parameter(Mandatory = $true)]
    [System.Diagnostics.Process]$Setup,
    [int]$TimeoutSeconds = 90
  )

  # UI Automation Invoke is asynchronous. Resolve the page and button again
  # after the checkbox transition, invoke once, then wait on observable state
  # instead of assuming the process must exit inside one fixed 30-second call.
  $window = Wait-InstallerPage -Pattern 'Completing DeepSeek Harness Setup' -TimeoutSeconds 10
  $button = Find-Control -Element $window `
    -ControlType ([System.Windows.Automation.ControlType]::Button) `
    -NamePattern '^Finish$'
  if ($null -eq $button -or -not $button.Current.IsEnabled) {
    throw 'The Finish button was not enabled after the Run option settled.'
  }
  $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastState = 'finish-page-visible'
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($Setup.HasExited) {
      if ($Setup.ExitCode -ne 0) {
        throw "Setup exited with code $($Setup.ExitCode) after the Finish button was invoked."
      }
      return
    }
    $currentWindow = Get-InstallerWindow
    if ($null -eq $currentWindow) {
      $lastState = 'window-dismissed'
    }
    else {
      $currentText = Get-AutomationText -Element $currentWindow
      $lastState = if ($currentText -match 'Completing DeepSeek Harness Setup') {
        'finish-page-visible'
      }
      else {
        'unexpected-window'
      }
    }
    Start-Sleep -Milliseconds 100
  }

  if ($lastState -eq 'finish-page-visible') {
    throw 'Finish page remained visible after the Finish button was invoked.'
  }
  if ($lastState -eq 'window-dismissed') {
    throw 'Finish page closed but Setup did not exit.'
  }
  throw 'Setup did not exit and an unexpected installer window remained visible.'
}

function Invoke-IsolatedUninstall {
  param(
    [Parameter(Mandatory = $true)][string]$InstalledUninstaller,
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$LauncherPath
  )

  Copy-Item -LiteralPath $InstalledUninstaller -Destination $LauncherPath -Force
  $uninstall = Start-Process -FilePath $LauncherPath -ArgumentList @('/S', "_?=$InstallRoot") -PassThru
  $processIds = @()
  try {
    Start-Sleep -Milliseconds 100
    $processIds = @(Get-DescendantProcessIds -RootProcessId $uninstall.Id)
    if (-not $uninstall.WaitForExit(90000)) {
      throw 'Uninstaller did not exit within 90 seconds.'
    }
    if ($uninstall.ExitCode -ne 0) {
      throw "Uninstaller failed with exit code $($uninstall.ExitCode)."
    }
    Wait-ProcessIdsStopped -ProcessIds $processIds
  }
  finally {
    foreach ($processId in @($processIds | Sort-Object -Descending)) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    if ($processIds.Count -ne 0) { Wait-ProcessIdsStopped -ProcessIds $processIds }
    $uninstall.Dispose()
  }
}

function Wait-PathRemoved {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)

  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  while ((Test-Path -LiteralPath $LiteralPath) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 200
  }
  if (Test-Path -LiteralPath $LiteralPath) {
    throw "Timed out waiting for uninstall cleanup: $LiteralPath"
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
      if ($seen.Add($child)) { $found.Add($child) }
    }
  }
  return @($found)
}

function Wait-ProcessIdsStopped {
  param(
    [Parameter(Mandatory = $true)][int[]]$ProcessIds,
    [int]$TimeoutSeconds = 30
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $remaining = @($ProcessIds | Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
  while ($remaining.Count -ne 0 -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 200
    $remaining = @($ProcessIds | Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
  }
  if ($remaining.Count -ne 0) {
    throw "Installer smoke left $($remaining.Count) process tree member(s) running."
  }
}

$resolvedSetup = (Resolve-Path -LiteralPath $SetupPath).Path
$resolvedEvidenceRoot = [System.IO.Path]::GetFullPath($EvidenceRoot)
$smokeId = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$temporaryRoot = Join-Path $env:RUNNER_TEMP "dsh-installer-ui-$smokeId"
$requestedInstallRoot = $temporaryRoot
$installRoot = Join-Path $temporaryRoot 'DeepSeek Harness'
$harnessHome = Join-Path $temporaryRoot 'smoke-data\dsh-home'
$userData = Join-Path $temporaryRoot 'smoke-data\electron-data'
$harnessMarker = Join-Path $harnessHome 'preserve-after-uninstall.txt'
$userDataMarker = Join-Path $userData 'preserve-after-uninstall.txt'
$uninstallerLauncher = Join-Path $temporaryRoot 'DeepSeek-Harness-Uninstall-UI-Smoke.exe'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeepSeek Harness.lnk'
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'DeepSeek Harness.lnk'
$installed = $false
$setup = $null
$setupProcessIds = @()

if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startMenuShortcut)) {
  throw 'Installer UI smoke refuses to overwrite an existing DeepSeek Harness shortcut.'
}

try {
  New-Item -ItemType Directory -Force -Path $temporaryRoot, $harnessHome, $userData, $resolvedEvidenceRoot | Out-Null
  Set-Content -LiteralPath $harnessMarker -Value 'preserve Harness data'
  Set-Content -LiteralPath $userDataMarker -Value 'preserve Electron data'

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new($resolvedSetup)
  $startInfo.UseShellExecute = $false
  $startInfo.Environment['DSH_HOME'] = $harnessHome
  $startInfo.Environment['DSH_DESKTOP_SMOKE_USER_DATA'] = $userData
  [void]$startInfo.ArgumentList.Add('/currentuser')
  # electron-builder appends the product subdirectory on the progress page.
  # Keep the /D value space-free because NSIS requires this last argument to
  # remain unquoted; quoting it becomes a literal trailing double quote.
  [void]$startInfo.ArgumentList.Add("/D=$requestedInstallRoot")
  $setup = [System.Diagnostics.Process]::Start($startInfo)
  if ($null -eq $setup) {
    throw 'Windows did not start the Setup executable.'
  }
  $script:InstallerProcessId = $setup.Id

  $welcome = Wait-InstallerPage -Pattern 'Welcome to DeepSeek Harness Setup'
  Save-RedactedInstallerScreenshot -Window $welcome `
    -Path (Join-Path $resolvedEvidenceRoot 'installer-welcome.png')
  Invoke-InstallerButton -Window $welcome -NamePattern '^Next\s*>$'

  $destination = Wait-InstallerPage -Pattern 'Choose Install Location'
  $directoryField = Find-Control -Element $destination `
    -ControlType ([System.Windows.Automation.ControlType]::Edit)
  if ($null -eq $directoryField) {
    throw 'The visible destination page did not expose an installation directory field.'
  }
  $directoryValue = $directoryField.GetCurrentPattern(
    [System.Windows.Automation.ValuePattern]::Pattern
  ).Current.Value
  if ([IO.Path]::GetFullPath($directoryValue).TrimEnd('\') -ne [IO.Path]::GetFullPath($requestedInstallRoot).TrimEnd('\')) {
    throw "Destination page did not show the requested path. Expected '$requestedInstallRoot', found '$directoryValue'."
  }
  Save-RedactedInstallerScreenshot -Window $destination `
    -Path (Join-Path $resolvedEvidenceRoot 'installer-destination.png')
  Invoke-InstallerButton -Window $destination -NamePattern '^Install$'

  $deadline = [DateTime]::UtcNow.AddMinutes(3)
  $progressObserved = $false
  $progressScreenshotCaptured = $false
  $detailsObserved = $false
  $finish = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    $window = Get-InstallerWindow
    if ($null -ne $window) {
      $text = Get-AutomationText -Element $window
      $progress = Find-Control -Element $window `
        -ControlType ([System.Windows.Automation.ControlType]::ProgressBar)
      if ($null -ne $progress -or $text -match 'Installing, please wait') {
        $progressObserved = $true
        if (-not $progressScreenshotCaptured) {
          Save-RedactedInstallerScreenshot -Window $window `
            -Path (Join-Path $resolvedEvidenceRoot 'installer-progress.png')
          $progressScreenshotCaptured = $true
        }
      }
      $details = Find-Control -Element $window `
        -ControlType ([System.Windows.Automation.ControlType]::List)
      $nativeDetailsVisible = [NativeInstallerWindow]::HasVisibleChildClass(
        [IntPtr]$window.Current.NativeWindowHandle,
        'SysListView32'
      )
      if ($null -ne $details -or $nativeDetailsVisible -or $text -match 'Application files installed|Shortcuts are ready') {
        $detailsObserved = $true
      }
      if ($text -match 'Completing DeepSeek Harness Setup') {
        $finish = $window
        break
      }
    }
    Start-Sleep -Milliseconds 50
  }
  if (-not $progressObserved) {
    throw 'The assisted installer never exposed its installation progress.'
  }
  if (-not $detailsObserved) {
    throw 'The assisted installer never exposed its expanded installation details.'
  }
  if ($null -eq $finish) {
    throw 'Timed out waiting for the visible Setup finish page.'
  }
  if (-not $progressScreenshotCaptured) {
    throw 'The assisted installer did not preserve a progress screenshot.'
  }
  Save-RedactedInstallerScreenshot -Window $finish `
    -Path (Join-Path $resolvedEvidenceRoot 'installer-finish.png')

  # Reaching Finish proves the install transaction wrote its uninstaller and
  # shortcuts. From here every failure must use the exact isolated uninstaller
  # in `finally`; recursive temp deletion alone would leave those registrations.
  $installed = $true
  Wait-InstallerToggleOff
  $setupProcessIds = @(Get-DescendantProcessIds -RootProcessId $setup.Id)
  Complete-InstallerFinish -Setup $setup
  Wait-ProcessIdsStopped -ProcessIds $setupProcessIds

  $executable = Join-Path $installRoot 'DeepSeek Harness.exe'
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Visible Setup did not install the desktop executable: $executable"
  }
  if (-not (Test-Path -LiteralPath $desktopShortcut -PathType Leaf)) {
    throw 'Visible Setup did not create the desktop shortcut.'
  }
  if (-not (Test-Path -LiteralPath $startMenuShortcut -PathType Leaf)) {
    throw 'Visible Setup did not create the Start menu shortcut.'
  }
  $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File)
  if ($uninstallers.Count -ne 1) {
    throw "Visible Setup expected one uninstaller, found $($uninstallers.Count)."
  }
  $installed = $true

  Invoke-IsolatedUninstall -InstalledUninstaller $uninstallers[0].FullName `
    -InstallRoot $installRoot -LauncherPath $uninstallerLauncher
  $installed = $false
  Wait-PathRemoved -LiteralPath $installRoot
  if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startMenuShortcut)) {
    throw 'Visible Setup uninstall left a shortcut behind.'
  }
  if (-not (Test-Path -LiteralPath $harnessMarker -PathType Leaf)) {
    throw 'Visible Setup uninstall removed the isolated Harness data marker.'
  }
  if (-not (Test-Path -LiteralPath $userDataMarker -PathType Leaf)) {
    throw 'Visible Setup uninstall removed the isolated Electron data marker.'
  }

  Write-Host 'Windows installer UI smoke passed: welcome, destination, progress/details, finish, shortcuts, and uninstall.'
}
finally {
  if ($null -ne $setup) {
    if ($setupProcessIds.Count -eq 0 -and -not $setup.HasExited) {
      $setupProcessIds = @(Get-DescendantProcessIds -RootProcessId $setup.Id)
    }
    foreach ($processId in @($setupProcessIds | Sort-Object -Descending)) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    if ($setupProcessIds.Count -ne 0) { Wait-ProcessIdsStopped -ProcessIds $setupProcessIds }
    $setup.Dispose()
  }
  if ($installed -and (Test-Path -LiteralPath $installRoot)) {
    $fallback = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue)
    if ($fallback.Count -eq 1) {
      try {
        Invoke-IsolatedUninstall -InstalledUninstaller $fallback[0].FullName `
          -InstallRoot $installRoot -LauncherPath $uninstallerLauncher
        Wait-PathRemoved -LiteralPath $installRoot
        $installed = $false
      }
      catch {
        Write-Warning "Fallback uninstall failed: $($_.Exception.Message)"
      }
    }
  }
  if (-not $installed -and (Test-Path -LiteralPath $temporaryRoot)) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
