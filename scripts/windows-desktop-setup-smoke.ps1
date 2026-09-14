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
  [string]$SmokeDescriptorPath,
  [string]$LegacyRuntimeInputPath,
  [switch]$RuntimeEvidenceOnly,
  [switch]$HistoricalBaselineInventory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $RuntimeEvidenceOnly -and [string]::IsNullOrEmpty($SmokeDescriptorPath)) {
  throw 'Base smoke requires a prepare/stage descriptor.'
}
if (-not $RuntimeEvidenceOnly -and (
  [string]::IsNullOrEmpty($LegacyRuntimeInputPath) -or
  -not (Test-Path -LiteralPath $LegacyRuntimeInputPath -PathType Leaf)
)) { throw 'Core acceptance requires an explicit verified Windows 0.5.5 runtime input.' }
$resolvedSmokeDescriptor = $null
if (-not $RuntimeEvidenceOnly) {
  if (-not (Test-Path -LiteralPath $SmokeDescriptorPath -PathType Leaf)) {
    throw 'Base smoke descriptor is missing.'
  }
  $resolvedSmokeDescriptor = (Resolve-Path -LiteralPath $SmokeDescriptorPath).Path
}

if ($HistoricalBaselineInventory -and (
  -not $RuntimeEvidenceOnly -or
  -not [string]::IsNullOrEmpty($PackagePolicy) -or
  -not [string]::IsNullOrEmpty($PackageManifestPath)
)) {
  throw 'HistoricalBaselineInventory requires RuntimeEvidenceOnly without a candidate policy or manifest.'
}

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
    [string]$ManifestPath,
    [Parameter(Mandatory = $true)]
    [string]$DescriptorPath,
    [Parameter(Mandatory = $true)]
    [string]$InventoryPath
  )

  $resolvedManifest = [System.IO.Path]::GetFullPath($ManifestPath)
  $resolvedDescriptor = [System.IO.Path]::GetFullPath($DescriptorPath)
  $inventoryArguments = @(
    '--output', [System.IO.Path]::GetFullPath($InventoryPath),
    '--composition', 'base', '--descriptor', $resolvedDescriptor,
    '--policy', 'windows-x64', '--manifest', $resolvedManifest,
    $InstallRoot
  )
  & pnpm --filter '@deepseek-ai/dsh-desktop' run inventory:package @inventoryArguments
  if ($LASTEXITCODE -ne 0) { throw 'Installed base runtime failed its shared physical inventory validation.' }
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
    $runtimePattern = '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z runtime (profile-compose|loader-mount|loader-settle|activation-audit|loader-build-duration|root-include-duration|first-party-import-duration|root-activation-duration|settle-duration|audit-duration): [0-9]+ms$'
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
    [string]$PackageManifestPath,
    [switch]$HistoricalBaselineInventory
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
    for ($sampleIndex = 1; $sampleIndex -le 10; $sampleIndex += 1) {
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
  & pnpm --filter '@deepseek-ai/dsh-desktop' run benchmark:startup --output $coldSummary @($logs.cold)
  if ($LASTEXITCODE -ne 0) { throw "Cold startup benchmark failed with exit code $LASTEXITCODE." }
  & pnpm --filter '@deepseek-ai/dsh-desktop' run benchmark:startup --output $warmSummary @($logs.warm)
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
  if ($HistoricalBaselineInventory) {
    $inventoryArguments += '--historical-baseline'
  }
  if (-not [string]::IsNullOrEmpty($PackagePolicy)) {
    if ([string]::IsNullOrEmpty($PackageManifestPath)) {
      throw 'PackageManifestPath is required when PackagePolicy is set.'
    }
    $resolvedManifest = [System.IO.Path]::GetFullPath($PackageManifestPath)
    $inventoryArguments += @('--policy', $PackagePolicy, '--manifest', $resolvedManifest)
    if ([string]::IsNullOrEmpty($resolvedSmokeDescriptor)) { throw 'Candidate inventory requires the base descriptor.' }
    $resolvedDescriptor = $resolvedSmokeDescriptor
    $inventoryArguments += @('--composition', 'base', '--descriptor', $resolvedDescriptor)
  }
  $inventoryArguments += (Split-Path -Parent $ExecutablePath)
  & pnpm --filter '@deepseek-ai/dsh-desktop' run inventory:package @inventoryArguments
  if ($LASTEXITCODE -ne 0) { throw "Installed package inventory failed with exit code $LASTEXITCODE." }
}

function Get-BaseProtectedSnapshot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root
  )

  $rootPath = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  $prefix = $rootPath + [System.IO.Path]::DirectorySeparatorChar
  $inputPath = Join-Path $rootPath 'base-protected-paths.json'
  $inputItem = Get-Item -LiteralPath $inputPath -Force
  if ($inputItem.PSIsContainer -or ($inputItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Base protection input must be a physical file.'
  }
  $inputRecord = Get-Content -LiteralPath $inputPath -Raw | ConvertFrom-Json
  $fields = @($inputRecord.PSObject.Properties.Name | Sort-Object) -join ','
  if ($fields -cne 'composition,protectedPaths,schemaVersion' -or $inputRecord.schemaVersion -ne 1 -or
    $inputRecord.composition -cne 'base' -or $inputRecord.protectedPaths -isnot [array] -or
    @($inputRecord.protectedPaths).Count -eq 0) {
    throw 'Invalid base protected file list.'
  }
  $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $snapshot = @()
  foreach ($path in (@($inputRecord.protectedPaths) + @($inputPath))) {
    if ($path -isnot [string] -or -not [System.IO.Path]::IsPathRooted($path)) {
      throw 'Base protected file must have an absolute owned path.'
    }
    $fullPath = [System.IO.Path]::GetFullPath($path)
    if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($fullPath)) {
      throw 'Base protected file is outside its owner or duplicated.'
    }
    $item = Get-Item -LiteralPath $fullPath -Force
    if ($item.PSIsContainer) { throw 'Base protected data must be a file.' }
    $current = $item
    while ($null -ne $current) {
      if (($current.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Base protected file or ancestor is a reparse point.'
      }
      if ($current.FullName -ieq $rootPath) { break }
      $current = if ($current.PSIsContainer) { $current.Parent } else { $current.Directory }
    }
    if ($null -eq $current) { throw 'Base protected file owner was not reached.' }
    $hash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $snapshot += $fullPath.Substring($prefix.Length) + ':' + $hash
  }
  return @($snapshot | Sort-Object)
}

$resolvedSetup = (Resolve-Path -LiteralPath $SetupPath).Path
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
# Match the eight-character default "Programs" parent length. A longer test
# prefix can push otherwise valid unpacked dependency paths beyond legacy NSIS
# cleanup limits and would no longer represent the default per-user install.
$smokeId = 'dh' + [Guid]::NewGuid().ToString('N').Substring(0, 6)
$temporaryRoot = Join-Path $localAppData $smokeId
$installRoot = Join-Path $temporaryRoot 'DeepSeek Harness'
$harnessHome = if ($RuntimeEvidenceOnly) { Join-Path $temporaryRoot 'dsh-home' } else { Join-Path $temporaryRoot 'home\.dsh' }
$userData = Join-Path $temporaryRoot 'electron-data'
$harnessMarker = Join-Path $harnessHome 'preserve-after-uninstall.txt'
$userDataMarker = Join-Path $userData 'preserve-after-uninstall.txt'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeepSeek Harness.lnk'
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'DeepSeek Harness.lnk'
$uninstaller = $null
$uninstallerLauncher = Join-Path $temporaryRoot 'DeepSeek-Harness-Uninstall-Smoke.exe'
$executable = $null
$installed = $false
$baseProtectedBefore = $null
$previousSmokeDescriptor = [System.Environment]::GetEnvironmentVariable('DSH_DESKTOP_SMOKE_DESCRIPTOR')
$previousLegacyFixture = [System.Environment]::GetEnvironmentVariable('DSH_DESKTOP_SMOKE_LEGACY_FIXTURE')

if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startMenuShortcut)) {
  throw 'Desktop Setup smoke refuses to overwrite an existing DeepSeek Harness shortcut.'
}

try {
  if (-not $RuntimeEvidenceOnly) {
    & pnpm exec tsx apps/desktop/tests/windows-core-native.ts prepare $LegacyRuntimeInputPath $temporaryRoot
    if ($LASTEXITCODE -ne 0) { throw 'Actual Windows legacy history generation failed.' }
    $env:DSH_DESKTOP_SMOKE_LEGACY_FIXTURE = Join-Path $temporaryRoot 'legacy-fixture.json'
  }
  else { New-Item -ItemType Directory -Path $harnessHome | Out-Null }
  New-Item -ItemType Directory -Path $installRoot, $userData | Out-Null
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
    Assert-ManagedPackageRootsPhysical -InstallRoot $installRoot -ManifestPath $resolvedPackageManifest `
      -DescriptorPath $resolvedSmokeDescriptor -InventoryPath $PackageInventoryPath
  }

  Write-DesktopRuntimeEvidence `
    -ExecutablePath $executable `
    -TemporaryRoot $temporaryRoot `
    -SummaryPath $StartupSummaryPath `
    -InventoryPath $PackageInventoryPath `
    -PackagePolicy $PackagePolicy `
    -PackageManifestPath $PackageManifestPath `
    -HistoricalBaselineInventory:$HistoricalBaselineInventory

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
    $env:DSH_DESKTOP_SMOKE_DESCRIPTOR = $resolvedSmokeDescriptor
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
    $baseProtectedBefore = @(Get-BaseProtectedSnapshot -Root $temporaryRoot)

    # Same built Setup, same isolated installed application; enter at the
    # production native command layer, not a fabricated future update bridge.
    $env:DSH_WINDOWS_UPDATE_HANDOFF = '1'
    $env:DSH_WINDOWS_UPDATE_SETUP = $resolvedSetup
    $env:DSH_WINDOWS_UPDATE_SETUP_SHA256 = (Get-FileHash -LiteralPath $resolvedSetup -Algorithm SHA256).Hash.ToLowerInvariant()
    try {
      & pnpm exec vitest run apps/desktop/tests/windows-update-handoff-smoke.spec.ts --config vitest.config.ts
      if ($LASTEXITCODE -ne 0) { throw 'Installed Windows update handoff smoke failed.' }
    }
    finally {
      Remove-Item Env:DSH_WINDOWS_UPDATE_HANDOFF -ErrorAction SilentlyContinue
      Remove-Item Env:DSH_WINDOWS_UPDATE_SETUP -ErrorAction SilentlyContinue
      Remove-Item Env:DSH_WINDOWS_UPDATE_SETUP_SHA256 -ErrorAction SilentlyContinue
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
    & pnpm exec tsx scripts/verify-desktop-base-smoke.ts `
      --receipt (Join-Path $temporaryRoot 'base-smoke-receipt.json') `
      --descriptor $resolvedSmokeDescriptor `
      --smoke-root $temporaryRoot --platform win32 --scope core
    if ($LASTEXITCODE -ne 0) { throw 'Complete native base receipt validation failed.' }
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
    $baseProtectedAfter = @(Get-BaseProtectedSnapshot -Root $temporaryRoot)
    if (Compare-Object -ReferenceObject $baseProtectedBefore -DifferenceObject $baseProtectedAfter) {
      throw 'Uninstall changed protected base migration or user data.'
    }
  }

  if ($RuntimeEvidenceOnly) {
    Write-Host 'Windows desktop runtime evidence passed: install, ten cold and warm launches, process cleanup, uninstall, and data preservation.'
  }
  else {
    Write-Host 'Windows desktop core smoke passed: base install, historical UI, shortcuts, launch, close, process cleanup, uninstall, and data preservation. Unverified: pauseRecovery.'
  }
}
finally {
  [System.Environment]::SetEnvironmentVariable('DSH_DESKTOP_SMOKE_DESCRIPTOR', $previousSmokeDescriptor)
  [System.Environment]::SetEnvironmentVariable('DSH_DESKTOP_SMOKE_LEGACY_FIXTURE', $previousLegacyFixture)
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
