param(
  [Parameter(Mandatory = $true)]
  [string]$SetupPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-CheckedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList
  )

  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Process failed with exit code $($process.ExitCode): $FilePath $($ArgumentList -join ' ')"
  }
}

function Invoke-CheckedNsisInstall {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot
  )

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new($FilePath)
  $startInfo.UseShellExecute = $false
  # NSIS requires /D to be the unquoted final parameter. Assigning the raw
  # Arguments string prevents .NET from adding a literal trailing quote when
  # the product directory contains a space.
  $startInfo.Arguments = "/S /D=$InstallRoot"
  $process = [System.Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) {
    throw 'Windows did not start the Setup executable.'
  }
  try {
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      throw "Setup failed with exit code $($process.ExitCode): $FilePath"
    }
  }
  finally {
    $process.Dispose()
  }
}

function Wait-PathRemoved {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
  )

  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ((Test-Path -LiteralPath $LiteralPath) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-Path -LiteralPath $LiteralPath) {
    $remaining = @(Get-ChildItem -LiteralPath $LiteralPath -Recurse -Force -ErrorAction SilentlyContinue |
      Select-Object -First 20 -ExpandProperty FullName)
    $details = if ($remaining.Count -eq 0) { '[empty directory]' } else { $remaining -join '; ' }
    throw "Timed out waiting for uninstall cleanup: $LiteralPath. Remaining: $details"
  }
}

function Invoke-IsolatedUninstall {
  param(
    [Parameter(Mandatory = $true)]
    [string]$InstalledUninstaller,
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [Parameter(Mandatory = $true)]
    [string]$LauncherPath
  )

  # NSIS normally relaunches an installed uninstaller from a temporary copy.
  # Make that copy explicit so Start-Process waits for the process that performs
  # the deletion, matching electron-builder's own upgrade-uninstall path.
  Copy-Item -LiteralPath $InstalledUninstaller -Destination $LauncherPath -Force
  Invoke-CheckedProcess -FilePath $LauncherPath -ArgumentList @('/S', "_?=$InstallRoot")
}

function Get-IsolatedInstalledProcesses {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
  )

  return @(Get-CimInstance Win32_Process | Where-Object {
    $null -ne $_.ExecutablePath -and $_.ExecutablePath -eq $ExecutablePath
  })
}

function Stop-IsolatedInstalledProcesses {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
  )

  foreach ($process in @(Get-IsolatedInstalledProcesses -ExecutablePath $ExecutablePath)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Get-FileTreeSnapshot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Directory
  )

  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    throw "Expected a recovery directory: $Directory"
  }
  return @(Get-ChildItem -LiteralPath $Directory -Recurse -Force -File |
    Sort-Object -Property FullName |
    ForEach-Object {
      $relative = [System.IO.Path]::GetRelativePath($Directory, $_.FullName).Replace('\', '/')
      $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      "$relative`t$($_.Length)`t$hash"
    })
}

$resolvedSetup = (Resolve-Path -LiteralPath $SetupPath).Path
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
# Match the eight-character default "Programs" parent length. A longer test
# prefix can push otherwise valid unpacked dependency paths beyond legacy NSIS
# cleanup limits and would no longer represent the default per-user install.
$smokeId = 'dh' + [Guid]::NewGuid().ToString('N').Substring(0, 6)
$temporaryRoot = Join-Path $localAppData $smokeId
$installRoot = Join-Path $temporaryRoot 'DeepSeek Harness'
$harnessHome = Join-Path $temporaryRoot 'dsh-home'
$userData = Join-Path $temporaryRoot 'electron-data'
$harnessMarker = Join-Path $harnessHome 'preserve-after-uninstall.txt'
$userDataMarker = Join-Path $userData 'preserve-after-uninstall.txt'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeepSeek Harness.lnk'
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'DeepSeek Harness.lnk'
$uninstaller = $null
$uninstallerLauncher = Join-Path $temporaryRoot 'DeepSeek-Harness-Uninstall-Smoke.exe'
$executable = $null
$installed = $false
$legacyRecoverySnapshot = $null

if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startMenuShortcut)) {
  throw 'Desktop Setup smoke refuses to overwrite an existing DeepSeek Harness shortcut.'
}

try {
  New-Item -ItemType Directory -Path $installRoot, $harnessHome, $userData | Out-Null
  Set-Content -LiteralPath $harnessMarker -Value 'preserve Harness data'
  Set-Content -LiteralPath $userDataMarker -Value 'preserve Electron data'

  Invoke-CheckedNsisInstall -FilePath $resolvedSetup -InstallRoot $installRoot
  $installed = $true

  $executable = Join-Path $installRoot 'DeepSeek Harness.exe'
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Setup did not install the desktop executable: $executable"
  }
  if (-not (Test-Path -LiteralPath $desktopShortcut -PathType Leaf)) {
    throw "Setup did not create the desktop shortcut: $desktopShortcut"
  }
  if (-not (Test-Path -LiteralPath $startMenuShortcut -PathType Leaf)) {
    throw "Setup did not create the Start menu shortcut: $startMenuShortcut"
  }

  $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File)
  if ($uninstallers.Count -ne 1) {
    throw "Setup smoke expected one uninstaller, found $($uninstallers.Count)."
  }
  $uninstaller = $uninstallers[0].FullName

  $env:DSH_WINDOWS_DESKTOP_EXECUTABLE = $executable
  $env:DSH_DESKTOP_SMOKE_ROOT = $temporaryRoot
  $env:DSH_DESKTOP_SMOKE_DSH_HOME = $harnessHome
  $env:DSH_DESKTOP_SMOKE_USER_DATA = $userData
  & pnpm exec vitest run apps/desktop/tests/windows-packaged-smoke.spec.ts --config vitest.config.ts
  if ($LASTEXITCODE -ne 0) {
    throw "Packaged Windows desktop smoke failed with exit code $LASTEXITCODE."
  }
  $remainingProcesses = @(Get-IsolatedInstalledProcesses -ExecutablePath $executable)
  if ($remainingProcesses.Count -ne 0) {
    throw "Packaged smoke left $($remainingProcesses.Count) installed application process(es) running."
  }
  $legacyRecoveryRoot = Join-Path $harnessHome 'recovery\legacy-module-fallback'
  $legacyRecoverySnapshot = @(Get-FileTreeSnapshot -Directory $legacyRecoveryRoot)
  if ($legacyRecoverySnapshot.Count -eq 0) {
    throw 'Packaged smoke did not preserve the recovered legacy module fallback files.'
  }

  Invoke-IsolatedUninstall -InstalledUninstaller $uninstaller -InstallRoot $installRoot -LauncherPath $uninstallerLauncher
  $installed = $false
  Wait-PathRemoved -LiteralPath $installRoot

  if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startMenuShortcut)) {
    throw 'Uninstall left a DeepSeek Harness shortcut behind.'
  }
  if (-not (Test-Path -LiteralPath $harnessMarker -PathType Leaf)) {
    throw 'Uninstall removed the isolated Harness data marker.'
  }
  if (-not (Test-Path -LiteralPath $userDataMarker -PathType Leaf)) {
    throw 'Uninstall removed the isolated Electron data marker.'
  }
  $legacyRecoveryAfterUninstall = @(Get-FileTreeSnapshot -Directory $legacyRecoveryRoot)
  if (Compare-Object -ReferenceObject $legacyRecoverySnapshot -DifferenceObject $legacyRecoveryAfterUninstall) {
    throw 'Uninstall changed the recovered legacy module fallback files.'
  }

  Write-Host 'Windows desktop Setup smoke passed: install, shortcuts, legacy fallback recovery, launch, close, process cleanup, uninstall, and data preservation.'
}
finally {
  if ($null -ne $executable) {
    Stop-IsolatedInstalledProcesses -ExecutablePath $executable
  }
  if ($installed -and $null -ne $uninstaller -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    try {
      Invoke-IsolatedUninstall -InstalledUninstaller $uninstaller -InstallRoot $installRoot -LauncherPath $uninstallerLauncher
      $installed = $false
      Wait-PathRemoved -LiteralPath $installRoot
    }
    catch {
      Write-Warning "Fallback uninstall failed: $($_.Exception.Message)"
    }
  }
  if (-not $installed -and (Test-Path -LiteralPath $temporaryRoot)) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
