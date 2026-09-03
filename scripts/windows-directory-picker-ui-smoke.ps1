param(
  [Parameter(Mandatory = $true)]
  [string]$FolderPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-DirectoryPickerWindow {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($window in $windows) {
    try {
      if ($window.Current.Name -eq 'Select Workspace Directory') {
        return $window
      }
    }
    catch {
      # The native dialog can close while UI Automation enumerates it.
    }
  }
  return $null
}

function Wait-DirectoryPickerWindow {
  param([int]$TimeoutSeconds = 45)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
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
    catch {
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

$dialog = Wait-DirectoryPickerWindow
$dialog.SetFocus()
Start-Sleep -Milliseconds 250

# The Windows common-item dialog exposes its address bar through Ctrl+L. Enter
# navigates to the exact existing test directory. Invoke the accept button by
# its stable common-dialog automation ID instead of relying on keyboard focus.
[System.Windows.Forms.SendKeys]::SendWait('^l')
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait($resolvedFolder)
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 500

$dialog = Get-DirectoryPickerWindow
if ($null -eq $dialog) {
  throw 'The Select Workspace Directory dialog closed before its result was confirmed.'
}
Invoke-DirectoryPickerAccept -Dialog $dialog

$deadline = [DateTime]::UtcNow.AddSeconds(30)
while ([DateTime]::UtcNow -lt $deadline) {
  if ($null -eq (Get-DirectoryPickerWindow)) {
    Write-Host "Windows directory picker selected the exact isolated folder: $resolvedFolder"
    exit 0
  }
  Start-Sleep -Milliseconds 100
}
throw 'The Select Workspace Directory dialog did not close after confirming the folder.'
