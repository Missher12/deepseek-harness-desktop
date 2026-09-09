import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { summarizeInstallerProgress } from './windows-desktop-installer-progress.ts'

function observedInstallation() {
  return {
    schemaVersion: 1,
    finishedElapsedMs: 300,
    samples: [
      { elapsedMs: 50, minimum: 0, maximum: 100, position: 20, detailsRows: 1, statusPresent: true },
      { elapsedMs: 200, minimum: 0, maximum: 100, position: 65, detailsRows: 3, statusPresent: true },
    ],
  }
}

describe('native installer progress observations', () => {
  it('accepts changing native progress with populated details before completion', () => {
    expect(summarizeInstallerProgress(observedInstallation())).toEqual({
      schemaVersion: 1,
      outcome: 'passed',
      sampleCount: 2,
      detailSampleCount: 2,
      distinctPositions: 2,
      durationMs: 300,
    })
  })

  it('rejects an expanded but empty details list', () => {
    const input = observedInstallation()
    for (const sample of input.samples) sample.detailsRows = 0
    expect(() => summarizeInstallerProgress(input)).toThrow('installation details stayed empty')
  })

  it('rejects a progress bar that exists without changing', () => {
    const input = observedInstallation()
    for (const sample of input.samples) sample.position = 20
    expect(() => summarizeInstallerProgress(input)).toThrow('native progress did not change')
  })

  it('requires actual nonempty status text alongside the details rows', () => {
    const input = observedInstallation()
    for (const sample of input.samples) sample.statusPresent = false
    expect(() => summarizeInstallerProgress(input)).toThrow('installation details stayed empty')
  })

  it('does not accept a single populated sample followed by blank installation details', () => {
    const input = observedInstallation()
    input.samples[1]!.detailsRows = 0
    expect(() => summarizeInstallerProgress(input)).toThrow('installation details stayed empty')
  })

  it('rejects a prolonged blank tail after initially populated moving progress', () => {
    const input = observedInstallation()
    input.finishedElapsedMs = 20_000
    for (let second = 1; second <= 18; second++) {
      input.samples.push({ elapsedMs: second * 1000, minimum: 0, maximum: 100,
        position: 65, detailsRows: 0, statusPresent: false })
    }
    expect(() => summarizeInstallerProgress(input)).toThrow('installation details were unavailable too long')
  })

  it('rejects an unobserved slow tail instead of treating skipped controls as coverage', () => {
    const input = observedInstallation()
    input.finishedElapsedMs = 20_000
    expect(() => summarizeInstallerProgress(input)).toThrow('native installation controls were unavailable too long')
  })

  it('records missing controls and rejects their sustained disappearance', () => {
    const input = observedInstallation()
    expect(() => summarizeInstallerProgress({ ...input, finishedElapsedMs: 20_000,
      samples: [...input.samples, { elapsedMs: 6000, missing: true }],
    })).toThrow('native installation controls were unavailable too long')
  })

  it('permits bounded control transitions during a long, genuinely detailed install', () => {
    const input = observedInstallation()
    expect(summarizeInstallerProgress({ ...input, finishedElapsedMs: 6000,
      samples: [...input.samples, { elapsedMs: 1000, missing: true },
        { ...input.samples[1]!, elapsedMs: 4000 }],
    }).outcome).toBe('passed')
  })

  it('does not reset a long blank interval when missing controls subsequently recover', () => {
    const input = observedInstallation()
    const empty = Array.from({ length: 4 }, (_, index) => ({ ...input.samples[1]!,
      elapsedMs: (index + 1) * 1000, detailsRows: 0, statusPresent: false,
    }))
    const missing = [5000, 6000, 7000].map(elapsedMs => ({ elapsedMs, missing: true }))
    expect(() => summarizeInstallerProgress({ ...input, finishedElapsedMs: 9000,
      samples: [...input.samples, ...empty, ...missing, { ...input.samples[1]!, elapsedMs: 8000 }],
    })).toThrow('installation details were unavailable too long')
  })

  it('does not count details that only appeared at completion', () => {
    const input = observedInstallation()
    input.finishedElapsedMs = 200
    input.samples[0]!.detailsRows = 0
    expect(() => summarizeInstallerProgress(input)).toThrow('observation is not before completion')
  })

  it('allows a real sub-stage progress reset without demanding global monotonicity', () => {
    const input = observedInstallation()
    input.samples[0]!.position = 80
    input.samples[1]!.position = 15
    expect(summarizeInstallerProgress(input).distinctPositions).toBe(2)
  })

  it('proves the baseline regression without accepting missing native progress', () => {
    const input = observedInstallation()
    for (const sample of input.samples) sample.detailsRows = 0
    expect(summarizeInstallerProgress(input, true).outcome).toBe('expected-blank-details')
    for (const sample of input.samples) sample.position = 20
    expect(() => summarizeInstallerProgress(input, true)).toThrow('native progress did not change')
  })

  it('rejects an unexpectedly fixed baseline rather than reporting a false RED', () => {
    expect(() => summarizeInstallerProgress(observedInstallation(), true))
      .toThrow('baseline unexpectedly populated installation details')
  })

  it.each([
    { minimum: 10, maximum: 10 },
    { position: 101 },
    { elapsedMs: Number.NaN },
    { detailsRows: -1 },
    { statusPresent: 'yes' },
    { machinePath: 'PRIVATE_PATH_MUST_NOT_APPEAR' },
  ])('rejects invalid or nonportable native observations: %j', (change) => {
    const input = observedInstallation()
    Object.assign(input.samples[0]!, change)
    expect(() => summarizeInstallerProgress(input)).toThrow('invalid installer observation')
  })

  it('requires multiple bounded chronological samples', () => {
    const input = observedInstallation()
    input.samples.reverse()
    expect(() => summarizeInstallerProgress(input)).toThrow('non-increasing observation time')
    input.samples.length = 1
    expect(() => summarizeInstallerProgress(input)).toThrow('invalid installer observations')
  })
})

describe('installer progress evidence CLI', () => {
  it.each(['valid', 'sample-limit', 'empty', 'private-field'] as const)('verifies real JSON input: %s', async (kind) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-installer-observation-'))
    try {
      const inputPath = join(root, 'input.json')
      const outputPath = join(root, 'output.json')
      const value = observedInstallation()
      if (kind === 'sample-limit') {
        value.finishedElapsedMs = 180_000
        value.samples = Array.from({ length: 3600 }, (_, index) => ({
          elapsedMs: index * 50, minimum: 0, maximum: 2_147_483_647,
          position: index, detailsRows: 1_000_000, statusPresent: true,
        }))
      }
      if (kind === 'empty') for (const sample of value.samples) sample.detailsRows = 0
      if (kind === 'private-field') Object.assign(value.samples[0]!, { path: 'PRIVATE_PATH_MUST_NOT_APPEAR' })
      const inputBytes = JSON.stringify(value)
      expect(Buffer.byteLength(inputBytes)).toBeLessThanOrEqual(512 * 1024)
      await writeFile(inputPath, inputBytes, { flag: 'wx', mode: 0o600 })
      const env = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD|^NODE_OPTIONS$|^NODE_PATH$/iu.test(key)))
      // This OS-fixture CLI does not load Cordis and runs erasable TS with Node.
      const child = spawnSync(process.execPath, [
        fileURLToPath(new URL('./windows-desktop-installer-progress.ts', import.meta.url)),
        '--input', inputPath, '--output', outputPath,
      ], { env, encoding: 'utf8', timeout: 15_000 })
      expect(child.error).toBeUndefined()
      expect(child.signal).toBeNull()
      expect(`${child.stdout}${child.stderr}`).not.toContain('PRIVATE_PATH_MUST_NOT_APPEAR')
      expect(`${child.stdout}${child.stderr}`).not.toContain(root)
      if (kind === 'sample-limit') {
        expect(child.status).toBe(0)
        expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual({
          schemaVersion: 1, outcome: 'passed', sampleCount: 3600,
          detailSampleCount: 3600, distinctPositions: 3600, durationMs: 180_000,
        })
      } else if (kind === 'valid') {
        expect(child.status).toBe(0)
        const bytes = await readFile(outputPath, 'utf8')
        expect(bytes).toBe(`${JSON.stringify({
          schemaVersion: 1, outcome: 'passed', sampleCount: 2,
          detailSampleCount: 2, distinctPositions: 2, durationMs: 300,
        }, null, 2)}\n`)
      } else {
        expect(child.status).toBe(1)
        await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('Windows Desktop assisted installer smoke', () => {
  // MUI's directory/instfiles pages append Caption " " to the outer title.
  // Exercise the actual script pattern, not a second hard-coded selector.
  const titleCases = [
    { caption: 'DeepSeek Harness Setup', matches: true },
    { caption: 'DeepSeek Harness Setup ', matches: true },
    { caption: 'DeepSeek Harness', matches: true },
    { caption: 'DeepSeek Harness ', matches: true },
    { caption: 'DeepSeek Harness Setup  ', matches: false },
    { caption: 'DeepSeek Harness Setup\t', matches: false },
    { caption: ' DeepSeek Harness Setup', matches: false },
    { caption: 'DeepSeek Harness Setup - unrelated', matches: false },
    { caption: 'Other DeepSeek Harness Setup', matches: false },
    { caption: '', matches: false },
  ]

  function installerTitlePattern(): string {
    const source = readFileSync(new URL('./windows-desktop-installer-ui-smoke.ps1', import.meta.url), 'utf8')
    const pattern = /\$matchesProductName = \$window\.Current\.Name -match '([^']+)'/u.exec(source)?.[1]
    if (pattern === undefined) throw new Error('Installer title selector is missing.')
    return pattern
  }

  it.each(titleCases)('handles the actual NSIS page caption: $caption', ({ caption, matches }) => {
    // This literal ASCII pattern uses the shared JS/.NET regex subset. The
    // native case below also executes PowerShell's real -match operator.
    expect(new RegExp(installerTitlePattern(), 'iu').test(caption)).toBe(matches)
  })

  it.skipIf(process.platform !== 'win32')('recognizes MUI captions with the native PowerShell matcher', () => {
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD|^NODE_OPTIONS$|^NODE_PATH$/iu.test(key)))
    const child = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '$cases = $env:DSH_INSTALLER_TITLE_CASES | ConvertFrom-Json; ' +
      '$results = @($cases | ForEach-Object { $_.caption -match $env:DSH_INSTALLER_TITLE_PATTERN }); ' +
      'ConvertTo-Json -InputObject $results -Compress',
    ], {
      env: { ...env, DSH_INSTALLER_TITLE_CASES: JSON.stringify(titleCases),
        DSH_INSTALLER_TITLE_PATTERN: installerTitlePattern() },
      encoding: 'utf8', timeout: 15_000,
    })
    expect(child.error).toBeUndefined()
    expect(child.signal).toBeNull()
    expect(child.status, child.stderr).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual(titleCases.map(item => item.matches))
  })

  it('masks native detail rectangles in physical coordinates and bounds observation files', () => {
    const source = readFileSync(new URL('./windows-desktop-installer-ui-smoke.ps1', import.meta.url), 'utf8')
    expect(source).toContain('RedactionBounds')
    expect(source).toContain('SetThreadDpiAwarenessContext')
    expect(source).toContain('$beforeRedaction')
    expect(source).toContain('$afterRedaction')
    expect(source).toContain('ConvertTo-Json -Depth 4 -Compress')
    expect(source).toContain('missing = $true')
  })

  it('does not enumerate thousands of details rows to detect the finish page on every sample', () => {
    const source = readFileSync(new URL('./windows-desktop-installer-ui-smoke.ps1', import.meta.url), 'utf8')
    const progressLoop = source.slice(source.indexOf('$progressClock ='), source.indexOf('if ($null -eq $finish)'))
    expect(progressLoop.includes('[NativeInstallerWindow]::IsFinishPage')).toBe(true)
    expect(progressLoop.includes('Get-AutomationText')).toBe(false)
  })

  it('walks the visible welcome, destination, progress/details, and finish pages', () => {
    const source = readFileSync(
      new URL('./windows-desktop-installer-ui-smoke.ps1', import.meta.url),
      'utf8',
    )

    expect(source).toContain('UIAutomationClient')
    expect(source).toContain('$script:InstallerProcessId')
    expect(source).toContain('Welcome to DeepSeek Harness Setup')
    expect(source).toContain('Choose Install Location')
    expect(source).toContain('msctls_progress32')
    expect(source).toContain('NativeInstallerWindow')
    expect(source).toContain('SysListView32')
    expect(source).toContain('Completing DeepSeek Harness Setup')
    expect(source).toContain('Run DeepSeek Harness')
    expect(source).toContain('Wait-InstallerToggleOff')
    expect(source).toContain('Complete-InstallerFinish')
    expect(source).toContain('Finish page remained visible after the Finish button was invoked.')
    expect(source).toContain('Finish page closed but Setup did not exit.')
    expect(source).not.toContain('$setup.WaitForExit(30000)')
    const finishObserved = source.indexOf('if ($null -eq $finish)')
    const installedAfterFinish = source.indexOf('$installed = $true', finishObserved)
    const completeFinish = source.indexOf('Complete-InstallerFinish -Setup $setup')
    expect(installedAfterFinish).toBeGreaterThan(finishObserved)
    expect(installedAfterFinish).toBeLessThan(completeFinish)
    expect(source).toContain('Invoke-IsolatedUninstall')
    expect(source).toContain("[Environment]::GetFolderPath('Desktop')")
    expect(source).toContain("[Environment]::GetFolderPath('Programs')")
    expect(source).toContain('$requestedInstallRoot = $temporaryRoot')
    expect(source).toContain('Add("/D=$requestedInstallRoot")')
    expect(source).toContain("Join-Path $temporaryRoot 'DeepSeek Harness'")
    expect(source).toContain('[string]$EvidenceRoot')
    expect(source).toContain('function Save-RedactedInstallerScreenshot')
    expect(source).toContain('[System.Windows.Automation.ControlType]::Edit')
    expect(source).toContain('installer-welcome.png')
    expect(source).toContain('installer-destination.png')
    expect(source).toContain('installer-progress.png')
    expect(source).toContain('installer-finish.png')
  })

  it('is wired into native Windows CI before the packaged lifecycle smoke', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/windows-desktop.yml', import.meta.url),
      'utf8',
    )
    const visible = workflow.indexOf('./scripts/windows-desktop-installer-ui-smoke.ps1')
    const lifecycle = workflow.lastIndexOf('./scripts/windows-desktop-setup-smoke.ps1')

    expect(visible).toBeGreaterThan(-1)
    expect(lifecycle).toBeGreaterThan(visible)
    expect(workflow).toContain('-EvidenceRoot apps/desktop/release/windows-installer-ui-evidence')
  })
})
