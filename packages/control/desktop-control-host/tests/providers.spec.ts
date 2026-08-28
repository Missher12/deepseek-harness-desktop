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
import type { BrowserSnapshotEnvelope } from '@deepseek-ai/dsh-browser-control'
import type { ComputerSnapshotEnvelope } from '@deepseek-ai/dsh-computer-control'
import {
  DesktopBrowserControl,
  DesktopComputerControl,
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
