import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  ControlLeaseId,
  DesktopControlFrameDecoder,
  RequestId,
  SessionId,
  type BrowserSnapshotRequest,
  type ComputerSnapshotRequest,
  type ControlLeaseAcquireRequest,
  type DecodedDesktopControlEnvelope,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import { BrowserControlError, type BrowserSnapshotEnvelope } from '@deepseek-ai/dsh-browser-control'
import type { ComputerSnapshotEnvelope } from '@deepseek-ai/dsh-computer-control'
import {
  DesktopBrowserControl,
  DesktopComputerControl,
  DesktopControlIpcError,
  installDesktopControlHost,
  type DesktopControlRequester,
} from '../src/index.ts'

const SESSION = SessionId('provider-session')
const REQUEST = RequestId('00000000-0000-4000-8000-000000000031')
const LEASE = ControlLeaseId('00000000-0000-4000-8000-000000000032')

function snapshotEnvelope(): DecodedDesktopControlEnvelope {
  const decoder = new DesktopControlFrameDecoder()
  const json = readFileSync(new URL('../../desktop-control-protocol/fixtures/browser-snapshot-json.bin', import.meta.url))
  const png = readFileSync(new URL('../../desktop-control-protocol/fixtures/browser-snapshot-png.bin', import.meta.url))
  expect(decoder.pushFrame(json)).toEqual([])
  return decoder.pushFrame(png)[0]!
}

class StubRequester implements DesktopControlRequester {
  readonly request = vi.fn(async (): Promise<DecodedDesktopControlEnvelope> => snapshotEnvelope())
  readonly revokeSession = vi.fn(async () => undefined)
}

function browserRequest(): BrowserSnapshotRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'browser.snapshot',
    requestId: REQUEST,
    sessionId: SESSION,
    deadlineUnixMs: Date.now() + 1_000,
    leaseId: LEASE,
    leaseRevision: 1,
    includeImage: true,
  }
}

describe('Desktop control Host providers', () => {
  it('maps a verified browser codec envelope without dropping or aliasing its PNG', async () => {
    const ctx = new Context()
    const requester = new StubRequester()
    const provider = new DesktopBrowserControl(ctx, requester)

    const result = await provider.snapshot(browserRequest(), new AbortController().signal)

    expect(Object.hasOwn(result.result, 'requestKind')).toBe(false)
    expect(result.result.image).toBeDefined()
    expect(result.png?.byteLength).toBeGreaterThan(0)
    expect(Object.isFrozen(result)).toBe(true)
    expectTypeOf(result).toEqualTypeOf<BrowserSnapshotEnvelope>()
  })

  it('closes exact browser IPC errors without exposing their privileged detail', async () => {
    const raw = 'SENSITIVE ELECTRON TARGET DETAIL'
    const ctx = new Context()
    const requester: DesktopControlRequester = {
      request: vi.fn(async () => {
        throw new DesktopControlIpcError('POLICY_DENIED', raw)
      }),
      revokeSession: vi.fn(async () => undefined),
    }
    const provider = new DesktopBrowserControl(ctx, requester)

    let thrown: unknown
    try {
      await provider.snapshot(browserRequest(), new AbortController().signal)
    } catch (error: unknown) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(BrowserControlError)
    expect(thrown).toMatchObject({
      code: 'POLICY_DENIED',
      message: 'Desktop browser control failed (POLICY_DENIED).',
    })
    expect((thrown as Error).message).not.toContain(raw)
  })

  it.each(['LEASE_EXPIRED', 'LEASE_REVOKED'] as const)(
    'does not evict a newer cached lease for a nonmatching %s request failure',
    async (code) => {
      const ctx = new Context()
      const requester: DesktopControlRequester = {
        request: vi.fn(async () => {
          throw new DesktopControlIpcError(code, 'old request detail')
        }),
        revokeSession: vi.fn(async () => undefined),
      }
      const provider = new DesktopBrowserControl(ctx, requester)
      const current = provider.leaseCache.remember(SESSION, {
        leaseId: ControlLeaseId('00000000-0000-4000-8000-000000000099'),
        leaseRevision: 2,
        surfaceKind: 'browser-ephemeral',
        targets: [],
        capabilities: ['observe'],
        idleExpiresAfterMs: 300_000,
        hardExpiresAfterMs: 1_200_000,
      })

      await expect(provider.snapshot(browserRequest(), new AbortController().signal))
        .rejects.toMatchObject({ name: 'BrowserControlError', code })
      expect(provider.leaseCache.peek(SESSION)).toBe(current)
    },
  )

  it('preserves the model-turn abort reason and unrelated programming failures', async () => {
    const ctx = new Context()
    const abortReason = new Error('official turn abort')
    const controller = new AbortController()
    controller.abort(abortReason)
    const cancelledRequester: DesktopControlRequester = {
      request: vi.fn(async () => {
        throw new DesktopControlIpcError('CANCELLED', 'raw IPC cancellation')
      }),
      revokeSession: vi.fn(async () => undefined),
    }
    const cancelledProvider = new DesktopBrowserControl(ctx, cancelledRequester)
    await expect(cancelledProvider.snapshot(browserRequest(), controller.signal)).rejects.toBe(abortReason)

    const programmingError = new TypeError('provider invariant failed')
    const failingRequester: DesktopControlRequester = {
      request: vi.fn(async () => {
        throw programmingError
      }),
      revokeSession: vi.fn(async () => undefined),
    }
    const failingProvider = new DesktopBrowserControl(new Context(), failingRequester)
    await expect(failingProvider.snapshot(browserRequest(), new AbortController().signal))
      .rejects.toBe(programmingError)
  })

  it('maps native status/list/snapshot/action responses through their closed result types', async () => {
    const ctx = new Context()
    const responses: DecodedDesktopControlEnvelope[] = [
      {
        message: {
          protocolVersion: 1,
          messageKind: 'response',
          responseKind: 'ok',
          requestId: REQUEST,
          requestKind: 'computer.status',
          result: { viewing: 'granted', assistive: 'denied', supported: true },
        },
      },
      {
        message: {
          protocolVersion: 1,
          messageKind: 'response',
          responseKind: 'ok',
          requestId: REQUEST,
          requestKind: 'computer.snapshot',
          result: {
            appId: 'com.example.editor',
            windowId: 'window-1',
            snapshotRevision: 2,
            semanticText: '',
            refs: [],
          },
        },
      },
    ]
    const requester: DesktopControlRequester = {
      request: vi.fn(async () => responses.shift()!),
      revokeSession: vi.fn(async () => undefined),
    }
    Object.defineProperty(ctx, 'agent', {
      configurable: true,
      value: { session: { id: SESSION } },
    })
    const provider = new DesktopComputerControl(ctx, requester)

    await expect(provider.status()).resolves.toEqual({ viewing: 'granted', assistive: 'denied', supported: true })
    const snapshotRequest: ComputerSnapshotRequest = {
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'computer.snapshot',
      requestId: REQUEST,
      sessionId: SESSION,
      deadlineUnixMs: Date.now() + 1_000,
      leaseId: LEASE,
      leaseRevision: 1,
      appId: 'com.example.editor',
      windowId: 'window-1',
      snapshotRevision: 1,
      includeImage: false,
    }
    const snapshot = await provider.snapshot(snapshotRequest, new AbortController().signal)
    expect(snapshot.result.snapshotRevision).toBe(2)
    expectTypeOf(snapshot).toEqualTypeOf<ComputerSnapshotEnvelope>()
  })

  it('shares exactly one process client and lease cache across both providers', () => {
    const ctx = new Context()
    const installed = installDesktopControlHost(ctx, undefined)
    expect(installed).toBeUndefined()
    expect('browserControl' in ctx).toBe(false)
    expect('computerControl' in ctx).toBe(false)

    const requester = new StubRequester()
    const mounted = installDesktopControlHost(ctx, { requester })
    expect(mounted?.browser.requester).toBe(requester)
    expect(mounted?.computer.requester).toBe(requester)
    expect(mounted?.browser.leaseCache).toBe(mounted?.computer.leaseCache)
  })

  it('caches only Electron-authored lease descriptors and reuses the protocol DTO types', async () => {
    const ctx = new Context()
    const acquire: ControlLeaseAcquireRequest = {
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'control.lease.acquire',
      requestId: REQUEST,
      sessionId: SESSION,
      deadlineUnixMs: Date.now() + 1_000,
      surfaceKind: 'browser-ephemeral',
      targets: [],
      capabilities: ['observe'],
    }
    const requester: DesktopControlRequester = {
      request: vi.fn<DesktopControlRequester['request']>(async () => ({
        message: {
          protocolVersion: 1,
          messageKind: 'response',
          responseKind: 'ok',
          requestId: REQUEST,
          requestKind: 'control.lease.acquire',
          result: {
            leaseId: LEASE,
            leaseRevision: 1,
            surfaceKind: 'browser-ephemeral',
            targets: [],
            capabilities: ['observe'],
            idleExpiresAfterMs: 300_000,
            hardExpiresAfterMs: 1_200_000,
          },
        } as const,
      })),
      revokeSession: vi.fn(async () => undefined),
    }
    const mounted = installDesktopControlHost(ctx, { requester })!

    const lease = await mounted.browser.acquireLease(acquire, new AbortController().signal)

    expect(mounted.leaseCache.peek(SESSION)?.leaseId).toBe(lease.leaseId)
    expectTypeOf<Parameters<DesktopBrowserControl['acquireLease']>[0]>()
      .toEqualTypeOf<ControlLeaseAcquireRequest>()
  })
})
