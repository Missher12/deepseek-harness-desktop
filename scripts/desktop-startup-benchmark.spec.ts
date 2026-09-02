import { describe, expect, it } from 'vitest'
import {
  parseDesktopStartupSample,
  summarizeDesktopStartupSamples,
} from './desktop-startup-benchmark.ts'

const startupLog = (durations: readonly number[]): string => [
  'unrelated lifecycle message',
  `startup app-ready: ${String(durations[0])}ms`,
  `startup window-prerequisites: ${String(durations[1])}ms`,
  `startup fallback-ready: ${String(durations[3])}ms`,
  `startup loading-visible: ${String(durations[2])}ms`,
  `startup url-reported: ${String(durations[4])}ms`,
  `startup harness-ready: ${String(durations[5])}ms`,
  `startup desktop-running: ${String(durations[6])}ms`,
].map(line => line.startsWith('startup ') ? `2026-09-02T15:00:00.000Z ${line}` : line).join('\n')

describe('desktop startup benchmark', () => {
  it('parses each fixed milestone once while allowing the two causal chains to interleave', () => {
    expect(parseDesktopStartupSample(startupLog([5, 12, 35, 20, 90, 105, 120]))).toEqual({
      'app-ready': 5,
      'window-prerequisites': 12,
      'loading-visible': 35,
      'fallback-ready': 20,
      'url-reported': 90,
      'harness-ready': 105,
      'desktop-running': 120,
    })
  })

  it.each([
    ['missing', startupLog([5, 12, 35, 20, 90, 105, 120]).replace('startup url-reported: 90ms\n', '')],
    ['duplicate', `${startupLog([5, 12, 35, 20, 90, 105, 120])}\nstartup url-reported: 90ms`],
    ['unknown', `${startupLog([5, 12, 35, 20, 90, 105, 120])}\nstartup profile-path: 121ms`],
    ['negative duration', startupLog([5, 12, 35, 20, 90, 105, 120]).replace('url-reported: 90ms', 'url-reported: -1ms')],
    ['non-finite duration', startupLog([5, 12, 35, 20, 90, 105, 120]).replace('url-reported: 90ms', 'url-reported: Infinityms')],
    ['window-chain reversal', startupLog([5, 40, 35, 20, 90, 105, 120])],
    ['Harness-chain reversal', startupLog([5, 12, 35, 20, 19, 105, 120])],
  ])('rejects a %s startup record', (_label, content) => {
    expect(() => parseDesktopStartupSample(content)).toThrow(/startup benchmark/i)
  })

  it('computes deterministic median and nearest-rank P95 values from exactly five samples', () => {
    const samples = [120, 80, 110, 100, 90].map(total => parseDesktopStartupSample(
      startupLog([5, 12, 35, 20, total - 30, total - 15, total]),
    ))

    expect(summarizeDesktopStartupSamples(samples)).toMatchObject({
      sampleCount: 5,
      total: { medianMs: 100, p95Ms: 120 },
      fallbackToUrl: { medianMs: 50, p95Ms: 70 },
    })
    expect(() => summarizeDesktopStartupSamples(samples.slice(0, 4))).toThrow(/exactly five/i)
  })
})
