param(
  [Parameter(Mandatory = $true)]
  [string]$SetupPath,
  [string]$StartupSummaryPath = 'apps/desktop/release/desktop-startup-summary.json',
  [string]$PackageInventoryPath = 'apps/desktop/release/desktop-package-installed.json',
  [string]$InstallationEvidencePath = 'apps/desktop/release/desktop-windows-install-evidence.json',
  [string]$VisualEvidenceRoot = 'apps/desktop/release/windows-native-visual-evidence',
  [ValidateSet('windows-x64')]
  [string]$PackagePolicy,
  [string]$PackageManifestPath,
  [switch]$RuntimeEvidenceOnly
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

function Wait-IsolatedInstalledProcessesStopped {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
  )

  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $remaining = @(Get-IsolatedInstalledProcesses -ExecutablePath $ExecutablePath)
  while ($remaining.Count -ne 0 -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $remaining = @(Get-IsolatedInstalledProcesses -ExecutablePath $ExecutablePath)
  }
  if ($remaining.Count -ne 0) {
    throw "Desktop startup sample left $($remaining.Count) installed process(es) running."
  }
}

function Assert-ManagedPackageRootsPhysical {
  param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath
  )

  $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
  $names = @($manifest.dependencies.PSObject.Properties.Name)
  $optionalDependencies = $manifest.PSObject.Properties['optionalDependencies']
  if ($null -ne $optionalDependencies -and $null -ne $optionalDependencies.Value) {
    $names += @($optionalDependencies.Value.PSObject.Properties.Name)
  }
  $unpackedModules = Join-Path $InstallRoot 'resources\app.asar.unpacked\node_modules'
  foreach ($name in @($names | Sort-Object -Unique)) {
    $packageRoot = Join-Path $unpackedModules ($name.Replace('/', '\'))
    $packageManifest = Join-Path $packageRoot 'package.json'
    if (-not (Test-Path -LiteralPath $packageManifest -PathType Leaf)) {
      throw "Managed package is missing from physical app.asar.unpacked: $name"
    }
    $packageDirectory = Get-Item -LiteralPath $packageRoot -Force
    if (($packageDirectory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Managed package root must not be a reparse point in app.asar.unpacked: $name"
    }
  }
}

function Get-InstalledShortcutEvidence {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ShortcutPath,
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,
    [Parameter(Mandatory = $true)]
    [string]$Location
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $null
  try {
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $resolvedExecutable = [System.IO.Path]::GetFullPath($ExecutablePath)
    $resolvedTarget = [System.IO.Path]::GetFullPath([string]$shortcut.TargetPath)
    if ($resolvedTarget -ne $resolvedExecutable) {
      throw "Shortcut target mismatch at ${Location}: expected the installed executable."
    }

    $iconLocation = [string]$shortcut.IconLocation
    $iconMatch = [regex]::Match($iconLocation, '^(?<path>.*),(?<index>-?\d+)$')
    if (-not $iconMatch.Success) {
      throw "Shortcut icon location is malformed at ${Location}."
    }
    $iconPath = $iconMatch.Groups['path'].Value.Trim().Trim('"')
    $resolvedIcon = [System.IO.Path]::GetFullPath($iconPath)
    if ($resolvedIcon -ne $resolvedExecutable) {
      throw "Shortcut icon must resolve to the installed executable at ${Location}."
    }

    return [ordered]@{
      location = $Location
      target = [System.IO.Path]::GetFileName($resolvedTarget)
      icon = [System.IO.Path]::GetFileName($resolvedIcon)
      iconIndex = [int]$iconMatch.Groups['index'].Value
    }
  }
  finally {
    if ($null -ne $shortcut) {
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
    }
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
  }
}

function Write-InstalledPackageEvidence {
  param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [Parameter(Mandatory = $true)]
    [string]$InventoryPath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,
    [Parameter(Mandatory = $true)]
    [object[]]$Shortcuts
  )

  $resolvedInventory = [System.IO.Path]::GetFullPath($InventoryPath)
  $inventoryDocument = Get-Content -LiteralPath $resolvedInventory -Raw | ConvertFrom-Json
  $physicalBytes = [long]0
  $physicalFiles = 0
  foreach ($file in @(Get-ChildItem -LiteralPath $InstallRoot -Recurse -Force -File)) {
    $physicalBytes += [long]$file.Length
    $physicalFiles += 1
  }
  if ($physicalBytes -ne [long]$inventoryDocument.totalBytes) {
    throw "Installed tree byte mismatch: filesystem=$physicalBytes inventory=$($inventoryDocument.totalBytes)."
  }
  if ($physicalFiles -ne @($inventoryDocument.files).Count) {
    throw "Installed tree file-count mismatch: filesystem=$physicalFiles inventory=$(@($inventoryDocument.files).Count)."
  }

  $evidence = [ordered]@{
    schemaVersion = 1
    installedBytes = $physicalBytes
    installedFiles = $physicalFiles
    inventorySha256 = (Get-FileHash -LiteralPath $resolvedInventory -Algorithm SHA256).Hash.ToLowerInvariant()
    categories = $inventoryDocument.categories
    shortcuts = $Shortcuts
  }
  $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutput) | Out-Null
  [System.IO.File]::WriteAllText(
    $resolvedOutput,
    (($evidence | ConvertTo-Json -Depth 10) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Invoke-DesktopStartupSample {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,
    [Parameter(Mandatory = $true)]
    [string]$HarnessHome,
    [Parameter(Mandatory = $true)]
    [string]$UserData,
    [Parameter(Mandatory = $true)]
    [string]$EvidenceRoot,
    [Parameter(Mandatory = $true)]
    [string]$SampleKind,
    [Parameter(Mandatory = $true)]
    [int]$SampleIndex
  )

  New-Item -ItemType Directory -Force -Path $HarnessHome, $UserData, $EvidenceRoot | Out-Null
  $lifecyclePath = Join-Path $UserData 'logs\lifecycle.log'
  if (Test-Path -LiteralPath $lifecyclePath) {
    Remove-Item -LiteralPath $lifecyclePath -Force
  }

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new($ExecutablePath)
  $startInfo.UseShellExecute = $false
  $startInfo.WorkingDirectory = Split-Path -Parent $ExecutablePath
  $startInfo.ArgumentList.Add("--user-data-dir=$UserData")
  $startInfo.Environment['DSH_HOME'] = $HarnessHome
  $startInfo.Environment['DSH_TELEMETRY_DISABLED'] = '1'
  $process = [System.Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) {
    throw "Windows did not start Desktop startup sample $SampleKind-$SampleIndex."
  }

  try {
    $startupDeadline = [DateTime]::UtcNow.AddSeconds(120)
    $running = $false
    while (-not $running -and [DateTime]::UtcNow -lt $startupDeadline) {
      if ($process.HasExited) {
        throw "Desktop startup sample $SampleKind-$SampleIndex exited before desktop-running."
      }
      if (Test-Path -LiteralPath $lifecyclePath -PathType Leaf) {
        $running = [bool](Select-String -LiteralPath $lifecyclePath -Quiet -Pattern ' startup desktop-running: [0-9]+ms$')
      }
      if (-not $running) {
        Start-Sleep -Milliseconds 250
      }
    }
    if (-not $running) {
      throw "Desktop startup sample $SampleKind-$SampleIndex missed its startup deadline."
    }

    if (-not $process.CloseMainWindow()) {
      throw "Desktop startup sample $SampleKind-$SampleIndex did not expose a closable native window."
    }
    if (-not $process.WaitForExit(60000)) {
      throw "Desktop startup sample $SampleKind-$SampleIndex did not exit after native close."
    }
    Wait-IsolatedInstalledProcessesStopped -ExecutablePath $ExecutablePath

    $startupPattern = '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z startup (app-ready|window-prerequisites|loading-visible|fallback-ready|url-reported|harness-ready|desktop-running): [0-9]+ms$'
    $runtimePattern = '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z runtime (profile-compose|loader-mount|loader-settle|activation-audit): [0-9]+ms$'
    $startupLines = @(Get-Content -LiteralPath $lifecyclePath | Where-Object {
      $_ -match $startupPattern -or $_ -match $runtimePattern
    })
    $sampleLog = Join-Path $EvidenceRoot "$SampleKind-$SampleIndex.log"
    [System.IO.File]::WriteAllLines($sampleLog, $startupLines, [System.Text.UTF8Encoding]::new($false))
    return $sampleLog
  }
  finally {
    if (-not $process.HasExited) {
      Stop-IsolatedInstalledProcesses -ExecutablePath $ExecutablePath
    }
    $process.Dispose()
  }
}

function Write-DesktopRuntimeEvidence {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,
    [Parameter(Mandatory = $true)]
    [string]$TemporaryRoot,
    [Parameter(Mandatory = $true)]
    [string]$SummaryPath,
    [Parameter(Mandatory = $true)]
    [string]$InventoryPath,
    [string]$PackagePolicy,
    [string]$PackageManifestPath
  )

  $summary = [System.IO.Path]::GetFullPath($SummaryPath)
  $inventory = [System.IO.Path]::GetFullPath($InventoryPath)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $summary), (Split-Path -Parent $inventory) | Out-Null
  $benchmarkRoot = Join-Path $TemporaryRoot 'startup-benchmark'
  $evidenceRoot = Join-Path $benchmarkRoot 'fixed-milestones'
  $warmHome = Join-Path $benchmarkRoot 'warm\dsh-home'
  $warmUserData = Join-Path $benchmarkRoot 'warm\electron-data'

  Invoke-DesktopStartupSample -ExecutablePath $ExecutablePath -HarnessHome $warmHome -UserData $warmUserData -EvidenceRoot $evidenceRoot -SampleKind 'warm-prime' -SampleIndex 0 | Out-Null
  $logs = @{ cold = [System.Collections.Generic.List[string]]::new(); warm = [System.Collections.Generic.List[string]]::new() }
  foreach ($sampleKind in @('cold', 'warm')) {
    for ($sampleIndex = 1; $sampleIndex -le 5; $sampleIndex += 1) {
      if ($sampleKind -eq 'cold') {
        $sampleRoot = Join-Path $benchmarkRoot "cold-$sampleIndex"
        $sampleHome = Join-Path $sampleRoot 'dsh-home'
        $sampleUserData = Join-Path $sampleRoot 'electron-data'
      }
      else {
        $sampleHome = $warmHome
        $sampleUserData = $warmUserData
      }
      $sampleLog = Invoke-DesktopStartupSample -ExecutablePath $ExecutablePath -HarnessHome $sampleHome -UserData $sampleUserData -EvidenceRoot $evidenceRoot -SampleKind $sampleKind -SampleIndex $sampleIndex
      $logs[$sampleKind].Add($sampleLog)
    }
  }

  $coldSummary = Join-Path $benchmarkRoot 'cold-summary.json'
  $warmSummary = Join-Path $benchmarkRoot 'warm-summary.json'
  & pnpm --filter '@deepseek-ai/dsh-desktop' run benchmark:startup -- --output $coldSummary @($logs.cold)
  if ($LASTEXITCODE -ne 0) { throw "Cold startup benchmark failed with exit code $LASTEXITCODE." }
  & pnpm --filter '@deepseek-ai/dsh-desktop' run benchmark:startup -- --output $warmSummary @($logs.warm)
  if ($LASTEXITCODE -ne 0) { throw "Warm startup benchmark failed with exit code $LASTEXITCODE." }
  $combined = [ordered]@{
    schemaVersion = 1
    cold = Get-Content -LiteralPath $coldSummary -Raw | ConvertFrom-Json
    warm = Get-Content -LiteralPath $warmSummary -Raw | ConvertFrom-Json
  }
  [System.IO.File]::WriteAllText(
    $summary,
    (($combined | ConvertTo-Json -Depth 20) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )

  $inventoryArguments = @('--output', $inventory)
  if (-not [string]::IsNullOrEmpty($PackagePolicy)) {
    if ([string]::IsNullOrEmpty($PackageManifestPath)) {
      throw 'PackageManifestPath is required when PackagePolicy is set.'
    }
    $resolvedManifest = [System.IO.Path]::GetFullPath($PackageManifestPath)
    $inventoryArguments += @('--policy', $PackagePolicy, '--manifest', $resolvedManifest)
  }
  $inventoryArguments += (Split-Path -Parent $ExecutablePath)
  & pnpm --filter '@deepseek-ai/dsh-desktop' run inventory:package -- @inventoryArguments
  if ($LASTEXITCODE -ne 0) { throw "Installed package inventory failed with exit code $LASTEXITCODE." }
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
$legacyRecoveryRoot = $null

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

  if (-not [string]::IsNullOrEmpty($PackagePolicy)) {
    $resolvedPackageManifest = [System.IO.Path]::GetFullPath($PackageManifestPath)
    Assert-ManagedPackageRootsPhysical -InstallRoot $installRoot -ManifestPath $resolvedPackageManifest
  }

  Write-DesktopRuntimeEvidence `
    -ExecutablePath $executable `
    -TemporaryRoot $temporaryRoot `
    -SummaryPath $StartupSummaryPath `
    -InventoryPath $PackageInventoryPath `
    -PackagePolicy $PackagePolicy `
    -PackageManifestPath $PackageManifestPath

  $shortcutEvidence = @(
    Get-InstalledShortcutEvidence -ShortcutPath $desktopShortcut -ExecutablePath $executable -Location 'desktop'
    Get-InstalledShortcutEvidence -ShortcutPath $startMenuShortcut -ExecutablePath $executable -Location 'start-menu'
  )
  Write-InstalledPackageEvidence `
    -InstallRoot $installRoot `
    -InventoryPath $PackageInventoryPath `
    -OutputPath $InstallationEvidencePath `
    -Shortcuts $shortcutEvidence

  if (-not $RuntimeEvidenceOnly) {
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

    $powerShell = (Get-Process -Id $PID).Path
    $visualSmoke = './scripts/windows-desktop-native-visual-smoke.ps1'
    foreach ($dpiPercent in @(100, 150)) {
      & $powerShell -NoLogo -NoProfile -File $visualSmoke `
        -ExecutablePath $executable `
        -HarnessHome (Join-Path $temporaryRoot "visual-dsh-home-$dpiPercent") `
        -UserData (Join-Path $temporaryRoot "visual-electron-data-$dpiPercent") `
        -DesktopShortcut $desktopShortcut `
        -StartMenuShortcut $startMenuShortcut `
        -EvidenceRoot $VisualEvidenceRoot `
        -DpiPercent $dpiPercent
      if ($LASTEXITCODE -ne 0) {
        throw "Native Windows $dpiPercent percent visual smoke failed with exit code $LASTEXITCODE."
      }
    }
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
  if (-not $RuntimeEvidenceOnly) {
    $legacyRecoveryAfterUninstall = @(Get-FileTreeSnapshot -Directory $legacyRecoveryRoot)
    if (Compare-Object -ReferenceObject $legacyRecoverySnapshot -DifferenceObject $legacyRecoveryAfterUninstall) {
      throw 'Uninstall changed the recovered legacy module fallback files.'
    }
  }

  if ($RuntimeEvidenceOnly) {
    Write-Host 'Windows desktop runtime evidence passed: install, five cold and warm launches, process cleanup, uninstall, and data preservation.'
  }
  else {
    Write-Host 'Windows desktop Setup smoke passed: install, shortcuts, legacy fallback recovery, launch, close, process cleanup, uninstall, and data preservation.'
  }
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
