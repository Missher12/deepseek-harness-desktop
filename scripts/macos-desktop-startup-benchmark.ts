import { summarizeDesktopStartupSamples, type DesktopStartupSample } from './desktop-startup-benchmark.ts'

/** Sanitized measurements from one owned macOS native launch. */
export interface MacosStartupRun {
  sourceSha: string
  appSha256: string
  scenario: string
  fixtureSha256: string
  startup: DesktopStartupSample
  windowObservedMs: number
  composerReadyMs: number
  keyboardReadyMs: number
  onboardingMs: number
  remainingProcesses: number
  remainingListeners: number
  protectedDataUnchanged: boolean
}

const SCENARIOS = new Set([
  'fresh', 'process-cold', 'warm', 'large-history', 'plugins',
  'unreachable-provider', 'corrupt-cache', 'inaccessible-cache',
])

function durationSummary(values: readonly number[]) {
  const ordered = [...values].sort((left, right) => left - right)
  const lower = ordered[4]
  const upper = ordered[5]
  const p95 = ordered[9]
  if (lower === undefined || upper === undefined || p95 === undefined) {
    throw new Error('macOS startup: summary requires ten samples')
  }
  return { medianMs: (lower + upper) / 2, p95Ms: p95 }
}

/**
 * Summarize comparable native launches independently of backend readiness.
 * @param runs - Ten completed, sanitized native observations from one scenario.
 * @returns Backend and interaction timing summaries.
 */
export function summarizeMacosStartupRuns(runs: readonly MacosStartupRun[]) {
  const first = runs[0]
  if (runs.length !== 10 || first === undefined) {
    throw new Error('macOS startup: summary requires ten samples')
  }
  for (const run of runs) {
    if (!/^[a-f0-9]{40}$/u.test(run.sourceSha)
      || !/^[a-f0-9]{64}$/u.test(run.appSha256)
      || !/^[a-f0-9]{64}$/u.test(run.fixtureSha256)
      || !SCENARIOS.has(run.scenario)) {
      throw new Error('macOS startup: invalid provenance')
    }
    if (run.scenario !== first.scenario || run.sourceSha !== first.sourceSha
      || run.appSha256 !== first.appSha256 || run.fixtureSha256 !== first.fixtureSha256) {
      throw new Error('macOS startup: incomparable launches')
    }
    const times = [run.windowObservedMs, run.composerReadyMs, run.keyboardReadyMs, run.onboardingMs]
    if (times.some(value => !Number.isFinite(value) || value < 0)
      || run.composerReadyMs < run.windowObservedMs || run.keyboardReadyMs < run.composerReadyMs
      || run.onboardingMs > run.composerReadyMs) {
      throw new Error('macOS startup: invalid interaction timing')
    }
    if (run.remainingProcesses !== 0 || run.remainingListeners !== 0 || !run.protectedDataUnchanged) {
      throw new Error('macOS startup: cleanup or protected data failed')
    }
  }
  return {
    schemaVersion: 1,
    sourceSha: first.sourceSha,
    appSha256: first.appSha256,
    scenario: first.scenario,
    fixtureSha256: first.fixtureSha256,
    sampleCount: 10,
    p95Definition: 'nearest-rank; ten-sample maximum',
    timeline: summarizeDesktopStartupSamples(runs.map(run => run.startup)),
    interaction: {
      windowObserved: durationSummary(runs.map(run => run.windowObservedMs)),
      composerReady: durationSummary(runs.map(run => run.composerReadyMs)),
      keyboardReady: durationSummary(runs.map(run => run.keyboardReadyMs)),
      onboarding: durationSummary(runs.map(run => run.onboardingMs)),
    },
  }
}
