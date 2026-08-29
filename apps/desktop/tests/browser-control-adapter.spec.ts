import { describe, expect, it, vi } from 'vitest'
import {
  RequestId,
  type BridgeRequest,
  type ControlLeaseAcquireRequest,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type { ActiveControlLease } from '../src/control/control-lease.ts'
import {
  BrowserDesktopControlAdapter,
  type BrowserSemanticControl,
} from '../src/browser/control-adapter.ts'
import { AgentBrowserError, WORKBENCH_BROWSER_PARTITION } from '../src/browser/contracts.ts'
import {
  BrowserSurfaceManager,
  type BrowserSurfaceMount,
  type BrowserSurfaceResource,
  type BrowserSurfaceToken,
} from '../src/browser/surface-manager.ts'
import { BrowserTakeoverAuthority } from '../src/browser/takeover.ts'

const SESSION = 'official-session' as ControlLeaseAcquireRequest['sessionId']
const LEASE = '00000000-0000-4000-8000-000000000001' as ActiveControlLease['leaseId']
const idleFailedMountCleanup = {
  failedMountCleanupFor: () => undefined,
  retryFailedMountCleanup: async () => {},
}

function base<K extends BridgeRequest['requestKind']>(requestKind: K) {
  return {
    protocolVersion: 1 as const,
    messageKind: 'request' as const,
    requestKind,
    requestId: RequestId(`00000000-0000-4000-8000-${requestKind.length.toString().padStart(12, '0')}`),
    sessionId: SESSION,
    deadlineUnixMs: Date.now() + 10_000,
  }
}

function acquire(): ControlLeaseAcquireRequest {
  return {
    ...base('control.lease.acquire'),
    surfaceKind: 'browser-ephemeral',
    targets: [],
    capabilities: ['observe', 'pointer', 'keyboard'],
  }
}

function mount(kind: BrowserSurfaceMount['kind'] = 'ephemeral'): BrowserSurfaceMount {
  return {
    sessionId: SESSION,
    surfaceId: 'surface-1',
    generation: 4,
    mountToken: 'mount-4',
    partition: kind === 'ephemeral' ? 'dsh-agent-browser-4-test' : 'persist:dsh-workbench-browser',
    kind,
    visible: true,
  }
}

function semantic(onStop: () => void = () => undefined): BrowserSemanticControl & {
  readonly actions: unknown[]
  readonly stop: ReturnType<typeof vi.fn>
} {
  const actions: unknown[] = []
  return {
    actions,
    currentSnapshotRevision: () => 8,
    start: async () => {},
    snapshot: async ({ includeImage }) => ({
      result: {
        surfaceId: 'surface-1',
        url: 'https://example.test/',
        title: 'Example',
        snapshotRevision: 8,
        semanticText: 'button "Continue"',
        refs: [],
        ...(includeImage ? { image: {
          transferId: '00000000-0000-4000-8000-000000000009',
          byteLength: 4,
          sha256: 'a'.repeat(64),
          width: 1,
          height: 1,
        } } : {}),
      },
      ...(includeImage ? { png: new Uint8Array([1, 2, 3, 4]) } : {}),
    }) as never,
    act: async (action) => {
      actions.push(action)
      return action.kind === 'navigate' || action.kind === 'back'
        || action.kind === 'forward' || action.kind === 'reload'
        ? { url: 'https://example.test/next', snapshotRevision: 9 }
        : action.kind === 'wait'
          ? { waited: true, snapshotRevision: 8 }
          : { acted: true, snapshotRevision: 8 }
    },
    stop: vi.fn(() => {
      onStop()
      return Promise.resolve()
    }),
  }
}

function lease(surfaceKind: ActiveControlLease['surfaceKind'] = 'browser-ephemeral'): ActiveControlLease {
  return {
    leaseId: LEASE,
    leaseRevision: 1,
    generation: 1,
    sessionId: SESSION,
    agentId: 'Agent',
    surfaceKind,
    targets: [],
    capabilities: ['observe', 'pointer', 'keyboard'],
    issuedAt: 0,
    lastActionAt: 0,
    hardExpiresAt: 1_000,
    idleExpiresAfterMs: 300_000,
    hardExpiresAfterMs: 1_200_000,
    remaining: { operations: 1, snapshots: 1, pointerActions: 1, keyActions: 1, textBytes: 1 },
  }
}

describe('Browser Desktop control adapter', () => {
  it.each([
    ['ephemeral', 'browser-ephemeral'],
    ['human-persistent', 'browser-human-persistent'],
  ] as const)('derives %s surface authority from the main-owned mount', async (kind, surfaceKind) => {
    const current = semantic()
    const acquireSurface = vi.fn(async () => mount(kind))
    const adapter = new BrowserDesktopControlAdapter({
      surfaceManager: {
        ...idleFailedMountCleanup,
        acquire: acquireSurface,
        stop: vi.fn(async () => {}),
        release: vi.fn(async () => {}),
      },
      activate: async () => ({ semantic: current, disposeTransport: async () => {} }),
    })

    expect(await adapter.acquireFacts(acquire(), new AbortController().signal)).toEqual({
      surfaceKind,
      targets: [],
      capabilities: ['observe', 'pointer', 'keyboard'],
      policyAllowed: true,
    })
    const reuseSignal = new AbortController().signal
    await adapter.acquireFacts(acquire(), reuseSignal)
    expect(acquireSurface).toHaveBeenNthCalledWith(2, {
      sessionId: SESSION,
      expectedGeneration: 4,
      signal: reuseSignal,
    })
  })

  it('maps the closed protocol roster to semantic actions and preserves snapshot PNG pairing', async () => {
    const current = semantic()
    const adapter = new BrowserDesktopControlAdapter({
      surfaceManager: {
        ...idleFailedMountCleanup,
        acquire: async () => mount(), stop: vi.fn(async () => {}), release: vi.fn(async () => {}),
      },
      activate: async () => ({ semantic: current, disposeTransport: async () => {} }),
    })
    await adapter.acquireFacts(acquire(), new AbortController().signal)
    const context = {
      signal: new AbortController().signal,
      timeoutMs: 2_000,
      generation: 1,
      registerAcquisition: () => true,
    }
    const snapshot = await adapter.dispatch({
      ...base('browser.snapshot'), leaseId: LEASE, leaseRevision: 1, includeImage: true,
    }, context)
    const click = await adapter.dispatch({
      ...base('browser.click'), leaseId: LEASE, leaseRevision: 1,
      ref: 'browser:00000000000000000000000000000001',
    } as BridgeRequest, context)

    expect(snapshot).toMatchObject({
      message: { responseKind: 'ok', requestKind: 'browser.snapshot', result: { surfaceId: 'surface-1' } },
      png: new Uint8Array([1, 2, 3, 4]),
    })
    expect(click).toMatchObject({
      message: { responseKind: 'ok', requestKind: 'browser.click', result: { acted: true } },
    })
    expect(current.actions).toEqual([{
      kind: 'click', ref: 'browser:00000000000000000000000000000001',
    }])
  })

  it('reports operation facts from the live mount and awaits every Stop cleanup owner', async () => {
    const order: string[] = []
    const current = semantic(() => { order.push('debugger') })
    const stop = vi.fn(async (token: BrowserSurfaceToken) => { order.push(`surface:${token.mountToken}`) })
    const release = vi.fn(async (token: BrowserSurfaceToken) => { order.push(`release:${token.mountToken}`) })
    const adapter = new BrowserDesktopControlAdapter({
      surfaceManager: {
        ...idleFailedMountCleanup,
        acquire: async () => mount('human-persistent'),
        stop,
        release,
      },
      activate: async () => ({
        semantic: current,
        disposeTransport: async () => { order.push('transport') },
      }),
    })
    await adapter.acquireFacts(acquire(), new AbortController().signal)

    expect(await adapter.operationFacts({
      ...base('browser.type'), leaseId: LEASE, leaseRevision: 1,
      ref: 'browser:00000000000000000000000000000001', text: 'safe',
    } as BridgeRequest, new AbortController().signal)).toMatchObject({
      surfaceKind: 'browser-human-persistent',
      browserAction: { surfaceId: 'surface-1', navigationRevision: 8 },
      policy: { sensitivity: 'ordinary', effect: 'local-interaction' },
    })

    await adapter.stopLease(lease('browser-human-persistent'), 'user-stop', new AbortController().signal)
    expect(order).toEqual(['debugger', 'transport', 'surface:mount-4', 'release:mount-4'])
    expect(stop).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it('retains the exact generation until failed cleanup retries and every owner reaches release', async () => {
    const current = semantic()
    current.stop.mockRejectedValueOnce(new Error('debugger detach failed'))
    const disposeTransport = vi.fn(async () => {})
    const stop = vi.fn(async () => {})
    const release = vi.fn(async () => {})
    const surfaceManager = {
      ...idleFailedMountCleanup,
      acquire: async () => mount('human-persistent'),
      stop,
      release,
    }
    const adapter = new BrowserDesktopControlAdapter({
      surfaceManager,
      activate: async () => ({ semantic: current, disposeTransport }),
    })
    await adapter.acquireFacts(acquire(), new AbortController().signal)
    const snapshot = lease('browser-human-persistent')

    await expect(adapter.stopLease(snapshot, 'user-stop', new AbortController().signal))
      .rejects.toThrow('browser control cleanup failed')
    expect(current.stop).toHaveBeenCalledOnce()
    expect(disposeTransport).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
    expect(release).not.toHaveBeenCalled()
    await expect(adapter.acquireFacts(acquire(), new AbortController().signal))
      .rejects.toMatchObject({ code: 'BUSY' })

    await adapter.stopLease(snapshot, 'user-stop', new AbortController().signal)
    expect(current.stop).toHaveBeenCalledTimes(2)
    expect(disposeTransport).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it('fails closed for a foreign session without revealing or remounting the owner', async () => {
    const acquireSurface = vi.fn(async () => mount())
    const adapter = new BrowserDesktopControlAdapter({
      surfaceManager: {
        ...idleFailedMountCleanup,
        acquire: acquireSurface,
        stop: vi.fn(async () => {}),
        release: vi.fn(async () => {}),
      },
      activate: async () => ({ semantic: semantic(), disposeTransport: async () => {} }),
    })
    await adapter.acquireFacts(acquire(), new AbortController().signal)
    const foreign = { ...acquire(), sessionId: 'foreign-session' } as ControlLeaseAcquireRequest

    await expect(adapter.acquireFacts(foreign, new AbortController().signal)).rejects.toMatchObject({ code: 'BUSY' })
    expect(acquireSurface).toHaveBeenCalledOnce()
  })

  it('routes Stop through the exact failed stale-Give mount cleanup before admitting another owner', async () => {
    let disposeAttempts = 0
    const releaseTransfer = vi.fn(async () => {})
    const stalePersistent: BrowserSurfaceResource = {
      surfaceId: 'human-surface',
      partition: WORKBENCH_BROWSER_PARTITION,
      kind: 'human-persistent',
      installSecurityHandlers: () => ({ dispose: () => {
        disposeAttempts += 1
        if (disposeAttempts === 1) throw new Error('guard cleanup failed')
      } }),
      mount: async () => { throw new AgentBrowserError('STALE_REF', 'human view changed') },
      commitTransfer: async () => {},
      hide: async () => {},
      detachDebugger: async () => {},
      teardownView: async () => {},
      clearStorage: async () => {},
      releaseTransfer,
    }
    const adapterOwner: { current?: BrowserDesktopControlAdapter } = {}
    const authority = new BrowserTakeoverAuthority({
      source: {
        captureVisiblePersistentIntent: () => ({ instanceId: 'human-surface', generation: 1 }),
        consumeVisiblePersistentIntent: async () => stalePersistent,
      },
      stopActiveSession: async (sessionId) => {
        const current = adapterOwner.current
        if (current === undefined) throw new Error('browser adapter is unavailable')
        await current.retryPendingCleanup(sessionId, new AbortController().signal)
      },
    })
    const manager = new BrowserSurfaceManager({
      coordinator: authority,
      createEphemeral: async (request) => {
        authority.claimEphemeralOwner(request.sessionId)
        return {
          ...stalePersistent,
          surfaceId: 'replacement-surface',
          partition: request.partition,
          kind: 'ephemeral',
          installSecurityHandlers: () => ({ dispose() {} }),
          mount: async () => {},
        }
      },
      createNonce: () => 'replacement',
      createMountToken: generation => `mount-${String(generation)}`,
    })
    const adapter = new BrowserDesktopControlAdapter({
      surfaceManager: manager,
      activate: async () => ({ semantic: semantic(), disposeTransport: async () => {} }),
    })
    adapterOwner.current = adapter

    await authority.give()
    await expect(adapter.acquireFacts(acquire(), new AbortController().signal))
      .rejects.toMatchObject({ code: 'INTERNAL' })
    await expect(authority.stop()).resolves.toEqual({ phase: 'human', signedInWarning: true })
    expect(disposeAttempts).toBe(2)
    expect(releaseTransfer).toHaveBeenCalledOnce()

    const next = { ...acquire(), sessionId: 'next-official-session' } as ControlLeaseAcquireRequest
    await expect(adapter.acquireFacts(next, new AbortController().signal)).resolves.toMatchObject({
      surfaceKind: 'browser-ephemeral',
    })
  })
})
