param(
  [Parameter(Mandatory = $true)]
  [string]$FolderPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativePickerWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  public static uint ProcessId(IntPtr window) {
    uint processId;
    return GetWindowThreadProcessId(window, out processId) == 0 ? 0 : processId;
  }
}
'@

function Test-PickerPathReadback {
  param([string]$Expected, [string]$Observed, [bool]$Owned, [bool]$Foreground, [bool]$Focused)
  return $Owned -and $Foreground -and $Focused -and
    -not [string]::IsNullOrEmpty($Expected) -and $Observed -ceq $Expected
}

function Test-PickerForeground {
  param([System.Windows.Automation.AutomationElement]$Dialog)
  $window = [IntPtr]$Dialog.Current.NativeWindowHandle
  $owned = $null -ne $script:PickerOwner -and -not $script:PickerOwner.HasExited -and
    $Dialog.Current.ProcessId -eq $script:PickerOwner.Id -and $window -ne [IntPtr]::Zero -and
    [NativePickerWindow]::ProcessId($window) -eq $script:PickerOwner.Id -and
    (Get-PickerNativeRelationship $window).related -and
    $Dialog.Current.IsEnabled -and -not $Dialog.Current.IsOffscreen -and
    [NativePickerWindow]::IsWindowEnabled($window) -and [NativePickerWindow]::IsWindowVisible($window)
  $script:PickerFacts.ownerMatches = $owned
  $script:PickerFacts.foregroundMatches = $owned -and [NativePickerWindow]::GetForegroundWindow() -eq $window
  return $script:PickerFacts.foregroundMatches
}

function Wait-PickerAddress {
  param([System.Windows.Automation.AutomationElement]$Dialog)
  while ([DateTime]::UtcNow -lt $script:PickerDeadline) {
    if (-not (Test-PickerForeground $Dialog)) { throw 'Owned picker lost the foreground before address input.' }
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -ne $focused) {
      $current = $focused.Current
      $script:PickerFacts.addressKeyboardFocusable = $current.IsKeyboardFocusable
      $pattern = $null
      $hasValue = $focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)
      $script:PickerFacts.addressValuePattern = $hasValue
      $inside = $current.NativeWindowHandle -ne 0 -and
        [NativePickerWindow]::GetAncestor([IntPtr]$current.NativeWindowHandle, 2) -eq [IntPtr]$Dialog.Current.NativeWindowHandle
      $script:PickerFacts.address = @{ hwnd = [long]$current.NativeWindowHandle; pid = $current.ProcessId;
        rootHwnd = [NativePickerWindow]::GetAncestor([IntPtr]$current.NativeWindowHandle, 2).ToInt64(); inside = $inside;
        focused = $current.HasKeyboardFocus; enabled = $current.IsEnabled; offscreen = $current.IsOffscreen;
        edit = ($current.ControlType -eq [System.Windows.Automation.ControlType]::Edit) }
      if ($current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and
          $current.ProcessId -eq $script:PickerOwner.Id -and $inside -and
          $current.IsEnabled -and -not $current.IsOffscreen -and
          $current.IsKeyboardFocusable -and $current.HasKeyboardFocus -and $hasValue) {
        $script:PickerFacts.addressReadOnly = $pattern.Current.IsReadOnly
        if (-not $pattern.Current.IsReadOnly) { return @{ Element = $focused; Pattern = $pattern } }
      }
    }
    Start-Sleep -Milliseconds 100
  }
  throw 'The owned picker did not expose its focused writable address field.'
}

function Get-DirectoryPickerAnchor {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  $anchors = @()
  foreach ($window in $windows) {
    try {
      if ($window.Current.Name -eq 'Select Workspace Directory') {
        $anchors += $window
      }
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
      # The native dialog can close while UI Automation enumerates it.
    }
  }
  $script:PickerFacts.anchorCount = $anchors.Count
  if ($anchors.Count -eq 0) { return $null }
  if ($anchors.Count -ne 1) { throw 'Directory picker has multiple title anchors.' }
  $anchor = $anchors[0]
  if ($null -eq $script:PickerOwner) {
    $script:PickerOwner = [Diagnostics.Process]::GetProcessById($anchor.Current.ProcessId)
    [void]$script:PickerOwner.Handle
    if ($script:PickerOwner.MainModule.FileName -ine $script:PickerExecutable) {
      throw 'Directory picker belongs to a different executable.'
    }
  }
  if ($script:PickerOwner.HasExited) { return $null }
  $window = [IntPtr]$anchor.Current.NativeWindowHandle
  if ($anchor.Current.ProcessId -ne $script:PickerOwner.Id -or $window -eq [IntPtr]::Zero -or
      [NativePickerWindow]::ProcessId($window) -ne $script:PickerOwner.Id) {
    throw 'Directory picker process identity changed.'
  }
  $script:PickerAnchor = $window
  return $anchor
}

function Get-PickerNativeRelationship {
  param([IntPtr]$Window)
  $anchor = $script:PickerAnchor
  $anchorOwned = $null -ne $script:PickerOwner -and -not $script:PickerOwner.HasExited -and
    $anchor -ne [IntPtr]::Zero -and [NativePickerWindow]::IsWindow($anchor) -and
    [NativePickerWindow]::ProcessId($anchor) -eq $script:PickerOwner.Id
  $self = $anchorOwned -and $Window -eq $anchor
  $child = $anchorOwned -and [NativePickerWindow]::IsChild($anchor, $Window)
  $root = [NativePickerWindow]::GetAncestor($Window, 2)
  $ancestor = $anchorOwned -and $root -eq $anchor
  $owners = @()
  $seen = [System.Collections.Generic.HashSet[long]]::new()
  $current = $Window
  $ownedPopup = $false
  for ($index = 0; $index -lt 16 -and $current -ne [IntPtr]::Zero; $index += 1) {
    $current = [NativePickerWindow]::GetWindow($current, 4)
    if ($current -eq [IntPtr]::Zero -or -not $seen.Add($current.ToInt64())) { break }
    $ownerPid = [NativePickerWindow]::ProcessId($current)
    $owners += @{ hwnd = $current.ToInt64(); pid = $ownerPid }
    if (-not $anchorOwned -or $ownerPid -ne $script:PickerOwner.Id) { break }
    if ($current -eq $anchor) { $ownedPopup = $true; break }
  }
  return @{ related = ($self -or $child -or $ancestor -or $ownedPopup); self = $self;
    child = $child; ancestor = $ancestor; ownedPopup = $ownedPopup; root = $root.ToInt64(); owners = $owners }
}

function Test-PickerTargetFacts {
  param([System.Collections.IDictionary]$Facts)
  return $null -eq $Facts.error -and $Facts.isWindow -and $Facts.ownerAlive -and $Facts.hwnd -ne 0 -and
    $Facts.uiaHwnd -eq $Facts.hwnd -and $Facts.pid -eq $Facts.ownerPid -and
    $Facts.nativePid -eq $Facts.ownerPid -and $Facts.related -and $Facts.enabled -and
    -not $Facts.offscreen -and $Facts.nativeEnabled -and $Facts.nativeVisible
}

function Select-PickerTarget {
  param([object[]]$Candidates)
  $valid = @($Candidates | Where-Object { Test-PickerTargetFacts $_ })
  if ($valid.Count -gt 1) { throw 'Directory picker has multiple interactive related windows.' }
  if ($valid.Count -eq 0) { return $null }
  return $valid[0]
}

function Get-DirectoryPickerWindow {
  $anchor = Get-DirectoryPickerAnchor
  if ($null -eq $anchor) { return $null }
  $foreground = [NativePickerWindow]::GetForegroundWindow()
  $popup = [NativePickerWindow]::GetLastActivePopup($script:PickerAnchor)
  $handles = [System.Collections.Generic.HashSet[long]]::new()
  $elements = @{}
  $candidates = @()
  foreach ($window in @($script:PickerAnchor, $foreground, $popup)) {
    if ($window -eq [IntPtr]::Zero -or -not $handles.Add($window.ToInt64())) { continue }
    $relationship = Get-PickerNativeRelationship $window
    $facts = [ordered]@{
      hwnd = $window.ToInt64(); nativePid = [NativePickerWindow]::ProcessId($window)
      ownerPid = $script:PickerOwner.Id; ownerAlive = (-not $script:PickerOwner.HasExited)
      related = $relationship.related; relationship = $relationship
      foreground = ($window -eq $foreground); popup = ($window -eq $popup)
      isWindow = [NativePickerWindow]::IsWindow($window)
      nativeEnabled = [NativePickerWindow]::IsWindowEnabled($window)
      nativeVisible = [NativePickerWindow]::IsWindowVisible($window)
      uiaHwnd = $null; pid = $null; enabled = $null; offscreen = $null
      windowPattern = $null; interactionState = $null; modal = $null; bounds = $null; error = $null
    }
    try {
      $element = [System.Windows.Automation.AutomationElement]::FromHandle($window)
      $facts.uiaHwnd = [long]$element.Current.NativeWindowHandle
      $facts.pid = [int]$element.Current.ProcessId
      $facts.enabled = $element.Current.IsEnabled
      $facts.offscreen = $element.Current.IsOffscreen
      $bounds = $element.Current.BoundingRectangle
      $facts.bounds = [ordered]@{ x = $bounds.X; y = $bounds.Y; width = $bounds.Width; height = $bounds.Height }
      foreach ($key in @($facts.bounds.Keys)) {
        if ([double]::IsNaN($facts.bounds[$key]) -or [double]::IsInfinity($facts.bounds[$key])) { $facts.bounds[$key] = $null }
      }
      $pattern = $null
      $facts.windowPattern = $element.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)
      if ($facts.windowPattern) {
        $facts.interactionState = $pattern.Current.WindowInteractionState.ToString()
        $facts.modal = $pattern.Current.IsModal
      }
      $elements[$window.ToInt64()] = $element
    } catch { $facts.error = $_.Exception.GetBaseException().GetType().Name }
    $candidates += $facts
  }
  $state = [ordered]@{ anchorHwnd = $script:PickerAnchor.ToInt64(); workerPid = $script:PickerOwner.Id; candidates = $candidates }
  $signature = $state | ConvertTo-Json -Depth 8 -Compress
  $snapshot = @{ elapsedMs = $script:PickerClock.ElapsedMilliseconds; state = $state }
  if ($signature -cne $script:PickerLastSignature) {
    if ($script:PickerTrace.Count -lt 16) { $script:PickerTrace.Add($snapshot) }
    $script:PickerLastSignature = $signature
  }
  $script:PickerFacts.resolution = @($script:PickerTrace.ToArray())
  $script:PickerFacts.resolutionLast = $snapshot
  $selected = Select-PickerTarget $candidates
  if ($null -eq $selected) { return $null }
  $script:PickerFacts.selectedHwnd = $selected.hwnd
  return $elements[$selected.hwnd]
}

function Wait-DirectoryPickerWindow {
  while ([DateTime]::UtcNow -lt $script:PickerDeadline) {
    $window = Get-DirectoryPickerWindow
    if ($null -ne $window) {
      return $window
    }
    Start-Sleep -Milliseconds 100
  }
  throw 'Timed out waiting for the Select Workspace Directory dialog.'
}

function Invoke-DirectoryPickerAccept {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Dialog
  )

  $buttonCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $buttons = $Dialog.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    $buttonCondition
  )
  $acceptButton = $null
  foreach ($button in $buttons) {
    try {
      if (
        $button.Current.IsEnabled -and (
          $button.Current.AutomationId -eq '1' -or
          $button.Current.Name -match '^(Select Folder|Select|选择文件夹|选择)$'
        )
      ) {
        $acceptButton = $button
        break
      }
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
      # Ignore controls that disappear while the dialog refreshes its folder.
    }
  }
  if ($null -eq $acceptButton) {
    throw 'The enabled Select Folder button was not exposed through UI Automation.'
  }

  $invokePattern = $null
  if (-not $acceptButton.TryGetCurrentPattern(
    [System.Windows.Automation.InvokePattern]::Pattern,
    [ref]$invokePattern
  )) {
    throw 'The Select Folder button does not expose the UI Automation invoke pattern.'
  }
  ([System.Windows.Automation.InvokePattern]$invokePattern).Invoke()
}

$resolvedFolder = (Resolve-Path -LiteralPath $FolderPath).Path
if ($resolvedFolder -notmatch '^[A-Za-z0-9:\\ ._-]+$') {
  throw "Directory picker smoke path contains SendKeys metacharacters: $resolvedFolder"
}

$script:PickerOwner = $null
$script:PickerAnchor = [IntPtr]::Zero
$script:PickerTrace = [System.Collections.Generic.List[object]]::new()
$script:PickerLastSignature = ''
$script:PickerClock = [System.Diagnostics.Stopwatch]::StartNew()
$script:PickerFacts = [ordered]@{ phase = 'find'; ownerMatches = $null; foregroundMatches = $null;
  dialogKeyboardFocusable = $null; dialogEnabled = $null; dialogWindowPattern = $null;
  addressKeyboardFocusable = $null; addressValuePattern = $null; addressReadOnly = $null; pathWritten = $false;
  anchorCount = 0; selectedHwnd = $null; resolution = @(); resolutionLast = $null; address = $null; acceptInvoked = $false }
$script:PickerDeadline = [DateTime]::UtcNow.AddSeconds(45)
try {
  if ([string]::IsNullOrEmpty($env:DSH_WINDOWS_DESKTOP_EXECUTABLE)) {
    throw 'Directory picker smoke requires the isolated installed executable identity.'
  }
  $script:PickerExecutable = (Resolve-Path -LiteralPath $env:DSH_WINDOWS_DESKTOP_EXECUTABLE).Path
  $dialog = Wait-DirectoryPickerWindow
  $script:PickerFacts.dialogKeyboardFocusable = $dialog.Current.IsKeyboardFocusable
  $script:PickerFacts.dialogEnabled = $dialog.Current.IsEnabled
  $windowPattern = $null
  $script:PickerFacts.dialogWindowPattern = $dialog.TryGetCurrentPattern(
    [System.Windows.Automation.WindowPattern]::Pattern, [ref]$windowPattern)
  if (-not $dialog.Current.IsEnabled -or $dialog.Current.IsOffscreen) { throw 'Owned picker is not enabled and visible.' }
  $script:PickerFacts.phase = 'foreground'
  [void][NativePickerWindow]::SetForegroundWindow([IntPtr]$dialog.Current.NativeWindowHandle)
  while (-not (Test-PickerForeground $dialog) -and [DateTime]::UtcNow -lt $script:PickerDeadline) {
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-PickerForeground $dialog)) { throw 'Owned picker could not become the foreground window.' }
  # Ctrl+L targets the verified dialog; the writable address control, not the
  # non-focusable window container, owns the subsequent ValuePattern operation.
  $script:PickerFacts.phase = 'address'
  [System.Windows.Forms.SendKeys]::SendWait('^l')
  $address = Wait-PickerAddress $dialog
  ([System.Windows.Automation.ValuePattern]$address.Pattern).SetValue($resolvedFolder)
  $script:PickerFacts.phase = 'readback'
  $foreground = Test-PickerForeground $dialog
  $script:PickerFacts.pathWritten = Test-PickerPathReadback -Expected $resolvedFolder `
    -Observed $address.Pattern.Current.Value -Owned $script:PickerFacts.ownerMatches `
    -Foreground $foreground -Focused $address.Element.Current.HasKeyboardFocus
  if (-not $script:PickerFacts.pathWritten) { throw 'Owned picker address did not read back the exact requested path.' }
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 500
  $script:PickerFacts.phase = 'accept'
  $dialog = Get-DirectoryPickerWindow
  if ($null -eq $dialog) { throw 'Directory picker closed before its result was confirmed.' }
  if (-not (Test-PickerForeground $dialog)) { throw 'Owned picker lost the foreground before acceptance.' }
  Invoke-DirectoryPickerAccept -Dialog $dialog
  $script:PickerFacts.acceptInvoked = $true
  $script:PickerFacts.phase = 'close'
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    $anchorGone = $null -eq (Get-DirectoryPickerAnchor)
    $nativeAnchorGone = $script:PickerOwner.HasExited -or -not [NativePickerWindow]::IsWindow($script:PickerAnchor) -or
      [NativePickerWindow]::ProcessId($script:PickerAnchor) -ne $script:PickerOwner.Id
    if ($anchorGone -and $nativeAnchorGone) {
      $script:PickerFacts.phase = 'complete'
      [Console]::Out.WriteLine('DSH_PICKER ' + ($script:PickerFacts | ConvertTo-Json -Depth 12 -Compress))
      exit 0
    }
    Start-Sleep -Milliseconds 100
  }
  throw 'The Select Workspace Directory dialog did not close after confirming the folder.'
} catch {
  $first = $_.Exception.GetBaseException()
  $message = $first.Message.Replace($resolvedFolder, '[owned-folder]')
  if ($message.Length -gt 512) { $message = $message.Substring(0, 512) }
  [Console]::Out.WriteLine('DSH_PICKER_FAILED ' + (@{ facts = $script:PickerFacts;
    name = $first.GetType().Name; message = $message } | ConvertTo-Json -Depth 12 -Compress))
  throw
} finally {
  if ($null -ne $script:PickerOwner) { $script:PickerOwner.Dispose() }
}
