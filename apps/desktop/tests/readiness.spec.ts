import { describe, expect, it, vi } from 'vitest'
import { waitForHarness } from '../src/harness/readiness.ts'

describe('waitForHarness', () => {
  it('settles only when the root includes the boot manifest', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('starting', { status: 503 }))
      .mockResolvedValueOnce(new Response(
        '<script>globalThis["__DSH_BOOT__"] = {"rev":"rc.2","entries":[]}</script>',
        { status: 200 },
      ))

    await expect(waitForHarness('http://127.0.0.1:1234/', {
      fetch,
      delay: async () => undefined,
      now: vi.fn()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0)
        .mockReturnValue(51),
      timeoutMs: 50,
    })).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps compatibility with the legacy window assignment', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response('<script>window.__DSH_BOOT__={"rev":"legacy","entries":[]}</script>', { status: 200 }),
    )

    await expect(waitForHarness('http://127.0.0.1:1234/', {
      fetch,
      delay: async () => undefined,
      now: () => 0,
      timeoutMs: 50,
    })).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('settles on the alpha.5 token exchange without following its redirect', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 303,
      headers: { location: '/' },
    }))

    await expect(waitForHarness('http://127.0.0.1:1234/?token=AbCdEf-9_8', {
      fetch,
      delay: async () => undefined,
      now: () => 0,
      timeoutMs: 50,
    })).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })

  it('keeps probing through non-exchange redirects and errors', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: '/failure.html' } }))
      .mockResolvedValueOnce(new Response('<script>globalThis["__DSH_BOOT__"] = {}</script>', { status: 200 }))

    await expect(waitForHarness('http://127.0.0.1:1234/', {
      fetch,
      delay: async () => undefined,
      now: vi.fn()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0)
        .mockReturnValue(51),
      timeoutMs: 50,
    })).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('reports the readiness deadline after unsuccessful responses', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('starting', { status: 503 }))
    const now = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(51)

    await expect(waitForHarness('http://127.0.0.1:1234/', {
      fetch,
      delay: async () => undefined,
      now,
      timeoutMs: 50,
    })).rejects.toThrow(/readiness deadline/)
  })
})
