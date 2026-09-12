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
    [NativePickerWindow]::ProcessId($window) -eq $script:PickerOwner.Id
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

function Get-DirectoryPickerWindow {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($window in $windows) {
    try {
      if ($window.Current.Name -eq 'Select Workspace Directory') {
        if ($null -eq $script:PickerOwner) {
          $script:PickerOwner = [Diagnostics.Process]::GetProcessById($window.Current.ProcessId)
          [void]$script:PickerOwner.Handle
          if ($script:PickerOwner.MainModule.FileName -ine $script:PickerExecutable) {
            throw 'Directory picker belongs to a different executable.'
          }
        }
        if ($script:PickerOwner.HasExited -or $window.Current.ProcessId -ne $script:PickerOwner.Id) {
          throw 'Directory picker process identity changed.'
        }
        return $window
      }
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
      # The native dialog can close while UI Automation enumerates it.
    }
  }
  return $null
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
$script:PickerFacts = [ordered]@{ phase = 'find'; ownerMatches = $false; foregroundMatches = $false;
  dialogKeyboardFocusable = $false; dialogEnabled = $false; dialogWindowPattern = $false;
  addressKeyboardFocusable = $false; addressValuePattern = $false; addressReadOnly = $true; pathWritten = $false }
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
  $script:PickerFacts.phase = 'close'
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($null -eq (Get-DirectoryPickerWindow)) {
      $script:PickerFacts.phase = 'complete'
      [Console]::Out.WriteLine('DSH_PICKER ' + ($script:PickerFacts | ConvertTo-Json -Compress))
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
    name = $first.GetType().Name; message = $message } | ConvertTo-Json -Depth 3 -Compress))
  throw
} finally {
  if ($null -ne $script:PickerOwner) { $script:PickerOwner.Dispose() }
}
