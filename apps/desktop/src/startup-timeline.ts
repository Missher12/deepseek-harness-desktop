/** Fixed, non-sensitive milestones used to diagnose Desktop startup latency. */
export type DesktopStartupMilestone =
  | 'app-ready'
  | 'window-prerequisites'
  | 'loading-visible'
  | 'fallback-ready'
  | 'url-reported'
  | 'harness-ready'
  | 'desktop-running'

/** Fixed child-process phases accepted by Desktop diagnostics. */
export const HARNESS_STARTUP_TIMING_PHASES = [
  'profile-compose',
  'loader-mount',
  'loader-settle',
  'activation-audit',
  'loader-build-duration',
  'root-include-duration',
  'first-party-import-duration',
  'root-activation-duration',
  'settle-duration',
  'audit-duration',
] as const

/** One fixed child-process timing phase. */
export type HarnessStartupTimingPhase = typeof HARNESS_STARTUP_TIMING_PHASES[number]

/** Parsed child timing with no path, URL, configuration, or plugin fields. */
export interface HarnessStartupTiming {
  phase: HarnessStartupTimingPhase
  milliseconds: number
}

const HARNESS_STARTUP_TIMING_PHASE_SET = new Set<string>(HARNESS_STARTUP_TIMING_PHASES)

/** Parse one exact Desktop child timing line; unrelated output is ignored. */
export function parseHarnessStartupTimingLine(line: string): HarnessStartupTiming | undefined {
  if (!line.startsWith('dsh desktop-startup ')) return undefined
  const match = /^dsh desktop-startup ([a-z-]+): ([0-9]+)ms$/u.exec(line)
  if (match === null) throw new Error('Harness startup timing line is malformed.')
  const [, phase, rawMilliseconds] = match
  if (phase === undefined || !HARNESS_STARTUP_TIMING_PHASE_SET.has(phase) || rawMilliseconds === undefined) {
    throw new Error('Harness startup timing phase is not allowed.')
  }
  const milliseconds = Number(rawMilliseconds)
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error('Harness startup timing duration is invalid.')
  }
  return { phase: phase as HarnessStartupTimingPhase, milliseconds }
}

/** Records elapsed startup time without logging paths, URLs, configuration, or credentials. */
export class DesktopStartupTimeline {
  private readonly startedAt: number

  constructor(
    private readonly log: (message: string) => void,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.startedAt = this.now()
  }

  mark(milestone: DesktopStartupMilestone): void {
    const elapsed = this.now() - this.startedAt
    const milliseconds = Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0
    this.log(`startup ${milestone}: ${String(milliseconds)}ms`)
  }
}
