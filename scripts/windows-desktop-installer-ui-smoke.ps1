param(
  [Parameter(Mandatory = $true)]
  [string]$SetupPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

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

$resolvedSetup = (Resolve-Path -LiteralPath $SetupPath).Path
$smokeId = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$temporaryRoot = Join-Path $env:RUNNER_TEMP "dsh-installer-ui-$smokeId"
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
  New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new($resolvedSetup)
  $startInfo.UseShellExecute = $false
  [void]$startInfo.ArgumentList.Add('/currentuser')
  [void]$startInfo.ArgumentList.Add("/D=$installRoot")
  $setup = [System.Diagnostics.Process]::Start($startInfo)
  if ($null -eq $setup) {
    throw 'Windows did not start the Setup executable.'
  }
  $script:InstallerProcessId = $setup.Id

  $welcome = Wait-InstallerPage -Pattern 'Welcome to DeepSeek Harness Setup'
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
  if ([IO.Path]::GetFullPath($directoryValue).TrimEnd('\') -ne [IO.Path]::GetFullPath($installRoot).TrimEnd('\')) {
    throw "Destination page did not show the requested path. Expected '$installRoot', found '$directoryValue'."
  }
  Invoke-InstallerButton -Window $destination -NamePattern '^Install$'

  $deadline = [DateTime]::UtcNow.AddMinutes(3)
  $progressObserved = $false
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
      }
      $details = Find-Control -Element $window `
        -ControlType ([System.Windows.Automation.ControlType]::List)
      if ($null -ne $details -or $text -match 'Application files installed|Shortcuts are ready') {
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

  $runCheckbox = Find-Control -Element $finish `
    -ControlType ([System.Windows.Automation.ControlType]::CheckBox) `
    -NamePattern 'Run DeepSeek Harness'
  if ($null -eq $runCheckbox) {
    throw 'The finish page did not expose the Run DeepSeek Harness option.'
  }
  $toggle = $runCheckbox.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) {
    $toggle.Toggle()
  }
  Invoke-InstallerButton -Window $finish -NamePattern '^Finish$'
  if (-not $setup.WaitForExit(30000)) {
    throw 'Setup did not exit after the Finish button was invoked.'
  }

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
