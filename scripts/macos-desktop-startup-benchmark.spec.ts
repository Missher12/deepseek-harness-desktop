import { describe, expect, it } from 'vitest'
import { summarizeMacosStartupRuns, type MacosStartupRun } from './macos-desktop-startup-benchmark.ts'

function sample(index: number): MacosStartupRun {
  return {
    sourceSha: '1'.repeat(40), appSha256: '2'.repeat(64), fixtureSha256: '3'.repeat(64),
    scenario: 'fresh',
    startup: {
      'app-ready': 5, 'window-prerequisites': 12, 'loading-visible': 35,
      'fallback-ready': 20, 'url-reported': 90, 'harness-ready': 105, 'desktop-running': 120,
    },
    windowObservedMs: 200, composerReadyMs: 1000 + index * 100,
    keyboardReadyMs: 1200 + index * 100, onboardingMs: 50,
    remainingProcesses: 0, remainingListeners: 0, protectedDataUnchanged: true,
  }
}

describe('macOS native startup measurements', () => {
  it('does not substitute completed backend navigation for usable input and keyboard response', () => {
    const summary = summarizeMacosStartupRuns(Array.from({ length: 10 }, (_, index) => sample(index)))
    expect(summary).toMatchObject({
      sampleCount: 10,
      timeline: { total: { medianMs: 120, p95Ms: 120 } },
      interaction: {
        composerReady: { medianMs: 1450, p95Ms: 1900 },
        keyboardReady: { medianMs: 1650, p95Ms: 2100 },
        onboarding: { medianMs: 50, p95Ms: 50 },
      },
    })
  })

  it.each([
    ['scenario', 'large-history'], ['sourceSha', '4'.repeat(40)],
    ['appSha256', '4'.repeat(64)], ['fixtureSha256', '4'.repeat(64)],
  ] as const)('rejects a mixed %s instead of pooling incomparable launches', (field, value) => {
    const runs = Array.from({ length: 10 }, (_, index) => sample(index))
    Object.assign(runs[9]!, { [field]: value })
    expect(() => summarizeMacosStartupRuns(runs)).toThrow(/incomparable/u)
  })

  it.each([
    { composerReadyMs: Number.NaN }, { keyboardReadyMs: -1 },
    { windowObservedMs: 1100 }, { keyboardReadyMs: 999 }, { onboardingMs: 1100 },
  ])('rejects missing or reversed interaction measurements: %j', (invalid) => {
    const runs = Array.from({ length: 10 }, (_, index) => sample(index))
    Object.assign(runs[0]!, invalid)
    expect(() => summarizeMacosStartupRuns(runs)).toThrow(/interaction/u)
  })

  it.each([
    { remainingProcesses: 1 }, { remainingListeners: 1 }, { protectedDataUnchanged: false },
  ])('refuses successful timing evidence when cleanup or protected data failed: %j', (invalid) => {
    const runs = Array.from({ length: 10 }, (_, index) => sample(index))
    Object.assign(runs[0]!, invalid)
    expect(() => summarizeMacosStartupRuns(runs)).toThrow(/cleanup/u)
  })

  it('rejects invalid provenance without copying the invalid value into the error', () => {
    const runs = Array.from({ length: 10 }, (_, index) => sample(index))
    runs.forEach((run) => { run.sourceSha = 'do-not-copy-user-path-or-token' })
    expect(() => summarizeMacosStartupRuns(runs)).toThrow('macOS startup: invalid provenance')
  })

  it('requires ten samples and retains no unknown diagnostic properties', () => {
    expect(() => summarizeMacosStartupRuns([sample(0)])).toThrow(/ten/u)
    const runs = Array.from({ length: 10 }, (_, index) => ({ ...sample(index), rawLog: 'PRIVATE-DIAGNOSTIC' }))
    const summary = summarizeMacosStartupRuns(runs)
    expect(JSON.stringify(summary)).not.toContain('PRIVATE-DIAGNOSTIC')
  })
})
