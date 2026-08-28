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
const SESSION_INSTANCE = Object.freeze({ id: SESSION })
const LEASE = ControlLeaseId('00000000-0000-4000-8000-000000000041')
const NEXT_LEASE = ControlLeaseId('00000000-0000-4000-8000-000000000042')

function lease(
  leaseId: ReturnType<typeof ControlLeaseId> = LEASE,
  leaseRevision = 3,
): ControlLeaseAcquireResult {
  return Object.freeze({
    leaseId,
    leaseRevision,
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

    const stopping = lifecycle.turnStopping(SESSION_INSTANCE, turnSignal)
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

    lifecycle.observeTurnEnd(SESSION_INSTANCE)
    expect(cache.peek(SESSION)).toBeUndefined()
    const flush = lifecycle.flush(SESSION_INSTANCE)
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

    lifecycle.disposeSession(SESSION_INSTANCE)
    lifecycle.disposeSession(SESSION_INSTANCE)
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

    await expect(lifecycle.turnStopping(SESSION_INSTANCE, new AbortController().signal)).resolves.toBeUndefined()
    lifecycle.disposeSession(SESSION_INSTANCE)
    await expect(lifecycle.flush(SESSION_INSTANCE)).resolves.toBeUndefined()
    await expect(lifecycle.dispose()).resolves.toBeUndefined()
  })

  it('treats disposal as idempotent per concrete lifecycle generation, not forever per session id', async () => {
    const cache = new ControlLeaseCache()
    const order: string[] = []
    const requester: DesktopControlRequester = {
      request: vi.fn<DesktopControlRequester['request']>(async (request) => {
        if (request.requestKind !== 'control.lease.release') throw new Error('unexpected request')
        order.push(`release:${String(request.leaseRevision)}`)
        return releaseEnvelope(request.requestId)
      }),
      revokeSession: vi.fn(async () => { order.push('session.revoke') }),
    }
    const lifecycle = new ControlLifecycleCoordinator(requester, cache, {
      now: () => 10_000,
      requestId: (() => {
        let sequence = 200
        return () => RequestId(`00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`)
      })(),
    })
    const original = { id: SESSION }
    const recreated = { id: SESSION }

    lifecycle.sessionCreated(original)
    lifecycle.sessionCreated(original)
    cache.remember(SESSION, lease())
    lifecycle.disposeSession(original)
    lifecycle.disposeSession(original)
    await lifecycle.dispose()

    lifecycle.sessionCreated(recreated)
    cache.remember(SESSION, lease(NEXT_LEASE, 4))
    lifecycle.disposeSession(recreated)
    lifecycle.disposeSession(recreated)
    await lifecycle.dispose()

    expect(order).toEqual([
      'release:3',
      'session.revoke',
      'release:4',
      'session.revoke',
    ])
  })

  it('isolates an old release tail from a recreated same-id session generation', async () => {
    const cache = new ControlLeaseCache()
    const order: string[] = []
    let releaseOld!: () => void
    const oldHeld = new Promise<void>((resolve) => { releaseOld = resolve })
    const requester: DesktopControlRequester = {
      request: vi.fn<DesktopControlRequester['request']>(async (request) => {
        if (request.requestKind !== 'control.lease.release') throw new Error('unexpected request')
        if (request.leaseRevision === 3) {
          order.push('old-release:start')
          await oldHeld
          order.push('old-release:end')
        } else {
          order.push('new-release')
        }
        return releaseEnvelope(request.requestId)
      }),
      revokeSession: vi.fn(async () => { order.push('new-session.revoke') }),
    }
    const lifecycle = new ControlLifecycleCoordinator(requester, cache, {
      now: () => 10_000,
      requestId: (() => {
        let sequence = 300
        return () => RequestId(`00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`)
      })(),
    })
    const original = { id: SESSION }
    const recreated = { id: SESSION }

    lifecycle.sessionCreated(original)
    cache.remember(SESSION, lease())
    lifecycle.disposeSession(original)
    await vi.waitFor(() => { expect(order).toContain('old-release:start') })

    lifecycle.sessionCreated(recreated)
    cache.remember(SESSION, lease(NEXT_LEASE, 4))
    lifecycle.disposeSession(recreated)
    await lifecycle.flush(recreated)

    expect(order).toEqual(['old-release:start', 'new-release', 'new-session.revoke'])
    releaseOld()
    await lifecycle.dispose()
    expect(order).toEqual([
      'old-release:start',
      'new-release',
      'new-session.revoke',
      'old-release:end',
    ])
  })
})
