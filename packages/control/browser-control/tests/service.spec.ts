import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  BrowserRef,
  ControlLeaseId,
  RequestId,
  SessionId,
  type BrowserClickRequest as ProtocolBrowserClickRequest,
  type BrowserSnapshotRequest,
  type BrowserSnapshotResult,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import BrowserControl, {
  BrowserControlError,
  MAX_BROWSER_ACTIONS_PER_TURN,
  assertBrowserActionCount,
  assertBrowserReferenceCurrent,
  bindBrowserReference,
  freezeBrowserSnapshot,
  type BrowserActionRequest,
  type BrowserActionResult,
  type BrowserClickRequest,
  type BrowserSnapshot,
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

  async snapshot(_request: BrowserSnapshotRequest, signal: AbortSignal): Promise<BrowserSnapshotResult> {
    signal.throwIfAborted()
    return freezeBrowserSnapshot(browserSnapshot())
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
    expect(result.refs[0]?.ref).toBe(REF)

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
    expect(() => assertBrowserReferenceCurrent(value, {
      sessionId: SESSION,
      surfaceId: 'surface-1',
      surfaceGeneration: 2,
      snapshotRevision: 4,
    })).not.toThrow()
  })

  it('rejects a foreign session before revealing target freshness', () => {
    expect(() => assertBrowserReferenceCurrent(binding(), {
      sessionId: OTHER_SESSION,
      surfaceId: 'surface-1',
      surfaceGeneration: 2,
      snapshotRevision: 4,
    })).toThrowError(expect.objectContaining<Partial<BrowserControlError>>({ code: 'UNAUTHORIZED' }))
  })

  it.each([
    { surfaceId: 'surface-2', surfaceGeneration: 2, snapshotRevision: 4 },
    { surfaceId: 'surface-1', surfaceGeneration: 3, snapshotRevision: 4 },
    { surfaceId: 'surface-1', surfaceGeneration: 2, snapshotRevision: 5 },
  ])('rejects stale browser reference scope %#', (scope) => {
    expect(() => assertBrowserReferenceCurrent(binding(), { sessionId: SESSION, ...scope }))
      .toThrowError(expect.objectContaining<Partial<BrowserControlError>>({ code: 'STALE_REF' }))
  })

  it('enforces the per-turn action bound', () => {
    expect(assertBrowserActionCount(MAX_BROWSER_ACTIONS_PER_TURN)).toBe(MAX_BROWSER_ACTIONS_PER_TURN)
    expect(() => assertBrowserActionCount(MAX_BROWSER_ACTIONS_PER_TURN + 1))
      .toThrowError(expect.objectContaining<Partial<BrowserControlError>>({ code: 'QUOTA_EXCEEDED' }))
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

  it('rejects snapshots beyond protocol collection and UTF-8 limits', () => {
    expect(() => freezeBrowserSnapshot({
      ...browserSnapshot(),
      refs: Array.from({ length: 301 }, () => ({ ref: REF, role: 'button', name: 'x' })),
    })).toThrowError(expect.objectContaining<Partial<BrowserControlError>>({ code: 'QUOTA_EXCEEDED' }))
    expect(() => freezeBrowserSnapshot({
      ...browserSnapshot(),
      semanticText: '😀'.repeat(12_289),
    })).toThrowError(expect.objectContaining<Partial<BrowserControlError>>({ code: 'QUOTA_EXCEEDED' }))
  })
})
