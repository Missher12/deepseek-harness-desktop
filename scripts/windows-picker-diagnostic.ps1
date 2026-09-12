param(
  [Parameter(Mandatory = $true)][int]$MainProcessId,
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$ControlRoot,
  [Parameter(Mandatory = $true)][string]$EvidenceRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PickerDiagnosticWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  public static uint ProcessId(IntPtr window) { uint pid; GetWindowThreadProcessId(window, out pid); return pid; }
}
'@

$held = @{}
$samples = [System.Collections.Generic.List[object]]::new()
$firstError = $null
$cleanupError = $null
$lastState = $null
$lastSample = $null
$sampleCount = 0
$forced = 0
$cancelInvoked = 0
$clock = [System.Diagnostics.Stopwatch]::new()

function Write-Receipt {
  param([string]$Name, $Value)
  $Value['productSourceSha'] = '5a17c6b29971b6034929bb8a13e3b11cdc4748e8'
  $Value['diagnosticSourceSha'] = $env:DSH_PICKER_DIAGNOSTIC_SHA
  [System.IO.File]::WriteAllText((Join-Path $EvidenceRoot $Name), (($Value | ConvertTo-Json -Depth 12) + "`n"), [System.Text.UTF8Encoding]::new($false))
}

function Hold-OwnedTree {
  $inventoryStarted = [DateTime]::UtcNow
  $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($row in $rows) {
      $childId = [int]$row.ProcessId
      $parentId = [int]$row.ParentProcessId
      if ($held.ContainsKey($childId) -or -not $held.ContainsKey($parentId) -or $held[$parentId].HasExited) { continue }
      try { $child = [System.Diagnostics.Process]::GetProcessById($childId) }
      catch [System.ArgumentException] { continue } # A child exited between the inventory and handle acquisition.
      try {
        [void]$child.Handle
        if ($child.StartTime.ToUniversalTime() -gt $inventoryStarted) { $child.Dispose(); continue }
        $held[$childId] = $child
        $changed = $true
      } catch {
        $child.Dispose()
        throw
      }
    }
  }
}

function Read-Window {
  param($Element, [string]$Role)
  $errors = [System.Collections.Generic.List[object]]::new()
  $value = [ordered]@{ role = $Role }
  $readers = [ordered]@{
    pid = { [int]$Element.Current.ProcessId }
    hwnd = { [long]$Element.Current.NativeWindowHandle }
    enabled = { [bool]$Element.Current.IsEnabled }
    offscreen = { [bool]$Element.Current.IsOffscreen }
    keyboardFocusable = { [bool]$Element.Current.IsKeyboardFocusable }
    bounds = {
      $b = $Element.Current.BoundingRectangle
      $rectangle = [ordered]@{ x = $b.X; y = $b.Y; width = $b.Width; height = $b.Height }
      foreach ($coordinate in @($rectangle.Keys)) {
        if ([double]::IsNaN($rectangle[$coordinate]) -or [double]::IsInfinity($rectangle[$coordinate])) { $rectangle[$coordinate] = $null }
      }
      $rectangle
    }
  }
  foreach ($key in $readers.Keys) {
    try { $value[$key] = & $readers[$key] }
    catch { $value[$key] = $null; $errors.Add(@{ field = $key; error = $_.Exception.GetBaseException().GetType().Name }) }
  }
  $value['nativePid'] = if ($null -ne $value.hwnd -and $value.hwnd -ne 0) { [int][PickerDiagnosticWindow]::ProcessId([IntPtr]$value.hwnd) } else { $null }
  $value['ownerHandleHeld'] = if ($null -ne $value.pid) { $held.ContainsKey([int]$value.pid) -and -not $held[[int]$value.pid].HasExited } else { $null }
  $value['mainOwner'] = if ($null -ne $value.pid -and $null -ne $value.nativePid) { $value.pid -eq $MainProcessId -and $value.nativePid -eq $MainProcessId } else { $null }
  $value['executable'] = $null
  if ($null -ne $value.pid) {
    $process = $null
    try {
      $process = [System.Diagnostics.Process]::GetProcessById([int]$value.pid)
      $value['executable'] = [System.IO.Path]::GetFileName($process.MainModule.FileName)
    } catch { $errors.Add(@{ field = 'executable'; error = $_.Exception.GetBaseException().GetType().Name }) }
    finally { if ($null -ne $process) { $process.Dispose() } }
  }
  $value['windowPattern'] = $null
  $value['interactionState'] = $null
  $value['isModal'] = $null
  try {
    $pattern = $null
    $value['windowPattern'] = $Element.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)
    if ($value.windowPattern) {
      $value['interactionState'] = ([System.Windows.Automation.WindowPattern]$pattern).Current.WindowInteractionState.ToString()
      $value['isModal'] = ([System.Windows.Automation.WindowPattern]$pattern).Current.IsModal
    }
  } catch { $errors.Add(@{ field = 'windowPattern'; error = $_.Exception.GetBaseException().GetType().Name }) }
  $value['errors'] = @($errors.ToArray())
  return $value
}

function Read-Scene {
  $foreground = [PickerDiagnosticWindow]::GetForegroundWindow()
  $windows = [System.Collections.Generic.List[object]]::new()
  $enumerationErrors = [System.Collections.Generic.List[string]]::new()
  $all = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($element in $all) {
    try {
      $isPicker = $element.Current.Name -eq 'Select Workspace Directory'
      $ownerId = [int]$element.Current.ProcessId
      $isOwned = $held.ContainsKey($ownerId) -and -not $held[$ownerId].HasExited
      if (-not $isPicker -and -not $isOwned) { continue }
      $role = if ($isPicker) { 'same-title-picker' } else { 'same-owner-window' }
      $window = Read-Window $element $role
      $window['foreground'] = if ($null -ne $window.hwnd) { $window.hwnd -eq $foreground.ToInt64() } else { $null }
      $windows.Add($window)
      if ($windows.Count -gt 32) { throw 'Relevant window count exceeded the bounded diagnostic limit.' }
    } catch [System.Windows.Automation.ElementNotAvailableException] {
      $enumerationErrors.Add('ElementNotAvailableException')
    }
  }
  return [ordered]@{
    foregroundHwnd = $foreground.ToInt64()
    foregroundPid = [int][PickerDiagnosticWindow]::ProcessId($foreground)
    windows = @($windows.ToArray() | Sort-Object { $_.hwnd })
    enumerationErrors = @($enumerationErrors.ToArray())
  }
}

function Retain-Sample {
  param([string]$Kind)
  $scene = Read-Scene
  $script:sampleCount += 1
  $state = $scene | ConvertTo-Json -Depth 12 -Compress
  $sample = [ordered]@{ kind = $Kind; elapsedMs = $clock.ElapsedMilliseconds; scene = $scene }
  $script:lastSample = $sample
  if ($null -eq $script:lastState -or $state -cne $script:lastState -or $Kind -eq 'last') {
    if ($samples.Count -ge 190) { throw 'Diagnostic sample limit exceeded.' }
    $samples.Add($sample)
    $script:lastState = $state
  }
}

try {
  $main = [System.Diagnostics.Process]::GetProcessById($MainProcessId)
  [void]$main.Handle
  if ($main.MainModule.FileName -ine (Resolve-Path -LiteralPath $Executable).Path) { $main.Dispose(); throw 'Main executable ownership mismatch.' }
  $held[$MainProcessId] = $main
  Hold-OwnedTree
  [System.IO.File]::WriteAllText((Join-Path $ControlRoot 'observe.ready'), 'ready')
  $readyDeadline = [DateTime]::UtcNow.AddSeconds(20)
  while (-not (Test-Path -LiteralPath (Join-Path $ControlRoot 'observe.go'))) {
    if ([DateTime]::UtcNow -ge $readyDeadline) { throw 'Picker trigger was not received.' }
    Start-Sleep -Milliseconds 100
  }
  $clock.Start()
  Retain-Sample 'first'
  $nextTree = 0L
  while ($clock.ElapsedMilliseconds -lt 45000) {
    if ($clock.ElapsedMilliseconds -ge $nextTree) { Hold-OwnedTree; $nextTree = $clock.ElapsedMilliseconds + 1000 }
    Retain-Sample 'change'
    Start-Sleep -Milliseconds 250
  }
  Retain-Sample 'last'
} catch {
  $firstError = $_.Exception.GetBaseException().GetType().Name
  # Sample the same failing scene without replacing the original failure.
  try { Retain-Sample 'failure' } catch { $cleanupError = $_.Exception.GetBaseException().GetType().Name }
} finally {
  try {
    Write-Receipt 'observation.json' ([ordered]@{ schemaVersion = 1; windowMs = 45000; elapsedMs = $clock.ElapsedMilliseconds; sampleCount = $sampleCount; firstError = $firstError; samples = @($samples.ToArray()); lastSample = $lastSample })
  } catch { $cleanupError = $_.Exception.GetBaseException().GetType().Name }
  try {
    # Cancellation happens after observation; no focus, keys or acceptance influence the recorded state.
    $all = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($element in $all) {
      if ($element.Current.Name -ne 'Select Workspace Directory') { continue }
      $ownerId = [int]$element.Current.ProcessId
      if (-not $held.ContainsKey($ownerId) -or $held[$ownerId].HasExited) { continue }
      $hwnd = [IntPtr]$element.Current.NativeWindowHandle
      if ([PickerDiagnosticWindow]::ProcessId($hwnd) -ne $ownerId) { continue }
      $buttons = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '2'))
      foreach ($button in $buttons) {
        if (-not $button.Current.IsEnabled -or $button.Current.IsOffscreen) { continue }
        $pattern = $null
        if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
          ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
          $cancelInvoked += 1
          break
        }
      }
    }
  } catch { if ($null -eq $cleanupError) { $cleanupError = $_.Exception.GetBaseException().GetType().Name } }
  try { [System.IO.File]::WriteAllText((Join-Path $ControlRoot 'observe.done'), 'done') }
  catch { if ($null -eq $cleanupError) { $cleanupError = $_.Exception.GetBaseException().GetType().Name } }
  try {
    $exitDeadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
      Hold-OwnedTree
      $remaining = @($held.Values | Where-Object { -not $_.HasExited })
      if ($remaining.Count -eq 0) { break }
      Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $exitDeadline)
    # Emergency cleanup is reported separately and never presented as normal Quit.
    foreach ($process in @($held.Values | Where-Object { -not $_.HasExited } | Sort-Object Id -Descending)) {
      $process.Kill()
      $forced += 1
      [void]$process.WaitForExit(5000)
    }
    $remaining = @($held.Values | Where-Object { -not $_.HasExited })
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $held.ContainsKey([int]$_.OwningProcess) })
    Write-Receipt 'cleanup.json' ([ordered]@{ schemaVersion = 1; heldProcesses = $held.Count; remainingProcesses = $remaining.Count; remainingListeners = $listeners.Count; cancelInvoked = $cancelInvoked; forcedProcesses = $forced; cleanupError = $cleanupError })
    if ($remaining.Count -ne 0 -or $listeners.Count -ne 0) { throw 'Owned resources survived cleanup.' }
  } catch {
    Write-Receipt 'cleanup.json' ([ordered]@{ schemaVersion = 1; heldProcesses = $held.Count; remainingProcesses = $null; remainingListeners = $null; cancelInvoked = $cancelInvoked; forcedProcesses = $forced; cleanupError = $_.Exception.GetBaseException().GetType().Name })
    $cleanupError = $_.Exception.GetBaseException().GetType().Name
  } finally { foreach ($process in $held.Values) { $process.Dispose() } }
}
if ($null -ne $firstError -or $null -ne $cleanupError -or $forced -gt 0) { exit 1 }
