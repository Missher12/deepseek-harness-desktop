import { describe, expect, it, vi } from 'vitest'
import {
  DesktopStartupTimeline,
  parseHarnessStartupTimingLine,
} from '../src/startup-timeline.ts'

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

  it('accepts only fixed child phases with a non-negative finite duration', () => {
    expect(parseHarnessStartupTimingLine('dsh desktop-startup loader-mount: 42ms')).toEqual({
      phase: 'loader-mount',
      milliseconds: 42,
    })
    expect(parseHarnessStartupTimingLine('ordinary harness output')).toBeUndefined()
    expect(() => parseHarnessStartupTimingLine('dsh desktop-startup profile-path: 42ms')).toThrow(/timing/i)
    expect(() => parseHarnessStartupTimingLine('dsh desktop-startup loader-mount: C:\\secret')).toThrow(/timing/i)
    expect(() => parseHarnessStartupTimingLine('dsh desktop-startup loader-mount: -1ms')).toThrow(/timing/i)
  })
})
