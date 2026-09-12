Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$candidate = Join-Path $env:RUNNER_TEMP 'picker-candidate'
$evidence = [System.IO.Path]::GetFullPath('apps/desktop/release/picker-diagnostic')
$temporaryRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('dp' + [Guid]::NewGuid().ToString('N').Substring(0, 6))
$installRoot = Join-Path $temporaryRoot 'DeepSeek Harness'
$executable = Join-Path $installRoot 'DeepSeek Harness.exe'
$generated = [System.IO.Path]::GetFullPath('apps/desktop/tests/picker-diagnostic-generated.spec.ts')
$failure = $null
$cleanupFailure = $null
$phase = 'verify-candidate'
$driverExit = $null
$uninstalled = $false
$emergencyProcesses = 0
$remainingProcesses = $null

function Invoke-BoundedInstaller {
  param([string]$FilePath, [string]$Arguments)
  $info = [System.Diagnostics.ProcessStartInfo]::new($FilePath)
  $info.UseShellExecute = $false
  $info.Arguments = $Arguments
  $process = [System.Diagnostics.Process]::Start($info)
  if ($null -eq $process) { throw 'Installer process was not created.' }
  try {
    if (-not $process.WaitForExit(120000)) { $process.Kill($true); [void]$process.WaitForExit(10000); throw 'Installer exceeded its diagnostic deadline.' }
    if ($process.ExitCode -ne 0) { throw 'Installer returned a failure.' }
  } finally { $process.Dispose() }
}

New-Item -ItemType Directory -Path $evidence, $temporaryRoot | Out-Null
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $candidate 'candidate.zip'))
  try {
    $allowed = @('DeepSeek-Harness-Setup-0.5.8-win-x64.exe', 'DeepSeek-Harness-Setup-0.5.8-win-x64.exe.sha256')
    if ($zip.Entries.Count -ne 2) { throw 'Unexpected candidate archive members.' }
    foreach ($entry in $zip.Entries) {
      if ($entry.FullName -cnotin $allowed) { throw 'Unexpected candidate archive member.' }
      # No archive-controlled directories, existing destinations, or links are admitted.
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $candidate $entry.FullName), $false)
    }
  } finally { $zip.Dispose() }
  foreach ($file in $allowed) {
    if ((Get-Item -LiteralPath (Join-Path $candidate $file)).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Candidate file is a reparse point.' }
  }
  $artifactReceipt = node scripts/windows-picker-diagnostic-artifact.mjs verify $candidate
  if ($LASTEXITCODE -ne 0) { throw 'Setup bytes or checksum did not match.' }
  [System.IO.File]::WriteAllText((Join-Path $evidence 'artifact.json'), ($artifactReceipt + "`n"), [System.Text.UTF8Encoding]::new($false))
  $phase = 'install'
  Invoke-BoundedInstaller (Join-Path $candidate $allowed[0]) "/S /D=$installRoot"
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Installed executable missing.' }
  $phase = 'prepare-driver'
  $env:DSH_WINDOWS_DESKTOP_EXECUTABLE = $executable
  $env:DSH_DESKTOP_SMOKE_ROOT = $temporaryRoot
  $env:DSH_DESKTOP_SMOKE_DSH_HOME = Join-Path $temporaryRoot 'dsh-home'
  $env:DSH_DESKTOP_SMOKE_USER_DATA = Join-Path $temporaryRoot 'electron-data'
  $env:DSH_PICKER_CONTROL = Join-Path $temporaryRoot 'control'
  $env:DSH_PICKER_EVIDENCE = $evidence
  $env:DSH_TELEMETRY_DISABLED = '1'
  $env:NODE_OPTIONS = ''
  $env:NODE_PATH = ''
  foreach ($variable in @(Get-ChildItem Env: | Where-Object { $_.Name -match 'KEY|SECRET|TOKEN|PASSWORD' })) {
    Remove-Item -LiteralPath ('Env:' + $variable.Name)
  }
  New-Item -ItemType Directory -Path $env:DSH_PICKER_CONTROL | Out-Null
  node scripts/windows-picker-diagnostic-driver.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Pinned fixture preparation failed.' }
  $phase = 'native-picker'
  # Only this temporary prefix is executed; no staging, compiler, builder or full suite.
  pnpm exec vitest run apps/desktop/tests/picker-diagnostic-generated.spec.ts --config vitest.config.ts --reporter=dot
  $driverExit = $LASTEXITCODE
  if ($driverExit -ne 0) { throw 'Bounded native picker diagnostic failed.' }
  $phase = 'complete'
} catch {
  $failure = $_.Exception.GetBaseException().GetType().Name
} finally {
  try {
    # Rescue only an executable physically inside this invocation's fresh install root.
    foreach ($row in @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $executable })) {
      $process = $null
      try {
        $process = [System.Diagnostics.Process]::GetProcessById([int]$row.ProcessId)
        [void]$process.Handle
        if ($process.MainModule.FileName -ine $executable) { throw 'Cleanup executable ownership changed.' }
        $process.Kill($true)
        $emergencyProcesses += 1
        [void]$process.WaitForExit(10000)
      } finally { if ($null -ne $process) { $process.Dispose() } }
    }
    $remainingProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $executable }).Count
    $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue)
    if ($uninstallers.Count -eq 1) {
      $launcher = Join-Path $temporaryRoot 'diagnostic-uninstall.exe'
      Copy-Item -LiteralPath $uninstallers[0].FullName -Destination $launcher
      Invoke-BoundedInstaller $launcher "/S _?=$installRoot"
      $uninstalled = -not (Test-Path -LiteralPath $executable)
    }
    if (Test-Path -LiteralPath $generated) { Remove-Item -LiteralPath $generated }
  } catch { $cleanupFailure = $_.Exception.GetBaseException().GetType().Name }
  [System.IO.File]::WriteAllText((Join-Path $evidence 'runner.json'), (([ordered]@{
    schemaVersion = 1; productSourceSha = '5a17c6b29971b6034929bb8a13e3b11cdc4748e8'; diagnosticOnly = $true
    diagnosticSourceSha = $env:DSH_PICKER_DIAGNOSTIC_SHA
    phase = $phase; failure = $failure; driverExit = $driverExit; cleanupFailure = $cleanupFailure
    emergencyProcesses = $emergencyProcesses; remainingInstalledProcesses = $remainingProcesses; uninstalled = $uninstalled
    isolatedDataRetained = (Test-Path -LiteralPath (Join-Path $temporaryRoot 'dsh-home'))
  } | ConvertTo-Json) + "`n"), [System.Text.UTF8Encoding]::new($false))
}
if ($null -ne $failure -or $null -ne $cleanupFailure -or $emergencyProcesses -gt 0 -or $remainingProcesses -ne 0 -or -not $uninstalled) {
  throw 'Diagnostic or cleanup incomplete; inspect bounded receipts. No retry is authorized.'
}
