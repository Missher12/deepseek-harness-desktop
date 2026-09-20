# Native regression: resolve exactly one executable when PATH contains duplicate Node installations.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'This regression requires Windows PowerShell 7.' }
$parseTokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $PSScriptRoot 'windows.ps1'), [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Windows wrapper contains PowerShell parse errors.' }
$definition = $ast.Find({ param($item)
  $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Resolve-NodeExecutable'
}, $false)
if ($null -eq $definition) { throw 'Missing single-executable Node resolver.' }
# Load only the resolver; never execute Package or Verify during this regression.
. ([scriptblock]::Create($definition.Extent.Text))
$scratch = [IO.Directory]::CreateTempSubdirectory('dsh-node-resolution-').FullName
$savedPath = $env:PATH
try {
  $first = Join-Path $scratch 'first node'
  $second = Join-Path $scratch 'second node'
  New-Item -ItemType Directory $first, $second | Out-Null
  [IO.File]::WriteAllBytes((Join-Path $first 'node.exe'), [byte[]]@(77, 90))
  [IO.File]::WriteAllBytes((Join-Path $second 'node.exe'), [byte[]]@(77, 90))
  $env:PATH = "$first;$second"
  $selected = @(Resolve-NodeExecutable)
  if ($selected.Count -ne 1 -or $selected[0] -cne (Join-Path $first 'node.exe')) {
    throw 'Node resolution did not select the first single executable path.'
  }
  $env:PATH = $scratch
  $rejected = $false
  try { $null = Resolve-NodeExecutable } catch { $rejected = $true }
  if (-not $rejected) { throw 'Missing Node was not rejected.' }
} finally {
  $env:PATH = $savedPath
  Remove-Item -LiteralPath $scratch -Recurse -Force
}
# Also execute the actual runner Node selected from the restored PATH, without installation or UI work.
$node = Resolve-NodeExecutable
$output = & $node -p 'process.platform + ":" + process.arch'
if ($LASTEXITCODE -ne 0 -or $output -ne 'win32:x64') { throw 'Selected runner Node did not execute as Windows x64.' }
Write-Output 'Node resolution: duplicate paths, missing executable and real runner launch passed.'
