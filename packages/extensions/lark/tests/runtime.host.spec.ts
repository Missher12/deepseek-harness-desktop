import { describe, expect, test, vi } from 'vitest'
import { LarkRuntimeController } from '../src/runtime.ts'

function harness() {
  const transport = { start: vi.fn(async () => {}), stop: vi.fn() }
  const mux = { start: vi.fn(async () => {}), stop: vi.fn() }
  const inbox = { recover: vi.fn(async () => {}), pause: vi.fn(async () => {}), resume: vi.fn(async () => {}) }
  const cleanup = vi.fn(async () => 2)
  const controller = new LarkRuntimeController({ transport, mux, inbox, cleanup })
  return { controller, transport, mux, inbox, cleanup }
}

describe('Lark runtime lifecycle', () => {
  test('starts ingress and mux, then recovers the durable queue on initial activation', async () => {
    const h = harness()
    await h.controller.start(true)
    expect(h.transport.start).toHaveBeenCalledOnce()
    expect(h.mux.start).toHaveBeenCalledOnce()
    expect(h.inbox.recover).toHaveBeenCalledOnce()
    expect(h.controller.status()).toMatchObject({ enabled: true, connected: true, queuePaused: false })
  })

  test('disable rejects ingress first, tears down resources, and pauses pending remote work', async () => {
    const h = harness()
    await h.controller.start(true)
    await h.controller.disable()
    expect(h.transport.stop).toHaveBeenCalledOnce()
    expect(h.mux.stop).toHaveBeenCalledOnce()
    expect(h.inbox.pause).toHaveBeenCalledOnce()
    expect(h.cleanup).toHaveBeenCalledOnce()
    expect(h.controller.status()).toMatchObject({ enabled: false, connected: false, queuePaused: true })
  })

  test('re-enable reconnects but requires an explicit local queue resume', async () => {
    const h = harness()
    await h.controller.start(true)
    await h.controller.disable()
    await h.controller.enable()
    expect(h.inbox.resume).not.toHaveBeenCalled()
    expect(h.controller.status()).toMatchObject({ enabled: true, connected: true, queuePaused: true })
    await h.controller.resumeQueue()
    expect(h.inbox.resume).toHaveBeenCalledOnce()
    expect(h.controller.status().queuePaused).toBe(false)
  })

  test('dispose is idempotent and leaves no receiver or mux', async () => {
    const h = harness()
    await h.controller.start(true)
    await h.controller.dispose()
    await h.controller.dispose()
    expect(h.transport.stop).toHaveBeenCalledOnce()
    expect(h.mux.stop).toHaveBeenCalledOnce()
    expect(h.controller.status()).toMatchObject({ enabled: false, connected: false })
  })
})
