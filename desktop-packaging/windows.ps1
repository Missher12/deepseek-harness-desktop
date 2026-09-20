<#
.SYNOPSIS
Build the official unsigned x64 Setup, or install and validate it on a disposable GitHub Windows runner.
.DESCRIPTION
Package reuses the official build, runtime locks, PNG-to-ICO conversion and NSIS pages.
Verify calls the coordinator-owned smoke.mjs and then uninstalls. No user-machine execution,
signing, publication, historical migration or external plugins are supported.
.EXAMPLE
pwsh -File desktop-packaging/windows.ps1 -Mode Package
.EXAMPLE
pwsh -File desktop-packaging/windows.ps1 -Mode Verify -Setup <absolute.exe> -EvidenceDirectory <new-directory>
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('Package', 'Verify')][string]$Mode,
  [string]$Setup,
  [string]$EvidenceDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This script requires a disposable GitHub-hosted Windows runner.'
}
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') { throw 'Windows x64 is required.' }
$repository = Split-Path $PSScriptRoot -Parent
$desktop = Join-Path $repository 'apps/desktop'
$version = (Get-Content -LiteralPath (Join-Path $repository 'package.json') -Raw | ConvertFrom-Json).version
$source = (& git -C $repository rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $source -notmatch '^[0-9a-f]{40}$') { throw 'Cannot identify source commit.' }
$utf8 = [Text.UTF8Encoding]::new($false)

if ($Mode -eq 'Package') {
  $settings = Join-Path $desktop '.env.windows'
  if (Test-Path -LiteralPath $settings) { throw 'Refusing to overwrite existing Windows packaging settings.' }
  $icon = Join-Path $PSScriptRoot 'icon.png'
  if (-not (Test-Path -LiteralPath $icon -PathType Leaf)) { throw 'Coordinator icon.png is missing.' }
  $destination = Join-Path $desktop 'resources/icon-windows.png'
  $originalIcon = [IO.File]::ReadAllBytes($destination)
  try {
    # The official builder converts this PNG to ICO for the EXE, Setup and uninstaller.
    Copy-Item -LiteralPath $icon -Destination $destination
    [IO.File]::WriteAllText($settings, "DSH_DESKTOP_APP_ID=com.deepseek.harness`nDSH_DESKTOP_AUTO_UPDATE_ENV=production`nDSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN=https://harness.deepseek.com`n", $utf8)
    Push-Location $repository
    try {
      & pnpm run package:desktop:win:x64:unsigned
      if ($LASTEXITCODE -ne 0) { throw 'Official unsigned Windows packaging failed.' }
    } finally { Pop-Location }
  } finally {
    [IO.File]::WriteAllBytes($destination, $originalIcon)
    if (Test-Path -LiteralPath $settings) { Remove-Item -LiteralPath $settings -Force }
  }
  $output = Join-Path $desktop '.desktop-build/targets/win-x64/unsigned-artifacts'
  $installers = @(Get-ChildItem -LiteralPath $output -Filter '*.exe' -File)
  if ($installers.Count -ne 1) { throw 'Expected exactly one unsigned Setup.' }
  $installer = $installers[0]
  $sha = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText(($installer.FullName + '.sha256'), "$sha  $($installer.Name)`n", $utf8)
  Write-Output "SETUP $($installer.Name) $($installer.Length) $sha"
  return
}

if (-not $Setup -or -not [IO.Path]::IsPathFullyQualified($Setup) -or -not (Test-Path -LiteralPath $Setup -PathType Leaf)) {
  throw 'Verify requires an existing absolute Setup path.'
}
if (-not $EvidenceDirectory -or -not [IO.Path]::IsPathFullyQualified($EvidenceDirectory) -or (Test-Path -LiteralPath $EvidenceDirectory)) {
  throw 'Verify requires a new absolute evidence directory.'
}
$setupSha = (Get-FileHash -LiteralPath $Setup -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedChecksum = "$setupSha  $([IO.Path]::GetFileName($Setup))`n"
if ([IO.File]::ReadAllText(($Setup + '.sha256')) -cne $expectedChecksum) {
  throw 'Setup checksum must match the installer bytes and contain one LF-terminated line.'
}
$uninstallRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
foreach ($root in $uninstallRoots) {
  if (-not (Test-Path $root)) { continue }
  foreach ($key in Get-ChildItem $root) {
    $entry = Get-ItemProperty $key.PSPath
    if ($entry.PSObject.Properties['DisplayName'] -and $entry.DisplayName -like '*DeepSeek Harness*') {
      throw 'Refusing to replace an existing Harness installation.'
    }
  }
}
New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null
$scratch = [IO.Directory]::CreateTempSubdirectory('dsh-win-install-').FullName
$installRoot = Join-Path $scratch 'application'
$installedExe = Join-Path $installRoot 'DeepSeek Harness.exe'
$prefix = $installRoot.TrimEnd('\') + '\'
$owned = @{}
$report = [ordered]@{
  schemaVersion = 1; source = $source; version = $version; platform = 'win32'; arch = 'x64'; unsigned = $true
  setup = [IO.Path]::GetFileName($Setup); bytes = (Get-Item -LiteralPath $Setup).Length
  sha256 = $setupSha
  installed = $false; smoke = $false; uninstalled = $false; remainingProcesses = -1
  timedOut = $false; forcedCleanup = $false; stage = 'install'; failureStage = $null
}

function Get-OwnedProcesses {
  $rows = @(Get-CimInstance Win32_Process)
  do {
    $before = $owned.Count
    foreach ($row in $rows) {
      $parent = $owned[[int]$row.ParentProcessId]
      if (($null -ne $parent -and $row.CreationDate -ge $parent) -or
          ($row.ExecutablePath -and $row.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase))) {
        $owned[[int]$row.ProcessId] = $row.CreationDate
      }
    }
  } while ($before -ne $owned.Count)
  @($rows | Where-Object { $owned.ContainsKey([int]$_.ProcessId) -and $owned[[int]$_.ProcessId] -eq $_.CreationDate })
}

function Invoke-Bounded([string]$File, [string]$Arguments, [int]$Seconds) {
  if (-not [IO.Path]::IsPathFullyQualified($File) -or -not (Test-Path -LiteralPath $File -PathType Leaf)) {
    throw "Executable is not an existing absolute file during $($report.stage)."
  }
  Write-Output "Starting $($report.stage): $([IO.Path]::GetFileName($File))"
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -NoNewWindow
  $identity = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
  if ($identity) { $owned[[int]$process.Id] = $identity.CreationDate }
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  while (-not $process.WaitForExit(500)) {
    $null = Get-OwnedProcesses
    if ([DateTime]::UtcNow -ge $deadline) {
      $report.timedOut = $true
      throw "Timed out during $($report.stage)."
    }
  }
  $process.WaitForExit()
  $null = Get-OwnedProcesses
  if ($process.ExitCode -ne 0) { throw "$($report.stage) exited with code $($process.ExitCode)." }
}

function Resolve-NodeExecutable {
  $command = Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $executable = $command.Source
  if (-not [IO.Path]::IsPathFullyQualified($executable) -or -not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw 'Selected Node executable is not an existing absolute file.'
  }
  return $executable
}

$primaryFailure = $null
$cleanupFailure = $null
try {
  # /D must be the final NSIS argument, without quotes, even when it contains spaces.
  Invoke-Bounded $Setup "/S /currentuser /D=$installRoot" 900
  if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) { throw 'Installed executable is missing.' }
  $report.installed = $true
  $report.stage = 'smoke'
  $node = Resolve-NodeExecutable
  $smoke = Join-Path $PSScriptRoot 'smoke.mjs'
  if (-not (Test-Path -LiteralPath $smoke -PathType Leaf)) { throw 'Shared smoke entry is missing.' }
  $uiEvidence = Join-Path $EvidenceDirectory 'ui'
  Invoke-Bounded $node "`"$smoke`" `"$installedExe`" `"$uiEvidence`"" 360
  & $node (Join-Path $PSScriptRoot 'windows-evidence.mjs') (Join-Path $uiEvidence 'smoke.json') $version
  if ($LASTEXITCODE -ne 0) { throw 'Installed Windows smoke receipt was not accepted.' }
  $report.smoke = $true
} catch {
  $report.failureStage = $report.stage
  $primaryFailure = $_
} finally {
  try {
  # Forced teardown is failure cleanup, never evidence of a successful ordinary exit.
  foreach ($row in @(Get-OwnedProcesses)) {
    $report.forcedCleanup = $true
    Stop-Process -Id $row.ProcessId -Force -ErrorAction SilentlyContinue
  }
  try {
    $report.stage = 'uninstall'
    if (Test-Path -LiteralPath $installRoot) {
      $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File)
      if ($uninstallers.Count -ne 1) { throw 'Expected exactly one installed uninstaller.' }
      Invoke-Bounded $uninstallers[0].FullName '/S' 180
      $deadline = [DateTime]::UtcNow.AddSeconds(90)
      do {
        $remaining = @(Get-OwnedProcesses)
        $filesRemain = (Test-Path -LiteralPath $installRoot) -and (@(Get-ChildItem -LiteralPath $installRoot -Force).Count -gt 0)
        if (-not $filesRemain -and $remaining.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
      } while ([DateTime]::UtcNow -lt $deadline)
      if ($filesRemain -or $remaining.Count -ne 0) { throw 'Uninstall left application files or owned processes.' }
      $report.uninstalled = $true
    }
  } catch {
    if ($null -eq $report.failureStage) { $report.failureStage = $report.stage }
    throw
  } finally {
    foreach ($row in @(Get-OwnedProcesses)) {
      $report.forcedCleanup = $true
      Stop-Process -Id $row.ProcessId -Force -ErrorAction SilentlyContinue
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
      $remaining = @(Get-OwnedProcesses)
      if ($remaining.Count -eq 0) { break }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    $report.remainingProcesses = $remaining.Count
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'windows-install.json'), (($report | ConvertTo-Json -Depth 4) + "`n"), $utf8)
  }
  } catch {
    $cleanupFailure = $_
  }
}
if ($null -ne $primaryFailure) { throw $primaryFailure }
if ($null -ne $cleanupFailure) { throw $cleanupFailure }
if (-not $report.installed -or -not $report.smoke -or -not $report.uninstalled -or
    $report.remainingProcesses -ne 0 -or $report.timedOut -or $report.forcedCleanup) {
  throw 'Windows installation lifecycle did not complete cleanly.'
}
Write-Output "Windows x64 ${version}: installed, official UI ready, exited, uninstalled."
