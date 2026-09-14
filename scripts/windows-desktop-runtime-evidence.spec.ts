import { createReadStream, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { runInNewContext } from 'node:vm'
import { JSON_SCHEMA, load } from 'js-yaml'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

async function withBaseRuntime(check: (resources: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'windows-base-consumer-'))
  try {
    const resources = join(root, 'release/win-unpacked/resources')
    const unpacked = join(resources, 'app.asar.unpacked')
    const runtime = join(unpacked, 'official-runtime')
    const identity = { officialSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', harnessVersion: '0.1.5-rc.2' }
    const files = new Map([
      [join(unpacked, 'desktop-composition.json'), JSON.stringify({ schema: 1, kind: 'base', ...identity })],
      [join(runtime, 'provenance.json'), JSON.stringify({ sourceSha: identity.officialSha, harnessVersion: identity.harnessVersion })],
      [join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: identity.harnessVersion })],
      [join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'export {}\n'],
      [join(runtime, 'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/worker.cjs'), 'module.exports = {}\n'],
    ])
    for (const [file, contents] of files) {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, contents, { flag: 'wx' })
    }
    await check(resources)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function packagedBaseResolver(): (resources: string) => Promise<string> {
  const workflow = readFileSync(new URL('../.github/workflows/windows-desktop.yml', import.meta.url), 'utf8')
  const start = workflow.indexOf('async function resolvePackagedBaseRuntime(resources) {')
  const end = workflow.indexOf('const runtime = await resolvePackagedBaseRuntime(resources)', start)
  expect(start, 'The native workflow must validate its actual base runtime before importing it').toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  // Execute the workflow's actual resolver against physical files; no Electron,
  // native process or runtime package is replaced by a test double.
  return runInNewContext(`${workflow.slice(start, end)}\nresolvePackagedBaseRuntime`, {
    assert, readFile, realpath, stat, isAbsolute, join, relative, sep,
  }) as (resources: string) => Promise<string>
}

describe('Windows packaged base runtime selection', () => {
  it('fingerprints physical official JavaScript as well as native libraries before and after a probe', async () => {
    const workflow = readFileSync(new URL('../.github/workflows/windows-desktop.yml', import.meta.url), 'utf8')
    const start = workflow.indexOf('async function fingerprint() {')
    const end = workflow.indexOf("assert.equal(process.platform, 'win32'", start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    await withBaseRuntime(async (resources) => {
      const release = dirname(dirname(resources))
      const unpacked = join(resources, 'app.asar.unpacked')
      const artifact = 'owned-fixture.exe'
      const workspaceArtifact = join(dirname(release), 'apps/desktop/release', artifact)
      for (const path of [workspaceArtifact, join(release, artifact), join(release, 'win-unpacked/DeepSeek Harness.exe'),
        join(resources, 'app.asar'), join(unpacked, 'native.node'), join(resources, 'desktop-helper/node.exe')]) {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, 'fixture bytes; not executed')
      }
      const fingerprint = runInNewContext(workflow.slice(start, end) + '\nfingerprint', {
        assert, readdir, createReadStream, createHash, release, resources, unpacked,
        process: { env: { ARTIFACT: artifact } },
        join: (...paths: string[]) => paths[0] === 'apps/desktop/release' ? workspaceArtifact : join(...paths),
      }) as () => Promise<[string, string][]>
      const file = join(unpacked, 'official-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js')
      const before = new Map(await fingerprint())
      expect(before.has(file), 'Physical official JS must be part of the immutable-package proof').toBe(true)
      expect(before.has(join(resources, 'desktop-helper/node.exe')), 'The independent helper runtime must also be protected').toBe(true)
      await writeFile(file, 'changed physical runtime bytes')
      const after = new Map(await fingerprint())
      expect(after.get(file)).not.toBe(before.get(file))
      expect(after.get(join(unpacked, 'native.node'))).toBe(before.get(join(unpacked, 'native.node')))
    })
  })

  it('selects the nested official runtime without requiring retired top-level packages', async () => {
    const resolveRuntime = packagedBaseResolver()
    await withBaseRuntime(async (resources) => {
      await expect(resolveRuntime(resources)).resolves.toBe(await realpath(join(resources, 'app.asar.unpacked/official-runtime')))
    })
  })

  it.each([
    ['missing descriptor', 'desktop-composition.json', undefined],
    ['full composition', 'desktop-composition.json', { schema: 1, kind: 'full', officialSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', harnessVersion: '0.1.5-rc.2' }],
    ['different official source', 'desktop-composition.json', { schema: 1, kind: 'base', officialSha: 'd1e8bd9c6d49f980405888099087f931ddd26d83', harnessVersion: '0.1.5-rc.2' }],
    ['unknown descriptor fields', 'desktop-composition.json', { schema: 1, kind: 'base', officialSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', harnessVersion: '0.1.5-rc.2', injected: true }],
    ['changed provenance', 'official-runtime/provenance.json', { sourceSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', harnessVersion: '0.1.5-rc.1' }],
    ['wrong installed CLI', 'official-runtime/node_modules/@deepseek-ai/dsh/package.json', { name: '@deepseek-ai/dsh', version: '0.1.5-rc.1' }],
    ['missing CLI entry', 'official-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js', undefined],
    ['missing JSONL worker', 'official-runtime/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/worker.cjs', undefined],
  ])('rejects %s instead of falling back to the old package graph', async (_name, file, replacement) => {
    const resolveRuntime = packagedBaseResolver()
    await withBaseRuntime(async (resources) => {
      const path = join(resources, 'app.asar.unpacked', file)
      if (replacement === undefined) await rm(path)
      else await writeFile(path, JSON.stringify(replacement))
      await expect(resolveRuntime(resources)).rejects.toThrow()
    })
  })

  it('rejects an official runtime linked outside the installed unpacked tree', async () => {
    const resolveRuntime = packagedBaseResolver()
    await withBaseRuntime(async (resources) => {
      const runtime = join(resources, 'app.asar.unpacked/official-runtime')
      const foreign = join(dirname(resources), 'foreign-runtime')
      await mkdir(foreign)
      await rm(runtime, { recursive: true })
      await symlink(foreign, runtime, 'junction')
      await expect(resolveRuntime(resources)).rejects.toThrow(/outside/iu)
    })
  })
})

describe('Windows Desktop runtime evidence wiring', () => {
  it('verifies the installed base receipt before uninstall and keeps private evidence out of artifacts', () => {
    const script = readFileSync(new URL('./windows-desktop-setup-smoke.ps1', import.meta.url), 'utf8')
    const gate = script.indexOf('& pnpm exec tsx scripts/verify-desktop-base-smoke.ts')
    expect(gate, 'Native acceptance requires the complete base receipt, not the old workspace-only receipt').toBeGreaterThan(0)
    const gateBody = script.slice(gate, script.indexOf('\n  Invoke-IsolatedUninstall', gate))
    expect(gateBody).toContain('--receipt (Join-Path $temporaryRoot \'base-smoke-receipt.json\')')
    expect(gateBody).toContain('--descriptor $resolvedSmokeDescriptor')
    expect(gateBody).toContain('--smoke-root $temporaryRoot --platform win32 --scope core')
    expect(gateBody).toContain("if ($LASTEXITCODE -ne 0) { throw 'Complete native base receipt validation failed.' }")
    expect(gate).toBeLessThan(script.indexOf('\n  Invoke-IsolatedUninstall'))
    expect(script).toContain('windows-core-native.ts prepare')
    expect(script.indexOf('windows-core-native.ts prepare')).toBeLessThan(script.indexOf('Invoke-CheckedNsisInstall -FilePath $resolvedSetup'))
    expect(script).toContain('DSH_DESKTOP_SMOKE_LEGACY_FIXTURE')
    const document = load(readFileSync(new URL('../.github/workflows/windows-desktop.yml', import.meta.url), 'utf8'), {
      schema: JSON_SCHEMA,
    }) as { jobs: { 'build-install-smoke': { steps: { run?: string; uses?: string; with?: { path?: string } }[] } } }
    const steps = document.jobs['build-install-smoke'].steps
    expect(steps.some(step => step.run?.includes('verifySessionWorkspaceReceipt'))).toBe(false)
    const uploaded = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@')).map(step => step.with?.path ?? '').join('\n')
    for (const privateFile of ['base-smoke-receipt.json', 'base-protected-paths.json', 'desktop-smoke-session-workspaces-win32.json']) {
      expect(uploaded.includes(privateFile)).toBe(false)
    }
  })

  it('prepares one base candidate from the pinned separate official source', () => {
    const document = load(readFileSync(new URL('../.github/workflows/windows-desktop.yml', import.meta.url), 'utf8'), {
      schema: JSON_SCHEMA,
    }) as { jobs: { 'build-install-smoke': { steps: { name?: string; run?: string; with?: Record<string, unknown> }[] } } }
    const steps = document.jobs['build-install-smoke'].steps
    const official = steps.filter(step => step.with?.repository === 'deepseek-ai/deepseek-harness')
    expect(official).toHaveLength(1)
    expect(official[0]?.with).toMatchObject({ ref: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', path: 'official', 'persist-credentials': false })
    const build = steps.find(step => step.name === 'Build the assisted Windows Setup')?.run ?? ''
    expect(build.match(/scripts\/prepare-desktop-base\.ts/gu)).toHaveLength(1)
    expect(build.includes('pnpm run desktop:stage')).toBe(false)
    expect(build.includes('--official-source "$env:DSH_DESKTOP_OFFICIAL_SOURCE"')).toBe(true)
    expect(build.includes('--composition base --descriptor')).toBe(true)
    expect(build.includes('official-runtime/node_modules/@deepseek-ai/dsh/package.json')).toBe(true)
    const probe = steps.find(step => step.name === 'Verify Windows system paths without changing packaged bytes')?.run ?? ''
    expect(probe.includes("resolve('packages/session/session-persistence-jsonl")).toBe(false)
    expect(probe.includes('DSH_DESKTOP_OFFICIAL_SOURCE')).toBe(true)
  })

  it.skipIf(process.platform !== 'win32')('reads real base protection files and rejects incomplete or foreign lists with Windows PowerShell', () => {
    const command = `
      $ErrorActionPreference = 'Stop'
      $tokens = $null; $errors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:DSH_SETUP_SCRIPT, [ref]$tokens, [ref]$errors)
      if ($errors.Count -ne 0) { throw 'Setup smoke did not parse.' }
      $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-BaseProtectedSnapshot' }, $true)
      . ([scriptblock]::Create($definition.Extent.Text))
      $root = Join-Path ([IO.Path]::GetTempPath()) ('base-protection-' + [guid]::NewGuid().ToString('N'))
      [void][IO.Directory]::CreateDirectory($root)
      $file = Join-Path $root 'preserve.txt'
      $inputPath = Join-Path $root 'base-protected-paths.json'
      [IO.File]::WriteAllText($file, 'keep these bytes')
      try {
        $results = @()
        foreach ($mode in @('valid','empty','duplicate','outside','missing','extra')) {
          $paths = @($file)
          if ($mode -eq 'empty') { $paths = @() }
          if ($mode -eq 'duplicate') { $paths = @($file,$file) }
          if ($mode -eq 'outside') { $paths = @([IO.Path]::Combine([IO.Path]::GetPathRoot($root), 'foreign.txt')) }
          if ($mode -eq 'missing') { $paths = @(Join-Path $root 'missing.txt') }
          $record = @{schemaVersion=1;composition='base';protectedPaths=$paths}
          if ($mode -eq 'extra') { $record['allowOutside']=$true }
          [IO.File]::WriteAllText($inputPath, ($record | ConvertTo-Json -Compress))
          $rejected = $false; $snapshot = @()
          try { $snapshot = @(Get-BaseProtectedSnapshot -Root $root) } catch { $rejected = $true }
          $results += if ($mode -eq 'valid') { -not $rejected -and $snapshot.Count -eq 2 } else { $rejected }
          if ([IO.File]::ReadAllText($file) -cne 'keep these bytes') { throw 'Protected data changed.' }
        }
        $results | ConvertTo-Json -Compress
      } finally { [IO.Directory]::Delete($root, $true) }
    `
    const result = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, DSH_SETUP_SCRIPT: fileURLToPath(new URL('./windows-desktop-setup-smoke.ps1', import.meta.url)) },
    })
    expect(JSON.parse(result)).toEqual([true, true, true, true, true, true])
  })

  it('requires a real base smoke descriptor and keeps its protected files through uninstall', () => {
    const smoke = readFileSync(new URL('./windows-desktop-setup-smoke.ps1', import.meta.url), 'utf8')
    expect(smoke).toContain('[string]$SmokeDescriptorPath')
    expect(smoke).toContain('DSH_DESKTOP_SMOKE_DESCRIPTOR')
    expect(smoke).toContain('function Get-BaseProtectedSnapshot')
    expect(smoke).toContain('$baseProtectedBefore = @(Get-BaseProtectedSnapshot -Root $temporaryRoot)')
    expect(smoke).toContain('$baseProtectedAfter = @(Get-BaseProtectedSnapshot -Root $temporaryRoot)')
    expect(smoke).toContain('Compare-Object -ReferenceObject $baseProtectedBefore -DifferenceObject $baseProtectedAfter')
    expect(smoke).not.toContain('$legacyRecoverySnapshot')
    expect(smoke).toContain('Base smoke requires a prepare/stage descriptor.')
  })

  it.skipIf(process.platform !== 'win32')('rejects background windows, partial or duplicate queries and changed foregrounds before Search Enter', () => {
    const source = fileURLToPath(new URL('./windows-desktop-native-visual-smoke.ps1', import.meta.url))
    const command = `
      $tokens = $null; $errors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:DSH_VISUAL_SCRIPT, [ref]$tokens, [ref]$errors)
      if ($errors.Count -ne 0) { throw 'Visual smoke did not parse.' }
      $definitions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Test-SearchProcessName', 'Test-SearchQueryObservation') }, $true)
      foreach ($definition in $definitions) { . ([scriptblock]::Create($definition.Extent.Text)) }
      @(
        (Test-SearchQueryObservation SearchHost 'DeepSeek Harness' 1 $true $true)
        (Test-SearchQueryObservation 'DeepSeek Harness' 'DeepSeek Harness' 1 $true $true)
        (Test-SearchQueryObservation SearchHost 'DeepSe' 1 $true $true)
        (Test-SearchQueryObservation SearchHost 'DeepSeek Harness' 0 $true $true)
        (Test-SearchQueryObservation SearchHost 'DeepSeek Harness' 2 $true $true)
        (Test-SearchQueryObservation SearchHost 'DeepSeek Harness' 1 $false $true)
        (Test-SearchQueryObservation SearchHost 'DeepSeek Harness' 1 $true $false)
        (Test-SearchQueryObservation SearchHost 'DeepSeek Harness Setup' 1 $true $true)
      ) | ConvertTo-Json -Compress
    `
    const result = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      env: { ...process.env, DSH_VISUAL_SCRIPT: source },
      timeout: 30_000,
    })
    expect(JSON.parse(result)).toEqual([true, false, false, false, false, false, false, false])
  })

  it.skipIf(process.platform !== 'win32')('accepts Search launch only for a fresh exact-image foreground window with readiness', () => {
    const source = fileURLToPath(new URL('./windows-desktop-native-visual-smoke.ps1', import.meta.url))
    const command = `
      $ErrorActionPreference = 'Stop'
      $tokens = $null; $errors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:DSH_VISUAL_SCRIPT, [ref]$tokens, [ref]$errors)
      if ($errors.Count -ne 0) { throw 'Visual smoke did not parse.' }
      $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-SearchLaunchObservation' }, $true)
      . ([scriptblock]::Create($definition.Extent.Text))
      $entered = [datetime]'2026-09-08T00:00:00Z'
      $created = $entered.AddMilliseconds(50)
      $expected = 'C:\\isolated\\DeepSeek Harness.exe'
      @(
        (Test-SearchLaunchObservation $expected $expected $false $created $entered 42 42 42 $true)
        (Test-SearchLaunchObservation 'c:\\ISOLATED\\deepseek harness.exe' $expected $false $created $entered 42 42 42 $true)
        (Test-SearchLaunchObservation 'C:\\other\\DeepSeek Harness.exe' $expected $false $created $entered 42 42 42 $true)
        (Test-SearchLaunchObservation ($expected + '.other.exe') $expected $false $created $entered 42 42 42 $true)
        (Test-SearchLaunchObservation $expected $expected $true $created $entered 42 42 42 $true)
        (Test-SearchLaunchObservation $expected $expected $false ($entered.AddSeconds(-1)) $entered 42 42 42 $true)
        (Test-SearchLaunchObservation $expected $expected $false $created $entered 42 99 42 $true)
        (Test-SearchLaunchObservation $expected $expected $false $created $entered 42 42 99 $true)
        (Test-SearchLaunchObservation $expected $expected $false $created $entered 42 42 42 $false)
        (Test-SearchLaunchObservation $expected $expected $false $created $entered 0 0 0 $true)
        (Test-SearchLaunchObservation '' $expected $false $created $entered 42 42 42 $true)
      ) | ConvertTo-Json -Compress
    `
    const result = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      env: { ...process.env, DSH_VISUAL_SCRIPT: source },
      timeout: 30_000,
    })
    expect(JSON.parse(result)).toEqual([true, true, false, false, false, false, false, false, false, false, false])
  })

  it('restricts historical inventory to the pinned baseline and keeps ordinary runtime evidence strict', () => {
    const smoke = readFileSync(new URL('./windows-desktop-setup-smoke.ps1', import.meta.url), 'utf8')
    const workflow = readFileSync(new URL('../.github/workflows/windows-desktop.yml', import.meta.url), 'utf8')
    expect(smoke).toContain('[switch]$HistoricalBaselineInventory')
    expect(smoke).toContain('HistoricalBaselineInventory requires RuntimeEvidenceOnly without a candidate policy or manifest.')
    expect(smoke).toContain("$inventoryArguments += '--historical-baseline'")
    expect(smoke).toContain('-HistoricalBaselineInventory:$HistoricalBaselineInventory')
    expect(workflow.match(/-HistoricalBaselineInventory/g)).toHaveLength(1)
    expect(workflow).toContain('-RuntimeEvidenceOnly `\n            -HistoricalBaselineInventory')
    expect(workflow.indexOf('adb72bcbdc40ee87b37b7eb5867b75f66110cbb50ad91ad55e6f1a910191ca87'))
      .toBeLessThan(workflow.indexOf('-HistoricalBaselineInventory'))
  })

  it('measures ten isolated cold launches and ten same-home warm launches before uninstall', () => {
    const smoke = readFileSync(
      new URL('./windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )

    expect(smoke).toContain('[string]$StartupSummaryPath')
    expect(smoke).toContain('[string]$PackageInventoryPath')
    expect(smoke).toContain('function Invoke-DesktopStartupSample')
    expect(smoke).toContain("foreach ($sampleKind in @('cold', 'warm'))")
    expect(smoke).toContain('for ($sampleIndex = 1; $sampleIndex -le 10; $sampleIndex += 1)')
    expect(smoke).not.toContain('for ($sampleIndex = 1; $sampleIndex -le 5; $sampleIndex += 1)')
    expect(smoke).toContain("-SampleKind 'warm-prime'")
    expect(smoke).toContain('startup (app-ready|window-prerequisites|loading-visible|fallback-ready|url-reported|harness-ready|desktop-running)')
    expect(smoke).toContain(
      'runtime (profile-compose|loader-mount|loader-settle|activation-audit|loader-build-duration|root-include-duration|first-party-import-duration|root-activation-duration|settle-duration|audit-duration)',
    )
    expect(smoke).toContain('$process.CloseMainWindow()')
    expect(smoke).toContain('Get-IsolatedInstalledProcesses -ExecutablePath $ExecutablePath')
    expect(smoke).toContain('run benchmark:startup --output')
    expect(smoke).not.toContain('run benchmark:startup -- --output')
    expect(smoke).toContain('run inventory:package @inventoryArguments')
    expect(smoke).not.toContain('run inventory:package -- @inventoryArguments')
    expect(smoke).toContain("[ValidateSet('windows-x64')]")
    expect(smoke).toContain("'--policy', $PackagePolicy")
    expect(smoke).toContain("'--manifest', $resolvedManifest")
    expect(smoke).toContain('function Assert-ManagedPackageRootsPhysical')
    expect(smoke).toContain("'--composition', 'base', '--descriptor', $resolvedDescriptor")
    expect(smoke).not.toContain("$unpackedModules = Join-Path $InstallRoot 'resources\\app.asar.unpacked\\node_modules'")
    expect(smoke).toContain('[System.IO.FileAttributes]::ReparsePoint')
    expect(smoke).not.toContain('Copy-Item -LiteralPath $lifecyclePath')
  })

  it('uploads only portable startup and package summaries beside the Setup', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )
    expect(workflow).toContain('desktop-startup-summary.json')
    expect(workflow).toContain('desktop-package-installed.json')
    expect(workflow).toContain('desktop-package-staged.json')
    expect(workflow).toContain('-StartupSummaryPath')
    expect(workflow).toContain('-PackageInventoryPath')
    expect(workflow).toContain('runtime-evidence-${{ steps.source.outputs.sha }}')
    expect(workflow).not.toContain('lifecycle.log\n')
    expect(workflow).not.toContain('cpuprofile')
  })

  it('records installed bytes, the inventory digest, and exact shortcut icon ownership', () => {
    const smoke = readFileSync(
      new URL('./windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )

    expect(smoke).toContain('[string]$InstallationEvidencePath')
    expect(smoke).toContain('function Get-InstalledShortcutEvidence')
    expect(smoke).toContain('WScript.Shell')
    expect(smoke).toContain('$shortcut.TargetPath')
    expect(smoke).toContain('$shortcut.IconLocation')
    expect(smoke).toContain('Shortcut icon must resolve to the installed executable')
    expect(smoke).toContain('inventorySha256')
    expect(smoke).toContain('installedBytes')
    expect(smoke).toContain('categories = $inventoryDocument.categories')
    expect(workflow).toContain('desktop-windows-install-evidence.json')
  })

  it('runs installed visual evidence at 100 and 150 percent without leaking raw logs', () => {
    const smoke = readFileSync(
      new URL('./windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )
    const visual = readFileSync(
      new URL('./windows-desktop-native-visual-smoke.ps1', import.meta.url),
      'utf8',
    )
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )
    const packaged = readFileSync(
      new URL('../apps/desktop/tests/windows-packaged-smoke.spec.ts', import.meta.url),
      'utf8',
    )
    const main = readFileSync(
      new URL('../apps/desktop/src/main.ts', import.meta.url),
      'utf8',
    )
    const trayEvidence = readFileSync(
      new URL('../apps/desktop/src/native-visual-tray-evidence.ts', import.meta.url),
      'utf8',
    )

    expect(smoke).toContain('foreach ($dpiPercent in @(100, 150))')
    expect(smoke).toContain('./scripts/windows-desktop-native-visual-smoke.ps1')
    expect(visual).toContain('--force-device-scale-factor=')
    expect(visual).toContain('function Save-NativeScreenCapture')
    const searchWaiter = visual.slice(visual.indexOf('function Get-VerifiedSearchQuery'), visual.indexOf('function Invoke-AutomationElement'))
    expect(searchWaiter).toContain('AutomationElement]::FromHandle($foreground)')
    expect(searchWaiter).not.toContain('RootElement')
    expect(searchWaiter).toContain('ValuePattern]::Pattern')
    expect(searchWaiter).toContain('Test-SearchQueryObservation')
    expect(visual).toContain('[void](Wait-SearchQuery)')
    const originalTreeStopped = visual.indexOf('Wait-ProcessIdsStopped -ProcessIds $trackedProcessIds')
    const searchLaunch = visual.indexOf('$searchLaunch = Invoke-SearchApplicationLaunch')
    expect(searchLaunch).toBeGreaterThan(originalTreeStopped)
    expect(visual.slice(originalTreeStopped, searchLaunch)).toContain('if ($DpiPercent -eq 100)')
    expect(visual).toContain('Test-SearchLaunchObservation')
    expect(visual).toContain('[NativeVisualInput]::PressEnter()')
    expect(visual).toContain('DwmGetWindowAttribute(window, 9')
    expect(visual).toContain('SetThreadDpiAwarenessContext(previous)')
    expect(visual).toContain('Contains($windowGeometry.WorkArea, $windowGeometry.VisibleFrame)')
    expect(visual).toContain('windowGeometryPhysicalPixels = $windowGeometry')
    expect(visual).toContain('function Open-DeepSeekHarnessTrayMenu')
    expect(visual).toContain('$maxTrayMenuAttempts = 3')
    expect(visual).toContain(
      'for ($attempt = 1; $attempt -le $maxTrayMenuAttempts; $attempt += 1)',
    )
    expect(visual).toContain('$overflowOpenedAt = [DateTimeOffset]::UtcNow')
    expect(visual).toContain('if ($attempt -eq $maxTrayMenuAttempts)')
    expect(visual).toContain("throw 'Windows did not expose the DeepSeek Harness tray menu after 3 attempts.'")
    expect(visual).toContain('Show DeepSeek Harness')
    expect(visual).toContain("-NamePattern '^Quit$'")
    expect(visual).not.toContain("-NamePattern '^Quit DeepSeek Harness$'")
    expect(visual).toContain('public static void LeftClick(int x, int y)')
    expect(visual).toContain('$hiddenBounds = $hiddenIcons.Current.BoundingRectangle')
    expect(visual).toContain('[NativeVisualInput]::LeftClick(')
    expect(visual).not.toContain("-NamePattern '^DeepSeek Harness' `\n    -ControlType")
    expect(visual).toContain("$trayEvidencePath = Join-Path $UserData 'native-visual-tray.json'")
    expect(visual).toContain('Remove-Item -LiteralPath $trayEvidencePath -Force')
    expect(visual).toContain("$startInfo.Environment['DSH_DESKTOP_NATIVE_VISUAL_EVIDENCE'] = '1'")
    expect(visual).toContain('function Wait-NativeVisualTrayEvidence')
    expect(visual).toContain('$evidenceObservedAt -le $OverflowOpenedAt')
    expect(visual).toContain('[System.Windows.Forms.SystemInformation]::VirtualScreen')
    expect(visual).toContain('($clickX -lt $virtualScreen.Left) -or')
    expect(visual).toContain('($clickX -ge $virtualScreen.Right) -or')
    expect(visual).toContain('($clickY -lt $virtualScreen.Top) -or')
    expect(visual).toContain('($clickY -ge $virtualScreen.Bottom)')
    expect(visual).not.toMatch(/\n\s+-or \$click[XY]/u)
    expect(visual).toContain('$expectedIconSize = if ($DpiPercent -eq 100) { 16 } else { 24 }')
    expect(visual).toContain('tray-overflow-$DpiPercent.png')
    expect(visual).toContain('native-visual-failure-$DpiPercent.png')
    expect(main).toContain("process.env.DSH_DESKTOP_NATIVE_VISUAL_EVIDENCE === '1'")
    expect(main).toContain("join(userData, 'native-visual-tray.json')")
    expect(main).toContain('activeTray.getBounds()')
    expect(main).toContain('screen.dipToScreenPoint')
    expect(main).not.toContain("ipcMain.handle('desktop:native-visual")
    const traySync = main.indexOf('function syncWindowsTray(): void')
    const traySyncStop = main.indexOf('nativeVisualTrayEvidence.stop()', traySync)
    const traySyncDestroy = main.indexOf('tray?.destroy()', traySync)
    const beforeQuit = main.indexOf("app.on('before-quit'")
    const beforeQuitStop = main.indexOf('nativeVisualTrayEvidence.stop()', beforeQuit)
    const beforeQuitDestroy = main.indexOf('tray?.destroy()', beforeQuit)
    expect(traySyncStop).toBeGreaterThan(traySync)
    expect(traySyncDestroy).toBeGreaterThan(traySyncStop)
    expect(beforeQuitStop).toBeGreaterThan(beforeQuit)
    expect(beforeQuitDestroy).toBeGreaterThan(beforeQuitStop)
    expect(trayEvidence).toContain('const SAMPLE_INTERVAL_MS = 250')
    expect(trayEvidence).toContain('timer.unref()')
    expect(trayEvidence).toContain('if (!options.enabled) return')
    expect(trayEvidence).toContain('void options.write({')
    expect(trayEvidence).toContain('}).catch(() => {})')
    expect(visual).toContain('Get-DescendantProcessIds')
    expect(visual).toContain('Wait-ProcessIdsStopped')
    expect(visual).toContain('desktop-shortcut')
    expect(visual).toContain('start-menu-shortcut')
    expect(visual).toContain('taskbar-running')
    expect(visual).toContain('tray-menu')
    expect(packaged).toContain("'--force-device-scale-factor=1.5'")
    expect(packaged).toContain('window.devicePixelRatio')
    expect(packaged).toContain('seeded: PackagedDesktopBaseSmokeResult')
    expect(packaged).toContain("const seeded = await runPackagedDesktopBaseSmoke(executable, 'win32', { scalePercent: 100 })")
    expect(packaged).toContain('await reopenWindowsCoreHistory(page, legacy)')
    expect(packaged).toContain('await completeWindowsCoreHistory(smokeRoot, descriptor, [...tracked], [...ports])')
    expect(packaged).not.toContain('runPackagedDesktopSmoke(')
    expect(packaged).not.toContain('Turn navigation')
    expect(packaged).not.toContain('setViewportSize(')
    expect(packaged).toContain('exerciseWindows150PercentSurface(executable, seeded)')
    expect(packaged.includes('HOME: smokeRoot, USERPROFILE: smokeRoot')).toBe(true)
    expect(packaged).toContain("from './packaged-base-smoke.ts'")
    expect(packaged).not.toContain("from './packaged-smoke.ts'")
    const onboardingWait = packaged.indexOf("await waitForPackagedBaseReady(page, { welcome: 'expected', credentials: 'missing' })")
    const portObserved = packaged.indexOf('const port = Number(new URL(page.url()).port)')
    const portRegistered = packaged.indexOf('ports.add(port)')
    expect(portObserved).toBeGreaterThanOrEqual(0)
    expect(portRegistered).toBeGreaterThan(portObserved)
    expect(onboardingWait).toBeGreaterThan(portRegistered)
    expect(onboardingWait).toBeLessThan(packaged.indexOf('await reopenWindowsCoreHistory(page, legacy)'))
    expect(packaged).not.toContain('await waitForDesktopSessionReady(page)')
    expect(packaged).not.toContain('activateSmokeSession(')
    expect(packaged).toContain("page.locator('[role=\"treeitem\"][aria-selected]')")
    expect(packaged).toContain('page.getByText(seeded.activeSessionTitle, { exact: true })')
    expect(packaged).toContain("sessionRow.getAttribute('aria-selected')")
    expect(packaged).toContain("await composer.fill('Windows base 150% input probe')")
    expect(packaged).toContain('nativeBounds.x + nativeBounds.width')
    expect(packaged).toContain('nativeBounds.y + nativeBounds.height')
    expect(packaged).toContain('waitForWindowsCoreProcessesStopped([...tracked], windowsProcessOutput)')
    expect(packaged).not.toContain('parseWindowsProcessRows')
    expect(packaged).toContain('closeBaseSmokeOwnedApplication({')
    expect(packaged).toContain("$ErrorActionPreference = 'Stop'")
    expect(packaged).toContain('await protectedSnapshot(seeded.protectedPaths)')
    expect(packaged).toContain("'base-protected-paths.json'")
    expect(packaged).toContain("schemaVersion: 1, composition: 'base', protectedPaths: seeded.protectedPaths")
    expect(packaged).toContain("flag: 'wx', mode: 0o600")
    expect(workflow).not.toContain('base-protected-paths.json')
    expect(workflow).toContain('Windows-native-visual-evidence-${{ steps.source.outputs.sha }}')
    expect(workflow).not.toContain('fixed-milestones/')
    expect(workflow).not.toContain('lifecycle.log')
  })

  it('benchmarks the pinned public 0.5.3 Setup on the same runner before the candidate', () => {
    const smoke = readFileSync(
      new URL('./windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )

    expect(smoke).toContain('[switch]$RuntimeEvidenceOnly')
    expect(smoke).toContain('if (-not $RuntimeEvidenceOnly)')
    expect(workflow).toContain('DeepSeek-Harness-Setup-0.5.3-win-x64.exe')
    expect(workflow).toContain('152982782')
    expect(workflow).toContain('adb72bcbdc40ee87b37b7eb5867b75f66110cbb50ad91ad55e6f1a910191ca87')
    expect(workflow).not.toContain('DeepSeek-Harness-Setup-0.5.1-win-x64.exe')
    expect(workflow).toContain('-RuntimeEvidenceOnly')
    expect(workflow).toContain('desktop-startup-baseline-0.5.3.json')
    expect(workflow).toContain('desktop-package-installed-baseline-0.5.3.json')
    expect(workflow).toContain('desktop-package-setup-baseline-0.5.3.json')
    expect(workflow).toContain('-PackagePolicy windows-x64')
  })
})
