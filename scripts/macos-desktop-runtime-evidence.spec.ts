import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import * as runtimeEvidenceModule from './macos-desktop-runtime-evidence.ts'

const runtimeEvidence = new URL('./macos-desktop-runtime-evidence.ts', import.meta.url)
const nativeVisual = new URL('../apps/desktop/tests/macos-native-visual-smoke.spec.ts', import.meta.url)
const repositoryRoot = resolve(import.meta.dirname, '..')

interface StartupMetric {
  readonly medianMs: number
  readonly p95Ms: number
}

interface StartupPair {
  readonly cold: StartupMetric
  readonly warm: StartupMetric
}

type RuntimeEvidenceModule = {
  evaluateMacStartupGate?: (baseline: StartupPair, candidate: StartupPair) => {
    readonly passed: boolean
    readonly cold: { readonly medianImprovementPercent: number; readonly p95RegressionPercent: number }
    readonly warm: { readonly medianImprovementPercent: number; readonly p95RegressionPercent: number }
  }
  assertPortableMacEvidence?: (value: unknown) => void
}

const runtime = runtimeEvidenceModule as RuntimeEvidenceModule

function loadReleaseWorkflow(): Record<string, unknown> {
  const loaded: unknown = yaml.load(readFileSync(resolve(repositoryRoot, '.github/workflows/desktop-release.yml'), 'utf8'))
  if (loaded === null || typeof loaded !== 'object' || Array.isArray(loaded)) {
    throw new TypeError('Desktop release workflow must be an object')
  }
  return loaded as Record<string, unknown>
}

describe('macOS Desktop runtime evidence', () => {
  it('has a dedicated Mac-only runtime evidence runner', () => {
    expect(existsSync(runtimeEvidence)).toBe(true)
  })

  it('enforces the asymmetric median gate and both P95 ceilings', () => {
    expect(runtime.evaluateMacStartupGate).toBeTypeOf('function')
    if (runtime.evaluateMacStartupGate === undefined) return

    const baseline = {
      cold: { medianMs: 1_000, p95Ms: 1_200 },
      warm: { medianMs: 800, p95Ms: 900 },
    }
    const accepted = runtime.evaluateMacStartupGate(baseline, {
      cold: { medianMs: 840, p95Ms: 1_250 },
      warm: { medianMs: 820, p95Ms: 950 },
    })
    expect(accepted).toMatchObject({
      passed: true,
      cold: { medianImprovementPercent: 16, p95RegressionPercent: 4.17 },
      warm: { medianImprovementPercent: -2.5, p95RegressionPercent: 5.56 },
    })

    expect(runtime.evaluateMacStartupGate(baseline, {
      cold: { medianMs: 860, p95Ms: 1_200 },
      warm: { medianMs: 800, p95Ms: 900 },
    }).passed).toBe(false)
    expect(runtime.evaluateMacStartupGate(baseline, {
      cold: { medianMs: 840, p95Ms: 1_321 },
      warm: { medianMs: 800, p95Ms: 900 },
    }).passed).toBe(false)
    expect(runtime.evaluateMacStartupGate(baseline, {
      cold: { medianMs: 840, p95Ms: 1_200 },
      warm: { medianMs: 841, p95Ms: 900 },
    }).passed).toBe(false)
  })

  it('rejects paths, URLs, secrets, and raw lifecycle logs from portable evidence', () => {
    const assertPortableMacEvidence = runtime.assertPortableMacEvidence
    expect(assertPortableMacEvidence).toBeTypeOf('function')
    if (assertPortableMacEvidence === undefined) return

    expect(() => {
      assertPortableMacEvidence({
        schemaVersion: 1,
        candidateRevision: '9e3f17ee76307a40d392984cf9aea91be66e99a4',
        cold: { medianMs: 840, p95Ms: 1_250 },
        runtimeDetails: { 'root-include-duration': { medianMs: 3, p95Ms: 4 } },
      })
    }).not.toThrow()
    for (const unsafe of [
      { home: '/Users/example/.dsh' },
      { source: 'file:///private/tmp/app.asar' },
      { url: 'http://127.0.0.1:1234/' },
      { credential: 'secret-value' },
      { raw: '2026-09-04 startup desktop-running: 100ms\nlifecycle.log' },
    ]) {
      expect(() => {
        assertPortableMacEvidence(unsafe)
      }).toThrow(/portable macOS evidence/i)
    }
  })

  it('collects ten cold and ten warm launches with all six optional runtime details', () => {
    const source = readFileSync(runtimeEvidence, 'utf8')
    expect(source).toContain('const SAMPLE_COUNT = 10')
    expect(source).toContain("const BASELINE_VERSION = '0.5.3'")
    expect(source).toContain("const CANDIDATE_VERSION = '0.5.4'")
    expect(source).toContain("sampleKind: 'cold' | 'warm' | 'warm-prime'")
    expect(source).toContain('PROFILE_BOOT_DETAIL_PHASES')
    expect(source).toContain('hdiutil')
    expect(source).toContain("'verify'")
    expect(source).toContain("'attach'")
    expect(source).toContain("'detach'")
    expect(source).toContain('Promise.allSettled')
    expect(source).toContain('detached: true')
    expect(source).toContain('DSH_HOME: harnessHome')
    expect(source).toContain('`--user-data-dir=${userData}`')
    expect(source).not.toContain('if (!comparison.passed)')
    expect(source).not.toContain('...process.env')
    expect(source).not.toContain('/Applications/')
  })

  it('detaches a mount when product validation fails before a descriptor is returned', () => {
    const source = readFileSync(runtimeEvidence, 'utf8')
    expect(source).toContain('let attached = false')
    expect(source).toContain('attached = true')
    expect(source).toContain('if (attached)')
    expect(source).toContain('await detachMountPoint(mountPoint)')
  })

  it('wires only bounded Mac evidence into the release job', () => {
    const workflow = loadReleaseWorkflow()
    const jobs = workflow.jobs as Record<string, { steps?: unknown[] }>
    const mac = jobs.mac
    if (!Array.isArray(mac?.steps)) throw new TypeError('Mac release job must define steps')
    const serialized = JSON.stringify(mac)

    expect(serialized).toContain('desktop-v0.5.3')
    expect(serialized).toContain('DeepSeek-Harness-0.5.3-mac-x64.dmg')
    expect(serialized).toContain('macos-desktop-runtime-evidence.ts')
    expect(serialized).toContain('macos-native-visual-smoke.spec.ts')
    expect(serialized).toContain('macos-startup-summary.json')
    expect(serialized).toContain('macos-native-visual-evidence')
    expect(serialized).not.toContain('lifecycle.log')
    expect(serialized).not.toContain('cpuprofile')
    expect(serialized).not.toContain('/Applications/')
  })

  it('runs the full packaged feature smoke at native 100 and 150 percent', () => {
    expect(existsSync(nativeVisual)).toBe(true)
    if (!existsSync(nativeVisual)) return
    const source = readFileSync(nativeVisual, 'utf8')
    expect(source).toContain('runPackagedDesktopSmoke')
    expect(source).toContain('[100, 150]')
    expect(source).toContain('--force-device-scale-factor=')
    expect(source).toContain('primaryDisplayScaleFactor')
    expect(source).toContain('titlebarCssPixels')
    expect(source).not.toContain('1_600 * scaleFactor')
    expect(source).toContain('DSH_DESKTOP_SMOKE_ROOT')
    expect(source).toContain('desktop-smoke-titlebar-darwin.png')
    expect(source).toContain('data-open-design-state="installed"')
    expect(source).not.toContain('/Applications/')
    expect(source).not.toContain('~/.dsh')
  })
})
