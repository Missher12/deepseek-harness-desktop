import { describe, expect, it, vi } from 'vitest'
import { createNativeVisualTrayEvidenceController } from '../src/native-visual-tray-evidence.ts'

function createClock() {
  const timer = { unref: vi.fn() }
  let callback: (() => void) | undefined
  const clock = {
    now: vi.fn(() => new Date('2026-09-03T00:00:00.000Z')),
    schedule: vi.fn((next: () => void) => {
      callback = next
      return timer
    }),
    cancel: vi.fn(),
  }
  return { clock, timer, runSample: () => { callback?.() } }
}

describe('native visual tray evidence', () => {
  it('does not schedule or write anything when the exact test switch is disabled', () => {
    const { clock } = createClock()
    const write = vi.fn(async () => {})
    const controller = createNativeVisualTrayEvidenceController({ enabled: false, write, clock })

    controller.start({
      iconSize: 16,
      getBounds: () => ({ x: 1, y: 2, width: 16, height: 16 }),
      dipToScreenPoint: point => point,
    })

    expect(clock.schedule).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('writes only the bounded schema with a physical center point', async () => {
    const { clock, timer, runSample } = createClock()
    const write = vi.fn(async () => {})
    const controller = createNativeVisualTrayEvidenceController({ enabled: true, write, clock })

    controller.start({
      iconSize: 24,
      getBounds: () => ({ x: 10, y: 20, width: 23, height: 25 }),
      dipToScreenPoint: point => ({ x: point.x * 2, y: point.y * 2 }),
    })
    runSample()
    await Promise.resolve()

    expect(clock.schedule).toHaveBeenCalledWith(expect.any(Function), 250)
    expect(timer.unref).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith({
      schemaVersion: 1,
      observedAt: '2026-09-03T00:00:00.000Z',
      iconSize: 24,
      bounds: { x: 10, y: 20, width: 23, height: 25 },
      clickPoint: { x: 44, y: 66 },
    })
  })

  it('clears the timer and ignores invalid or rejected samples', async () => {
    const { clock, timer, runSample } = createClock()
    const write = vi.fn(async () => { throw new Error('write rejected') })
    const controller = createNativeVisualTrayEvidenceController({ enabled: true, write, clock })

    controller.start({
      iconSize: 16,
      getBounds: () => ({ x: 0, y: 0, width: 16, height: 16 }),
      dipToScreenPoint: point => point,
    })
    expect(() => { runSample() }).not.toThrow()
    await Promise.resolve()
    controller.stop()

    expect(clock.cancel).toHaveBeenCalledWith(timer)
    expect(write).toHaveBeenCalledOnce()

    controller.start({
      iconSize: 16,
      getBounds: () => ({ x: 0, y: 0, width: 0, height: 16 }),
      dipToScreenPoint: point => point,
    })
    runSample()
    expect(write).toHaveBeenCalledOnce()
  })
})
