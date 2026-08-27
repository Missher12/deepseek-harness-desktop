import { describe, expect, it, vi } from 'vitest'
import { DesktopStartupTimeline } from '../src/startup-timeline.ts'

describe('DesktopStartupTimeline', () => {
  it('logs only fixed milestone names and bounded elapsed durations', () => {
    const log = vi.fn<(message: string) => void>()
    let now = 10
    const timeline = new DesktopStartupTimeline(log, () => now)

    now = 25.4
    timeline.mark('app-ready')
    now = 43.8
    timeline.mark('harness-ready')

    expect(log.mock.calls.map(([line]) => line)).toEqual([
      'startup app-ready: 15ms',
      'startup harness-ready: 34ms',
    ])
  })
})
