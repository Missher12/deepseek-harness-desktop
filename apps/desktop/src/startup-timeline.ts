/** Fixed, non-sensitive milestones used to diagnose Desktop startup latency. */
export type DesktopStartupMilestone =
  | 'app-ready'
  | 'window-prerequisites'
  | 'loading-visible'
  | 'fallback-ready'
  | 'url-reported'
  | 'harness-ready'
  | 'desktop-running'

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
