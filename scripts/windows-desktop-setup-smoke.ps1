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
    throw "Timed out waiting for uninstall cleanup: $LiteralPath"
  }
}

$resolvedSetup = (Resolve-Path -LiteralPath $SetupPath).Path
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "dsh-windows-setup-smoke-$([Guid]::NewGuid().ToString('N'))"
$installRoot = Join-Path $temporaryRoot 'application'
$harnessHome = Join-Path $temporaryRoot 'dsh-home'
$userData = Join-Path $temporaryRoot 'electron-data'
$harnessMarker = Join-Path $harnessHome 'preserve-after-uninstall.txt'
$userDataMarker = Join-Path $userData 'preserve-after-uninstall.txt'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeepSeek Harness.lnk'
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'DeepSeek Harness.lnk'
$uninstaller = $null
$installed = $false

if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startMenuShortcut)) {
  throw 'Desktop Setup smoke refuses to overwrite an existing DeepSeek Harness shortcut.'
}

try {
  New-Item -ItemType Directory -Path $installRoot, $harnessHome, $userData | Out-Null
  Set-Content -LiteralPath $harnessMarker -Value 'preserve Harness data'
  Set-Content -LiteralPath $userDataMarker -Value 'preserve Electron data'

  Invoke-CheckedProcess -FilePath $resolvedSetup -ArgumentList @('/S', "/D=$installRoot")
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

  Invoke-CheckedProcess -FilePath $uninstaller -ArgumentList @('/S')
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

  Write-Host 'Windows desktop Setup smoke passed: install, shortcuts, launch, close, process cleanup, uninstall, and data preservation.'
}
finally {
  if ($installed -and $null -ne $uninstaller -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    try {
      Invoke-CheckedProcess -FilePath $uninstaller -ArgumentList @('/S')
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
