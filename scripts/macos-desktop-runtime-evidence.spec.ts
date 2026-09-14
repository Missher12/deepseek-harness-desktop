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
  assertMacHistoricalVersion?: (role: 'baseline' | 'candidate', actualVersion: string) => void
}

const runtime = runtimeEvidenceModule as RuntimeEvidenceModule

function loadNativeWorkflow(): Record<string, unknown> {
  const loaded: unknown = yaml.load(readFileSync(resolve(repositoryRoot, '.github/workflows/macos-desktop.yml'), 'utf8'))
  if (loaded === null || typeof loaded !== 'object' || Array.isArray(loaded)) {
    throw new TypeError('Mac native workflow must be an object')
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

  it('keeps ten cold and ten warm samples confined to the optional historical comparison', () => {
    const source = readFileSync(runtimeEvidence, 'utf8')
    expect(source).toContain('const SAMPLE_COUNT = 10')
    expect(source).toContain("const BASELINE_VERSION = '0.5.3'")
    expect(source).toContain("const CANDIDATE_VERSION = '0.5.5'")
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

  it('rejects a current release passed to the historical candidate role', () => {
    const check = runtime.assertMacHistoricalVersion
    expect(check).toBeTypeOf('function')
    if (check === undefined) return
    expect(() => { check('baseline', '0.5.3') }).not.toThrow()
    expect(() => { check('candidate', '0.5.5') }).not.toThrow()
    expect(() => { check('candidate', '0.6.0') }).toThrow(/historical/i)
    expect(() => { check('baseline', '0.5.5') }).toThrow(/historical/i)
  })

  it('keeps the Mac native job read-only and independent of the historical publisher', () => {
    const workflow = loadNativeWorkflow()
    expect(workflow.permissions).toMatchObject({ contents: 'read' })
    const jobs = workflow.jobs as Record<string, { steps?: unknown[] }>
    const mac = jobs['build-native-smoke']
    if (!Array.isArray(mac?.steps)) throw new TypeError('Mac native job must define steps')
    const serialized = JSON.stringify(mac)
    expect(serialized).toContain('CANDIDATE_SHA')
    expect(serialized).toContain('macos-native-visual-smoke.spec.ts')
    expect(serialized).toContain('macos-native-evidence')
    expect(serialized).not.toContain('desktop-v0.5.3')
    expect(serialized).not.toContain('gh release upload')
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
    expect(source).toContain('assertRetiredMacResourcesAbsent')
    expect(source).toContain('retiredResourcePathsAbsent')
    expect(source).toContain('app.asar.unpacked/node_modules/@deepseek-ai/dsh-desktop-workbench')
    expect(source).toContain('app.asar.unpacked/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin')
    expect(source).toContain('app.asar.unpacked/node_modules/@open-design/dsh-runtime')
    expect(source).not.toContain('isolated-fixture-detected')
    expect(source).not.toContain('data-open-design-state="installed"')
    expect(source).not.toContain('/Applications/')
    expect(source).not.toContain('~/.dsh')
  })
})
