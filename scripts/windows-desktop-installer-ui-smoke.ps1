param(
  [Parameter(Mandatory = $true)]
  [string]$SetupPath,
  [string]$EvidenceRoot = 'apps/desktop/release/windows-installer-ui-evidence',
  [switch]$ExpectBlankDetails,
  [int]$HandoffHelperId = 0,
  [int]$HandoffParentId = 0,
  [int]$HandoffBootstrapId = 0,
  [string]$HandoffWorkerCreated = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeInstallerWindow
{
    private delegate bool EnumChildProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
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

    [DllImport("user32.dll")]
    private static extern bool IsWindowEnabled(IntPtr window);

    [DllImport("user32.dll")]
    private static extern int GetDlgCtrlID(IntPtr window);

    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr window, uint message, UIntPtr wParam, IntPtr lParam,
        uint flags, uint timeout, out UIntPtr result);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageTimeoutW")]
    private static extern IntPtr ReadTextTimeout(
        IntPtr window, uint message, UIntPtr capacity, StringBuilder text,
        uint flags, uint timeout, out UIntPtr result);

    public sealed class ProgressSnapshot
    {
        public int Minimum;
        public int Maximum;
        public int Position;
        public int DetailsRows;
        public bool StatusPresent;
    }

    private static IntPtr FindVisibleChild(IntPtr parent, string expectedClass, int controlId = 0)
    {
        var found = IntPtr.Zero;
        EnumChildWindows(parent, (window, parameter) =>
        {
            var className = new StringBuilder(256);
            Rect rectangle;
            if (GetClassName(window, className, className.Capacity) > 0 &&
                String.Equals(className.ToString(), expectedClass, StringComparison.OrdinalIgnoreCase) &&
                (controlId == 0 || GetDlgCtrlID(window) == controlId) &&
                IsWindowVisible(window) &&
                GetWindowRect(window, out rectangle) &&
                rectangle.Right > rectangle.Left &&
                rectangle.Bottom > rectangle.Top)
            {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static int ReadInteger(IntPtr window, uint message, uint argument = 0)
    {
        UIntPtr result;
        if (SendMessageTimeout(window, message, new UIntPtr(argument), IntPtr.Zero,
            2, 200, out result) == IntPtr.Zero || result.ToUInt64() > Int32.MaxValue)
            return -1;
        return (int)result.ToUInt64();
    }

    public static bool IsFinishPage(IntPtr parent)
    {
        // NSIS IDOK is Next/Install/Finish. Inspect only this native button,
        // never the thousands of UIA list descendants added by file extraction.
        var button = FindVisibleChild(parent, "Button", 1);
        if (button == IntPtr.Zero || !IsWindowEnabled(button)) return false;
        var text = new StringBuilder(64);
        UIntPtr length;
        if (ReadTextTimeout(button, 0x000D, new UIntPtr((uint)text.Capacity), text,
            2, 200, out length) == IntPtr.Zero) return false;
        var label = text.ToString();
        return label == "&Finish" || label == "Finish";
    }

    public static ProgressSnapshot CaptureProgress(IntPtr parent)
    {
        var progress = FindVisibleChild(parent, "msctls_progress32");
        var details = FindVisibleChild(parent, "SysListView32");
        var status = FindVisibleChild(parent, "Static", 1006);
        if (progress == IntPtr.Zero || details == IntPtr.Zero || status == IntPtr.Zero)
            return null;
        var snapshot = new ProgressSnapshot {
            Minimum = ReadInteger(progress, 0x0407, 1), // PBM_GETRANGE low
            Maximum = ReadInteger(progress, 0x0407, 0), // PBM_GETRANGE high
            Position = ReadInteger(progress, 0x0408),   // PBM_GETPOS
            DetailsRows = ReadInteger(details, 0x1004) // LVM_GETITEMCOUNT
        };
        if (snapshot.Minimum < 0 || snapshot.Maximum <= snapshot.Minimum ||
            snapshot.Position < 0 || snapshot.DetailsRows < 0) return null;
        var text = new StringBuilder(1024);
        UIntPtr length;
        if (ReadTextTimeout(status, 0x000D, new UIntPtr((uint)text.Capacity), text,
            2, 200, out length) == IntPtr.Zero) return null; // WM_GETTEXT
        snapshot.StatusPresent = !String.IsNullOrWhiteSpace(text.ToString());
        return snapshot;
    }

    public static Rect[] RedactionBounds(IntPtr parent, bool requireProgress)
    {
        Rect bounds;
        if (!IsWindowVisible(parent) || !GetWindowRect(parent, out bounds) ||
            bounds.Right <= bounds.Left || bounds.Bottom <= bounds.Top) return null;
        var rectangles = new List<Rect> { bounds };
        var valid = true;
        var hasDetails = false;
        var hasStatus = false;
        EnumChildWindows(parent, (window, parameter) =>
        {
            if (!IsWindowVisible(window)) return true;
            var className = new StringBuilder(256);
            if (GetClassName(window, className, className.Capacity) == 0)
            {
                valid = false;
                return false;
            }
            var name = className.ToString();
            var details = String.Equals(name, "SysListView32", StringComparison.OrdinalIgnoreCase);
            var status = String.Equals(name, "Static", StringComparison.OrdinalIgnoreCase) && GetDlgCtrlID(window) == 1006;
            if (!details && !status && !String.Equals(name, "Edit", StringComparison.OrdinalIgnoreCase)) return true;
            Rect rectangle;
            if (!GetWindowRect(window, out rectangle) || rectangle.Right <= rectangle.Left ||
                rectangle.Bottom <= rectangle.Top || rectangle.Left < bounds.Left ||
                rectangle.Top < bounds.Top || rectangle.Right > bounds.Right || rectangle.Bottom > bounds.Bottom)
            {
                valid = false;
                return false;
            }
            rectangles.Add(rectangle);
            hasDetails |= details;
            hasStatus |= status;
            return true;
        }, IntPtr.Zero);
        return valid && (!requireProgress || (hasDetails && hasStatus)) ? rectangles.ToArray() : null;
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
      # MUI Directory/InstFiles append the single-space page subcaption.
      $matchesProductName = $window.Current.Name -match '^DeepSeek Harness(?: Setup)? ?$'
      if ($matchesProcess -and $matchesProductName) {
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
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$RequireProgress
  )

  # GetWindowRect and CopyFromScreen must share physical coordinates at every
  # DPI. Restore the caller's context even when an unverifiable image is dropped.
  $previousDpi = [NativeInstallerWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
  if ($previousDpi -eq [IntPtr]::Zero) {
    throw 'Could not establish physical screenshot coordinates.'
  }
  $bitmap = $null
  $graphics = $null
  $brush = $null
  try {
    $handle = [IntPtr]$Window.Current.NativeWindowHandle
    $beforeRedaction = [NativeInstallerWindow]::RedactionBounds($handle, [bool]$RequireProgress)
    if ($null -eq $beforeRedaction) { throw 'Installer screenshot redaction bounds are unavailable.' }
    $bounds = $beforeRedaction[0]
    $width = $bounds.Right - $bounds.Left
    $height = $bounds.Bottom - $bounds.Top
    $resolved = [System.IO.Path]::GetFullPath($Path)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolved) | Out-Null
    $bitmap = [System.Drawing.Bitmap]::new($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 224, 228, 235))
    $graphics.CopyFromScreen(
      $bounds.Left,
      $bounds.Top,
      0,
      0,
      [System.Drawing.Size]::new($width, $height)
    )
    $afterRedaction = [NativeInstallerWindow]::RedactionBounds($handle, [bool]$RequireProgress)
    if ($null -eq $afterRedaction -or
        ($beforeRedaction | ConvertTo-Json -Compress) -ne ($afterRedaction | ConvertTo-Json -Compress)) {
      throw 'Installer controls changed during capture; the unverified screenshot was discarded.'
    }
    # Mask native Edit, SysListView32 and status rectangles. A report-style
    # NSIS list may be a UIA DataGrid, so UIA ControlType is not a privacy guard.
    for ($index = 1; $index -lt $beforeRedaction.Count; $index++) {
      $redact = $beforeRedaction[$index]
      $graphics.FillRectangle($brush,
        [int]($redact.Left - $bounds.Left), [int]($redact.Top - $bounds.Top),
        [int]($redact.Right - $redact.Left), [int]($redact.Bottom - $redact.Top))
    }
    $bitmap.Save($resolved, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    if ($null -ne $brush) { $brush.Dispose() }
    if ($null -ne $graphics) { $graphics.Dispose() }
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    [void][NativeInstallerWindow]::SetThreadDpiAwarenessContext($previousDpi)
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
  $uninstall = Start-Process -FilePath $LauncherPath -ArgumentList @('/S', "_?=$InstallRoot") -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) {
    throw "Uninstaller failed with exit code $($uninstall.ExitCode)."
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

function Test-HandoffSetupIdentity {
  param($Process, [int]$HelperId, [string]$ExpectedPath, [datetime]$ReadyAt)
  return $null -ne $Process -and $HelperId -gt 0 -and
    $Process.ParentProcessId -eq $HelperId -and
    $Process.ExecutablePath -ieq $ExpectedPath -and
    $Process.CreationDate.ToUniversalTime() -ge $ReadyAt
}

function Test-HandoffWorkerIdentity {
  param($Process, [int]$BootstrapId, [string]$ExpectedPath, [string]$ExpectedCreated)
  return $null -ne $Process -and $BootstrapId -gt 0 -and
    -not [string]::IsNullOrEmpty($ExpectedCreated) -and
    $Process.ParentProcessId -eq $BootstrapId -and
    $Process.ExecutablePath -ieq $ExpectedPath -and
    $Process.CreationDate.ToUniversalTime().ToString('o') -ceq $ExpectedCreated
}

function Observe-UpdateHandoff {
  param([string]$ResolvedSetup, [string]$ResolvedEvidenceRoot)

  # The caller started the production helper against the real installed main
  # PID. Attach only: this branch must never start Setup or press Install.
  $helper = Get-CimInstance Win32_Process -Filter "ProcessId = $HandoffHelperId"
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $HandoffParentId"
  $expectedHelper = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-HandoffWorkerIdentity $helper $HandoffBootstrapId $expectedHelper $HandoffWorkerCreated) -or
      $null -eq $parent -or [IO.Path]::GetFileName($parent.ExecutablePath) -cne 'DeepSeek Harness.exe') {
    throw 'Handoff observer requires the owned waiting helper and a live installed parent.'
  }
  $readyAt = [DateTime]::UtcNow
  $setup = $null
  $handoffStage = 'waiting-for-setup'
  try {
    [Console]::Out.WriteLine('DSH_HANDOFF_OBSERVER_READY')
    [Console]::Out.Flush()
    $deadline = $readyAt.AddSeconds(90)
    while ([DateTime]::UtcNow -lt $deadline) {
      $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $HandoffHelperId" |
        Where-Object { Test-HandoffSetupIdentity $_ $HandoffHelperId $ResolvedSetup $readyAt })
      if ($children.Count -gt 1) { throw 'The updater started duplicate Setup processes.' }
      if ($children.Count -eq 1) {
        if ($null -ne (Get-Process -Id $HandoffParentId -ErrorAction SilentlyContinue)) {
          throw 'Setup started before the installed parent exited.'
        }
        $script:InstallerProcessId = [int]$children[0].ProcessId
        $setup = [Diagnostics.Process]::GetProcessById($script:InstallerProcessId)
        # Private bounded control channel, never a public artifact. Persist the
        # identity before a fast Cancel can make it disappear between inventories.
        $identity = [ordered]@{
          ProcessId = $script:InstallerProcessId
          ParentProcessId = $HandoffHelperId
          Created = $children[0].CreationDate.ToUniversalTime().ToString('o')
        }
        [Console]::Out.WriteLine('DSH_HANDOFF_SETUP ' + ($identity | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
        break
      }
      Start-Sleep -Milliseconds 100
    }
    if ($null -eq $setup) { throw 'The production helper did not start its owned Setup.' }
    $handoffStage = 'waiting-for-welcome'
    $window = Wait-InstallerPage -Pattern 'Welcome to DeepSeek Harness Setup'
    $handoffStage = 'capturing-welcome'
    Save-RedactedInstallerScreenshot -Window $window `
      -Path (Join-Path $ResolvedEvidenceRoot 'handoff-welcome.png')
    $handoffStage = 'controlled-cancel'
    Invoke-InstallerButton -Window $window -NamePattern '^Cancel$'
    $cancelDeadline = [DateTime]::UtcNow.AddSeconds(30)
    $confirmed = $false
    while (-not $setup.HasExited -and [DateTime]::UtcNow -lt $cancelDeadline) {
      # MUI_ABORTWARNING may ask for Yes. Only this Setup's modal dialog is
      # eligible; neither a desktop-wide Yes nor a synthetic process kill is cancellation.
      if (-not $confirmed) {
        $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
          [System.Windows.Automation.TreeScope]::Children,
          [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($dialog in $windows) {
          if ($dialog.Current.ProcessId -ne $script:InstallerProcessId) { continue }
          $text = Get-AutomationText -Element $dialog
          if ($text -notmatch 'quit.*Setup|exit.*Setup|cancel.*Setup') { continue }
          $yes = Find-Control -Element $dialog -ControlType ([System.Windows.Automation.ControlType]::Button) -NamePattern '^&?Yes$'
          if ($null -ne $yes) {
            $yes.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            $confirmed = $true
            break
          }
        }
      }
      Start-Sleep -Milliseconds 100
    }
    if (-not $setup.HasExited) { throw 'Setup did not exit after controlled cancellation.' }
    # Require the observed Cancel and a normal bootstrap exit, never a kill.
    if ($setup.ExitCode -notin @(0, 1)) { throw 'Setup failed instead of cancelling normally.' }
    if ($null -ne (Get-InstallerWindow)) { throw 'The cancelled Setup window remained visible.' }
    [Console]::Out.WriteLine('DSH_HANDOFF_CANCELLED')
  }
  catch {
    # Never forward UI text or machine paths from the generic observer errors.
    [Console]::Out.WriteLine("DSH_HANDOFF_FAILED $handoffStage")
    [Console]::Out.Flush()
    throw "Native update handoff observation failed ($handoffStage)."
  }
  finally {
    if ($null -ne $setup) {
      if (-not $setup.HasExited) {
        $setup.Kill($true)
        if (-not $setup.WaitForExit(10000)) { throw 'Owned Setup cleanup did not finish.' }
      }
      $setup.Dispose()
    }
  }
}

$resolvedSetup = (Resolve-Path -LiteralPath $SetupPath).Path
$resolvedEvidenceRoot = [System.IO.Path]::GetFullPath($EvidenceRoot)
if ($HandoffHelperId -gt 0) {
  if ($HandoffParentId -le 0 -or $ExpectBlankDetails) { throw 'Invalid handoff observation mode.' }
  Observe-UpdateHandoff -ResolvedSetup $resolvedSetup -ResolvedEvidenceRoot $resolvedEvidenceRoot
  return
}
if ($HandoffParentId -ne 0 -or $HandoffHelperId -ne 0 -or $HandoffBootstrapId -ne 0 -or $HandoffWorkerCreated -ne '') { throw 'Invalid handoff identity.' }
$smokeId = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$temporaryRoot = Join-Path $env:RUNNER_TEMP "dsh-installer-ui-$smokeId"
$requestedInstallRoot = $temporaryRoot
$installRoot = Join-Path $temporaryRoot 'DeepSeek Harness'
$uninstallerLauncher = Join-Path $temporaryRoot 'DeepSeek-Harness-Uninstall-UI-Smoke.exe'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeepSeek Harness.lnk'
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'DeepSeek Harness.lnk'
$installed = $false
$setup = $null

if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startMenuShortcut)) {
  throw 'Installer UI smoke refuses to overwrite an existing DeepSeek Harness shortcut.'
}

try {
  New-Item -ItemType Directory -Force -Path $temporaryRoot, $resolvedEvidenceRoot | Out-Null

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new($resolvedSetup)
  $startInfo.UseShellExecute = $false
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
  $progressClock = [System.Diagnostics.Stopwatch]::StartNew()
  $observations = [System.Collections.Generic.List[object]]::new()
  $progressScreenshotCaptured = $false
  $finish = $null
  $finishedElapsedMs = 0
  while ([DateTime]::UtcNow -lt $deadline) {
    $native = $null
    $window = Get-InstallerWindow
    if ($null -ne $window) {
      if ([NativeInstallerWindow]::IsFinishPage([IntPtr]$window.Current.NativeWindowHandle)) {
        $finish = $window
        $finishedElapsedMs = $progressClock.ElapsedMilliseconds
        # From this point any assertion failure must run the isolated uninstaller.
        $installed = $true
        break
      }
      $native = [NativeInstallerWindow]::CaptureProgress([IntPtr]$window.Current.NativeWindowHandle)
      if ($null -ne $native) {
        $observations.Add([ordered]@{
          elapsedMs = $progressClock.ElapsedMilliseconds
          minimum = $native.Minimum
          maximum = $native.Maximum
          position = $native.Position
          detailsRows = $native.DetailsRows
          statusPresent = $native.StatusPresent
        })
        $incomplete = $native.Position -lt $native.Maximum
        $hasDetails = $native.DetailsRows -gt 0 -and $native.StatusPresent
        if (-not $progressScreenshotCaptured -and $incomplete -and ($hasDetails -or $ExpectBlankDetails)) {
          Save-RedactedInstallerScreenshot -Window $window -RequireProgress `
            -Path (Join-Path $resolvedEvidenceRoot 'installer-progress.png')
          $progressScreenshotCaptured = $true
        }
      }
    }
    if ($null -eq $native) {
      $observations.Add([ordered]@{ elapsedMs = $progressClock.ElapsedMilliseconds; missing = $true })
    }
    if ($observations.Count -gt 3600) { throw 'Installer exceeded the bounded observation count.' }
    Start-Sleep -Milliseconds 50
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
  Complete-InstallerFinish -Setup $setup

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

  # Verify after normal uninstall so the expected historical RED cannot leave
  # registrations or shortcuts behind. Only bounded numeric/boolean data leaves
  # this process; control text and native handles never enter evidence files.
  $observationsPath = Join-Path $temporaryRoot 'installer-progress-observations.json'
  $observed = [ordered]@{ schemaVersion = 1; finishedElapsedMs = $finishedElapsedMs; samples = @($observations.ToArray()) }
  [System.IO.File]::WriteAllText($observationsPath, ($observed | ConvertTo-Json -Depth 4 -Compress), [System.Text.UTF8Encoding]::new($false))
  $progressArguments = @('--input', $observationsPath, '--output', (Join-Path $resolvedEvidenceRoot 'installer-progress.json'))
  if ($ExpectBlankDetails) { $progressArguments += '--expect-blank-details' }
  & node scripts/windows-desktop-installer-progress.ts @progressArguments
  if ($LASTEXITCODE -ne 0) { throw 'Native installer progress/details verification failed.' }

  Write-Host 'Windows installer UI smoke passed: welcome, destination, progress/details, finish, shortcuts, and uninstall.'
}
finally {
  if ($null -ne $setup -and -not $setup.HasExited) {
    Stop-Process -Id $setup.Id -Force -ErrorAction SilentlyContinue
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
