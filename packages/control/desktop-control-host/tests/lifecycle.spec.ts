import { describe, expect, it, vi } from 'vitest'
import {
  ControlLeaseId,
  RequestId,
  SessionId,
  type ControlLeaseAcquireResult,
  type DecodedDesktopControlEnvelope,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  ControlLeaseCache,
  ControlLifecycleCoordinator,
  type DesktopControlRequester,
} from '../src/index.ts'

const SESSION = SessionId('lifecycle-session')
const LEASE = ControlLeaseId('00000000-0000-4000-8000-000000000041')

function lease(): ControlLeaseAcquireResult {
  return Object.freeze({
    leaseId: LEASE,
    leaseRevision: 3,
    surfaceKind: 'browser-ephemeral',
    targets: Object.freeze([]),
    capabilities: Object.freeze(['observe'] as const),
    idleExpiresAfterMs: 300_000,
    hardExpiresAfterMs: 1_200_000,
  })
}

function releaseEnvelope(requestId: ReturnType<typeof RequestId>): DecodedDesktopControlEnvelope {
  return {
    message: {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestId,
      requestKind: 'control.lease.release',
      result: { released: true },
    },
  }
}

describe('ControlLifecycleCoordinator', () => {
  it('invalidates synchronously and awaits release at agent/turn-stopping with an independent signal', async () => {
    const cache = new ControlLeaseCache()
    cache.remember(SESSION, lease())
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const observedSignals: AbortSignal[] = []
    const requester: DesktopControlRequester = {
      request: vi.fn<DesktopControlRequester['request']>(async (request, signal) => {
        observedSignals.push(signal)
        await held
        return releaseEnvelope(request.requestId)
      }),
      revokeSession: vi.fn(async () => undefined),
    }
    const lifecycle = new ControlLifecycleCoordinator(requester, cache, {
      now: () => 10_000,
      requestId: () => RequestId('00000000-0000-4000-8000-000000000101'),
    })
    const turnSignal = new AbortController().signal

    const stopping = lifecycle.turnStopping(SESSION, turnSignal)
    expect(cache.peek(SESSION)).toBeUndefined()
    expect(observedSignals[0]).not.toBe(turnSignal)
    let settled = false
    void stopping.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await stopping
  })

  it('queues a fire-and-forget turn/end fallback and drains it at session/flush', async () => {
    const cache = new ControlLeaseCache()
    cache.remember(SESSION, lease())
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const requester: DesktopControlRequester = {
      request: vi.fn<DesktopControlRequester['request']>(async (request) => {
        await held
        return releaseEnvelope(request.requestId)
      }),
      revokeSession: vi.fn(async () => undefined),
    }
    const lifecycle = new ControlLifecycleCoordinator(requester, cache, {
      now: () => 10_000,
      requestId: () => RequestId('00000000-0000-4000-8000-000000000102'),
    })

    lifecycle.observeTurnEnd(SESSION)
    expect(cache.peek(SESSION)).toBeUndefined()
    const flush = lifecycle.flush(SESSION)
    let settled = false
    void flush.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await flush
  })

  it('makes disposal idempotently release then revoke and drains every tail before teardown', async () => {
    const cache = new ControlLeaseCache()
    cache.remember(SESSION, lease())
    const order: string[] = []
    const requester: DesktopControlRequester = {
      request: vi.fn<DesktopControlRequester['request']>(async (request) => {
        order.push('release')
        return releaseEnvelope(request.requestId)
      }),
      revokeSession: vi.fn(async () => { order.push('session.revoke') }),
    }
    const lifecycle = new ControlLifecycleCoordinator(requester, cache, {
      now: () => 10_000,
      requestId: () => RequestId('00000000-0000-4000-8000-000000000103'),
    })

    lifecycle.disposeSession(SESSION)
    lifecycle.disposeSession(SESSION)
    await lifecycle.dispose()

    expect(order).toEqual(['release', 'session.revoke'])
  })

  it('contains transport cleanup failures so ordinary chat lifecycle still settles', async () => {
    const cache = new ControlLeaseCache()
    cache.remember(SESSION, lease())
    const requester: DesktopControlRequester = {
      request: vi.fn(async () => { throw new Error('control link lost') }),
      revokeSession: vi.fn(async () => { throw new Error('control link lost') }),
    }
    const lifecycle = new ControlLifecycleCoordinator(requester, cache, {
      now: () => 10_000,
      requestId: () => RequestId('00000000-0000-4000-8000-000000000104'),
    })

    await expect(lifecycle.turnStopping(SESSION, new AbortController().signal)).resolves.toBeUndefined()
    lifecycle.disposeSession(SESSION)
    await expect(lifecycle.flush(SESSION)).resolves.toBeUndefined()
    await expect(lifecycle.dispose()).resolves.toBeUndefined()
  })
})
