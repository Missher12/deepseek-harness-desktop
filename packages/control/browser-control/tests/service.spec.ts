import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  BrowserRef,
  ControlLeaseId,
  ImmutablePng,
  PngTransferId,
  RequestId,
  SessionId,
  type BrowserClickRequest as ProtocolBrowserClickRequest,
  type BrowserSnapshotRequest,
  type BrowserSnapshotResult,
  type ControlLeaseAcquireRequest,
  type ControlLeaseAcquireResult,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import BrowserControl, {
  BrowserControlError,
  MAX_BROWSER_ACTIONS_PER_TURN,
  assertBrowserActionCount,
  assertBrowserReferenceCurrent,
  bindBrowserReference,
  freezeBrowserSnapshot,
  freezeBrowserSnapshotEnvelope,
  type BrowserActionRequest,
  type BrowserActionResult,
  type BrowserClickRequest,
  type BrowserSnapshot,
  type BrowserSnapshotEnvelope,
  type BrowserReferenceBinding,
} from '../src/index.ts'

const SESSION = SessionId('browser-session')
const OTHER_SESSION = SessionId('other-session')
const REQUEST = RequestId('00000000-0000-4000-8000-000000000001')
const LEASE = ControlLeaseId('00000000-0000-4000-8000-000000000002')
const REF = BrowserRef('browser:00000000000000000000000000000003')

function browserSnapshot(): BrowserSnapshotResult {
  return {
    surfaceId: 'surface-1',
    url: 'https://example.test/',
    title: 'Example',
    snapshotRevision: 4,
    semanticText: 'button Example',
    refs: [{ ref: REF, role: 'button', name: 'Example' }],
  }
}

class StubBrowserControl extends BrowserControl {
  revoked: readonly SessionId[] = []

  async acquireLease(
    request: ControlLeaseAcquireRequest,
    signal: AbortSignal,
  ): Promise<ControlLeaseAcquireResult> {
    signal.throwIfAborted()
    return {
      leaseId: LEASE,
      leaseRevision: 1,
      surfaceKind: request.surfaceKind,
      targets: request.targets,
      capabilities: request.capabilities,
      idleExpiresAfterMs: 300_000,
      hardExpiresAfterMs: 1_200_000,
    }
  }

  async snapshot(_request: BrowserSnapshotRequest, signal: AbortSignal): Promise<BrowserSnapshotEnvelope> {
    signal.throwIfAborted()
    return freezeBrowserSnapshotEnvelope({ result: browserSnapshot() })
  }

  async act(request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult> {
    signal.throwIfAborted()
    return request.requestKind === 'browser.wait'
      ? { waited: true, snapshotRevision: 5 }
      : request.requestKind === 'browser.navigate'
        || request.requestKind === 'browser.back'
        || request.requestKind === 'browser.forward'
        || request.requestKind === 'browser.reload'
        ? { url: 'https://example.test/next', snapshotRevision: 5 }
        : { acted: true, snapshotRevision: 5 }
  }

  async revokeSession(sessionId: SessionId): Promise<void> {
    this.revoked = Object.freeze([...this.revoked, sessionId])
  }
}

describe('BrowserControl service seam', () => {
  it('registers one stable ctx.browserControl provider and exposes the protocol API', async () => {
    const ctx = new Context()
    await ctx.plugin(StubBrowserControl)

    const provider = ctx.browserControl
    const acquired = await provider.acquireLease({
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'control.lease.acquire',
      requestId: REQUEST,
      sessionId: SESSION,
      deadlineUnixMs: Date.now() + 1_000,
      surfaceKind: 'browser-ephemeral',
      targets: [],
      capabilities: ['observe', 'pointer'],
    }, new AbortController().signal)
    expect(acquired.surfaceKind).toBe('browser-ephemeral')
    const result = await provider.snapshot({
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'browser.snapshot',
      requestId: REQUEST,
      sessionId: SESSION,
      deadlineUnixMs: Date.now() + 1_000,
      leaseId: LEASE,
      leaseRevision: 1,
      includeImage: false,
    }, new AbortController().signal)
    expect(result.result.refs[0]?.ref).toBe(REF)

    await provider.revokeSession(SESSION)
    expect((ctx.browserControl as StubBrowserControl).revoked).toEqual([SESSION])
  })

  it('rejects a duplicate browser provider', async () => {
    const ctx = new Context()
    await ctx.plugin(StubBrowserControl)
    class SecondBrowserControl extends StubBrowserControl {}
    await expect(ctx.plugin(SecondBrowserControl)).rejects.toThrow(/service "browserControl" has been registered/)
  })

  it('re-exports protocol request types instead of declaring a second wire DTO', () => {
    expectTypeOf<BrowserClickRequest>().toEqualTypeOf<ProtocolBrowserClickRequest>()
    expectTypeOf<BrowserSnapshot>().toEqualTypeOf<BrowserSnapshotResult>()
    expectTypeOf<Awaited<ReturnType<BrowserControl['snapshot']>>>().toEqualTypeOf<BrowserSnapshotEnvelope>()
    expectTypeOf<Parameters<BrowserControl['acquireLease']>[0]>().toEqualTypeOf<ControlLeaseAcquireRequest>()
    expectTypeOf<Awaited<ReturnType<BrowserControl['acquireLease']>>>().toEqualTypeOf<ControlLeaseAcquireResult>()
  })

  it('keeps act on the exact ten-action browser roster', () => {
    type ExpectedBrowserActionKind =
      | 'browser.navigate' | 'browser.click' | 'browser.type' | 'browser.key'
      | 'browser.select' | 'browser.scroll' | 'browser.wait' | 'browser.back'
      | 'browser.forward' | 'browser.reload'
    type NonActionKind = Extract<
      BrowserActionRequest['requestKind'],
      'desktop.status' | 'browser.snapshot' | 'browser.stop'
    >

    expectTypeOf<BrowserActionRequest['requestKind']>().toEqualTypeOf<ExpectedBrowserActionKind>()
    expectTypeOf<NonActionKind>().toEqualTypeOf<never>()
  })
})

describe('browser reference ownership and bounds', () => {
  function binding(): BrowserReferenceBinding {
    return bindBrowserReference({
      ref: REF,
      sessionId: SESSION,
      surfaceId: 'surface-1',
      surfaceGeneration: 2,
      snapshotRevision: 4,
    })
  }

  it('freezes a ref binding to session, surface generation, and snapshot revision', () => {
    const value = binding()
    expect(Object.isFrozen(value)).toBe(true)
    expect(() => {
      ;(value as { surfaceGeneration: number }).surfaceGeneration = 99
    }).toThrow()
    expect(() => {
      assertBrowserReferenceCurrent(value, {
        sessionId: SESSION,
        surfaceId: 'surface-1',
        surfaceGeneration: 2,
        snapshotRevision: 4,
      })
    }).not.toThrow()
  })

  it('rejects boxed and object-coercible browser binding primitives', () => {
    const base = {
      ref: REF,
      sessionId: SESSION,
      surfaceId: 'surface-1',
      surfaceGeneration: 2,
      snapshotRevision: 4,
    } as const
    expect(() => bindBrowserReference({
      ...base,
      ref: { toString: () => String(REF) } as unknown as typeof REF,
    })).toThrow(TypeError)
    expect(() => bindBrowserReference({
      ...base,
      sessionId: new String(SESSION) as unknown as typeof SESSION,
    })).toThrow(TypeError)
    expect(() => bindBrowserReference({
      ...base,
      surfaceId: new String('surface-1') as unknown as string,
    })).toThrow(TypeError)
  })

  it('rejects a foreign session before revealing target freshness', () => {
    expect(() => {
      assertBrowserReferenceCurrent(binding(), {
        sessionId: OTHER_SESSION,
        surfaceId: 'surface-1',
        surfaceGeneration: 2,
        snapshotRevision: 4,
      })
    }).toThrow(expect.objectContaining<Partial<BrowserControlError>>({ code: 'UNAUTHORIZED' }))
  })

  it.each([
    { surfaceId: 'surface-2', surfaceGeneration: 2, snapshotRevision: 4 },
    { surfaceId: 'surface-1', surfaceGeneration: 3, snapshotRevision: 4 },
    { surfaceId: 'surface-1', surfaceGeneration: 2, snapshotRevision: 5 },
  ])('rejects stale browser reference scope %#', (scope) => {
    expect(() => {
      assertBrowserReferenceCurrent(binding(), { sessionId: SESSION, ...scope })
    }).toThrow(expect.objectContaining<Partial<BrowserControlError>>({ code: 'STALE_REF' }))
  })

  it('enforces the per-turn action bound', () => {
    expect(assertBrowserActionCount(MAX_BROWSER_ACTIONS_PER_TURN)).toBe(MAX_BROWSER_ACTIONS_PER_TURN)
    expect(() => assertBrowserActionCount(MAX_BROWSER_ACTIONS_PER_TURN + 1))
      .toThrow(expect.objectContaining<Partial<BrowserControlError>>({ code: 'QUOTA_EXCEEDED' }))
    expect(() => assertBrowserActionCount(0.5)).toThrow(TypeError)
  })

  it('returns a detached deeply frozen bounded snapshot', () => {
    const source = browserSnapshot()
    const frozen = freezeBrowserSnapshot(source)
    expect(frozen).not.toBe(source)
    expect(frozen.refs).not.toBe(source.refs)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.refs)).toBe(true)
    expect(Object.isFrozen(frozen.refs[0])).toBe(true)
    expect(() => {
      ;(frozen.refs as unknown as { ref: typeof REF }[]).push({ ref: REF })
    }).toThrow()
  })

  it('preserves correlated image bytes in a detached deeply frozen snapshot envelope', () => {
    const bytes = Uint8Array.of(1, 2, 3)
    const png = new ImmutablePng(bytes)
    const result = {
      ...browserSnapshot(),
      image: {
        transferId: PngTransferId('00000000-0000-4000-8000-000000000099'),
        byteLength: bytes.byteLength,
        sha256: 'a'.repeat(64),
        width: 1,
        height: 1,
      },
    }
    const envelope = freezeBrowserSnapshotEnvelope({
      result,
      png,
      secret: { value: 'must-not-cross' },
    } as BrowserSnapshotEnvelope)

    expect(Object.keys(envelope).sort()).toEqual(['png', 'result'])
    expect(envelope.result).not.toBe(result)
    expect(envelope.png).not.toBe(png)
    expect(Object.isFrozen(envelope)).toBe(true)
    expect(Object.isFrozen(envelope.result)).toBe(true)
    expect(Object.isFrozen(envelope.result.refs)).toBe(true)
    expect(Object.isFrozen(envelope.png)).toBe(true)
    const first = envelope.png!.read()
    const second = envelope.png!.read()
    first[0] = 99
    expect(second).toEqual(Uint8Array.of(1, 2, 3))
    expect(envelope.png!.read()).toEqual(Uint8Array.of(1, 2, 3))
    expect(envelope).not.toHaveProperty('secret')
    expect(envelope.png).not.toHaveProperty('bytes')
  })

  it('rejects missing, extra, or forged snapshot image owners', () => {
    const png = new ImmutablePng(Uint8Array.of(1))
    const resultWithImage = {
      ...browserSnapshot(),
      image: {
        transferId: PngTransferId('00000000-0000-4000-8000-000000000099'),
        byteLength: 1,
        sha256: 'a'.repeat(64),
        width: 1,
        height: 1,
      },
    }

    expect(() => freezeBrowserSnapshotEnvelope({ result: resultWithImage })).toThrow(/image.*PNG|PNG.*image/i)
    expect(() => freezeBrowserSnapshotEnvelope({ result: browserSnapshot(), png })).toThrow(/image.*PNG|PNG.*image/i)
    expect(() => freezeBrowserSnapshotEnvelope({
      result: resultWithImage,
      png: { read: () => Uint8Array.of(1) } as unknown as ImmutablePng,
    })).toThrow(TypeError)
    expect(() => freezeBrowserSnapshotEnvelope(Object.create({
      result: resultWithImage,
      png,
    }) as BrowserSnapshotEnvelope)).toThrow(TypeError)
  })

  it('canonicalizes and deeply freezes only the five PNG metadata fields', () => {
    const secret = { value: 'must-not-cross' }
    const image = {
      transferId: PngTransferId('00000000-0000-4000-8000-000000000099'),
      byteLength: 24,
      sha256: 'a'.repeat(64),
      width: 1,
      height: 1,
      secret,
    }
    const frozen = freezeBrowserSnapshot({ ...browserSnapshot(), image })
    expect(frozen.image).toEqual({
      transferId: image.transferId,
      byteLength: 24,
      sha256: 'a'.repeat(64),
      width: 1,
      height: 1,
    })
    expect(frozen.image).not.toBe(image)
    expect(Object.isFrozen(frozen.image)).toBe(true)
    expect(frozen.image).not.toHaveProperty('secret')
    secret.value = 'changed'
    expect(frozen.image).not.toHaveProperty('secret')
  })

  it('rejects pseudo-string snapshot and PNG metadata primitives', () => {
    expect(() => freezeBrowserSnapshot({
      ...browserSnapshot(),
      title: new String('Example') as unknown as string,
    })).toThrow(TypeError)
    expect(() => freezeBrowserSnapshot({
      ...browserSnapshot(),
      refs: [{
        ref: { toString: () => String(REF) } as unknown as typeof REF,
        role: 'button',
        name: 'Example',
      }],
    })).toThrow(TypeError)
    expect(() => freezeBrowserSnapshot({
      ...browserSnapshot(),
      image: {
        transferId: { toString: () => '00000000-0000-4000-8000-000000000099' } as unknown as ReturnType<typeof PngTransferId>,
        byteLength: 24,
        sha256: 'a'.repeat(64),
        width: 1,
        height: 1,
      },
    })).toThrow(TypeError)
  })

  it('rejects invalid PNG metadata ranges and hashes', () => {
    const image = {
      transferId: PngTransferId('00000000-0000-4000-8000-000000000099'),
      byteLength: 24,
      sha256: 'a'.repeat(64),
      width: 1,
      height: 1,
    } as const
    expect(() => freezeBrowserSnapshot({ ...browserSnapshot(), image: { ...image, byteLength: 0 } })).toThrow(TypeError)
    expect(() => freezeBrowserSnapshot({ ...browserSnapshot(), image: { ...image, sha256: 'A'.repeat(64) } })).toThrow(TypeError)
    expect(() => freezeBrowserSnapshot({ ...browserSnapshot(), image: { ...image, width: 100_001 } })).toThrow(TypeError)
  })

  it('rejects snapshots beyond protocol collection and UTF-8 limits', () => {
    expect(() => freezeBrowserSnapshot({
      ...browserSnapshot(),
      refs: Array.from({ length: 301 }, () => ({ ref: REF, role: 'button', name: 'x' })),
    })).toThrow(expect.objectContaining<Partial<BrowserControlError>>({ code: 'QUOTA_EXCEEDED' }))
    expect(() => freezeBrowserSnapshot({
      ...browserSnapshot(),
      semanticText: '😀'.repeat(12_289),
    })).toThrow(expect.objectContaining<Partial<BrowserControlError>>({ code: 'QUOTA_EXCEEDED' }))
  })
})
