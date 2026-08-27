import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  BrowserRef,
  ComputerRef,
  ControlLeaseId,
  RequestId,
  SessionId,
  type ComputerClickRequest as ProtocolComputerClickRequest,
  type ComputerListRequest,
  type ComputerListResult,
  type ComputerSnapshotRequest,
  type ComputerSnapshotResult,
  type ComputerStatusResult,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import ComputerControl, {
  ComputerControlError,
  MAX_COMPUTER_ACTIONS_PER_TURN,
  assertComputerActionCount,
  assertComputerReferenceCurrent,
  bindComputerReference,
  classifyControlPolicy,
  freezeComputerList,
  freezeComputerSnapshot,
  type ComputerActionRequest,
  type ComputerActionResult,
  type ComputerClickRequest,
  type ComputerControlStatus,
  type ComputerReferenceBinding,
  type ComputerSnapshot,
  type ControlTargetSensitivity,
} from '../src/index.ts'

const SESSION = SessionId('computer-session')
const OTHER_SESSION = SessionId('other-session')
const REQUEST = RequestId('00000000-0000-4000-8000-000000000011')
const LEASE = ControlLeaseId('00000000-0000-4000-8000-000000000012')
const REF = ComputerRef('computer:00000000000000000000000000000013')

function snapshot(): ComputerSnapshotResult {
  return {
    appId: 'com.example.editor',
    windowId: 'window-1',
    snapshotRevision: 7,
    semanticText: 'button Save',
    refs: [{ ref: REF, role: 'button', name: 'Save' }],
  }
}

function clickRequest(): ProtocolComputerClickRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'computer.click',
    requestId: REQUEST,
    sessionId: SESSION,
    deadlineUnixMs: Date.now() + 1_000,
    leaseId: LEASE,
    leaseRevision: 1,
    appId: 'com.example.editor',
    windowId: 'window-1',
    snapshotRevision: 7,
    ref: REF,
    button: 'left',
  }
}

class StubComputerControl extends ComputerControl {
  stopped: readonly SessionId[] = []

  async status(): Promise<ComputerStatusResult> {
    return { viewing: 'granted', assistive: 'granted', supported: true }
  }

  async list(_request: ComputerListRequest, signal: AbortSignal): Promise<ComputerListResult> {
    signal.throwIfAborted()
    return freezeComputerList({ apps: [{ appId: 'com.example.editor', name: 'Editor', windows: [{ windowId: 'window-1', title: 'Note' }] }] })
  }

  async snapshot(_request: ComputerSnapshotRequest, signal: AbortSignal): Promise<ComputerSnapshotResult> {
    signal.throwIfAborted()
    return freezeComputerSnapshot(snapshot())
  }

  async act(request: ComputerActionRequest, signal: AbortSignal): Promise<ComputerActionResult> {
    signal.throwIfAborted()
    return request.requestKind === 'computer.wait'
      ? { waited: true, snapshotRevision: request.snapshotRevision }
      : { acted: true, snapshotRevision: request.snapshotRevision + 1 }
  }

  async stop(sessionId: SessionId): Promise<void> {
    this.stopped = Object.freeze([...this.stopped, sessionId])
  }
}

describe('ComputerControl service seam', () => {
  it('registers one stable ctx.computerControl provider and exposes stop', async () => {
    const ctx = new Context()
    await ctx.plugin(StubComputerControl)

    const provider = ctx.computerControl
    await expect(provider.status()).resolves.toEqual({ viewing: 'granted', assistive: 'granted', supported: true })
    await provider.stop(SESSION)
    expect((ctx.computerControl as StubComputerControl).stopped).toEqual([SESSION])
  })

  it('rejects a duplicate computer provider', async () => {
    const ctx = new Context()
    await ctx.plugin(StubComputerControl)
    class SecondComputerControl extends StubComputerControl {}
    await expect(ctx.plugin(SecondComputerControl)).rejects.toThrow(/service "computerControl" has been registered/)
  })

  it('re-exports protocol request types instead of declaring a second wire DTO', () => {
    expectTypeOf<ComputerClickRequest>().toEqualTypeOf<ProtocolComputerClickRequest>()
    expectTypeOf<ComputerControlStatus>().toEqualTypeOf<ComputerStatusResult>()
    expectTypeOf<ComputerSnapshot>().toEqualTypeOf<ComputerSnapshotResult>()
  })
})

describe('computer reference ownership and bounds', () => {
  function binding(): ComputerReferenceBinding {
    return bindComputerReference({
      ref: REF,
      sessionId: SESSION,
      appId: 'com.example.editor',
      processId: 4242,
      processIdentity: 'launch-identity-1',
      windowId: 'window-1',
      snapshotRevision: 7,
      displayScale: 2,
    })
  }

  it('freezes a ref binding to app, process, window, revision, and display scale', () => {
    const value = binding()
    expect(Object.isFrozen(value)).toBe(true)
    expect(() => {
      ;(value as { displayScale: number }).displayScale = 1
    }).toThrow()
    expect(() => assertComputerReferenceCurrent(value, {
      sessionId: SESSION,
      appId: 'com.example.editor',
      processId: 4242,
      processIdentity: 'launch-identity-1',
      windowId: 'window-1',
      snapshotRevision: 7,
      displayScale: 2,
    })).not.toThrow()
  })

  it('bounds process identity and display scale at the service owner', () => {
    const base = {
      ref: REF,
      sessionId: SESSION,
      appId: 'com.example.editor',
      processId: 4242,
      processIdentity: 'launch-identity-1',
      windowId: 'window-1',
      snapshotRevision: 7,
      displayScale: 2,
    } as const
    expect(() => bindComputerReference({ ...base, processId: 0 })).toThrow(TypeError)
    expect(() => bindComputerReference({ ...base, processId: 0x1_0000_0000 })).toThrow(TypeError)
    expect(() => bindComputerReference({ ...base, displayScale: 0.24 })).toThrow(TypeError)
    expect(() => bindComputerReference({ ...base, displayScale: 8.01 })).toThrow(TypeError)
    expect(() => bindComputerReference({ ...base, processIdentity: 'x'.repeat(65) }))
      .toThrowError(expect.objectContaining<Partial<ComputerControlError>>({ code: 'QUOTA_EXCEEDED' }))
  })

  it('rejects a foreign session before revealing native target freshness', () => {
    expect(() => assertComputerReferenceCurrent(binding(), {
      sessionId: OTHER_SESSION,
      appId: 'com.example.editor',
      processId: 4242,
      processIdentity: 'launch-identity-1',
      windowId: 'window-1',
      snapshotRevision: 7,
      displayScale: 2,
    })).toThrowError(expect.objectContaining<Partial<ComputerControlError>>({ code: 'UNAUTHORIZED' }))
  })

  it.each([
    { processId: 4343 },
    { processIdentity: 'launch-identity-2' },
    { windowId: 'window-2' },
    { snapshotRevision: 8 },
    { displayScale: 1 },
  ])('rejects stale native reference scope %#', (change) => {
    expect(() => assertComputerReferenceCurrent(binding(), {
      sessionId: SESSION,
      appId: 'com.example.editor',
      processId: 4242,
      processIdentity: 'launch-identity-1',
      windowId: 'window-1',
      snapshotRevision: 7,
      displayScale: 2,
      ...change,
    })).toThrowError(expect.objectContaining<Partial<ComputerControlError>>({ code: 'STALE_REF' }))
  })

  it('enforces action and collection bounds and freezes returned collections', () => {
    expect(assertComputerActionCount(MAX_COMPUTER_ACTIONS_PER_TURN)).toBe(MAX_COMPUTER_ACTIONS_PER_TURN)
    expect(() => assertComputerActionCount(MAX_COMPUTER_ACTIONS_PER_TURN + 1))
      .toThrowError(expect.objectContaining<Partial<ComputerControlError>>({ code: 'QUOTA_EXCEEDED' }))

    const source: ComputerListResult = { apps: [{ appId: 'app', name: 'App', windows: [{ windowId: 'window', title: 'Window' }] }] }
    const frozen = freezeComputerList(source)
    expect(frozen).not.toBe(source)
    expect(Object.isFrozen(frozen.apps)).toBe(true)
    expect(Object.isFrozen(frozen.apps[0]?.windows)).toBe(true)
    expect(() => {
      ;(frozen.apps as unknown[]).push({})
    }).toThrow()

    expect(() => freezeComputerList({ apps: Array.from({ length: 129 }, (_, index) => ({ appId: `app-${index}`, name: 'App', windows: [] })) }))
      .toThrowError(expect.objectContaining<Partial<ComputerControlError>>({ code: 'QUOTA_EXCEEDED' }))
    expect(() => freezeComputerList({ apps: [{ appId: 'app', name: 'App', windows: Array.from({ length: 257 }, (_, index) => ({ windowId: `${index}`, title: '' })) }] }))
      .toThrowError(expect.objectContaining<Partial<ComputerControlError>>({ code: 'QUOTA_EXCEEDED' }))
  })

  it('returns a detached deeply frozen bounded snapshot', () => {
    const source = snapshot()
    const frozen = freezeComputerSnapshot(source)
    expect(frozen).not.toBe(source)
    expect(frozen.refs).not.toBe(source.refs)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.refs)).toBe(true)
    expect(Object.isFrozen(frozen.refs[0])).toBe(true)
  })
})

describe('closed control policy', () => {
  const denied: readonly ControlTargetSensitivity[] = [
    'secure-text', 'password', 'one-time-code', 'payment', 'file', 'biometric',
    'password-manager', 'keychain', 'os-privacy', 'os-security', 'installation',
    'removal', 'destructive-deletion', 'download-execute', 'unknown',
  ]

  it.each(denied)('denies %s targets regardless of surface and effect', (sensitivity) => {
    expect(classifyControlPolicy({
      request: clickRequest(),
      surface: 'native-application',
      sensitivity,
      effect: 'external-side-effect',
    })).toBe('DENY')
  })

  it('allows ordinary read-only work and ordinary ephemeral browser interaction', () => {
    expect(classifyControlPolicy({
      request: {
        protocolVersion: 1,
        messageKind: 'request',
        requestKind: 'computer.status',
        requestId: REQUEST,
        sessionId: SESSION,
        deadlineUnixMs: Date.now() + 1_000,
      },
      surface: 'native-application',
      sensitivity: 'not-applicable',
      effect: 'read-only',
    })).toBe('ALLOW')

    expect(classifyControlPolicy({
      request: {
        protocolVersion: 1,
        messageKind: 'request',
        requestKind: 'browser.click',
        requestId: REQUEST,
        sessionId: SESSION,
        deadlineUnixMs: Date.now() + 1_000,
        leaseId: LEASE,
        leaseRevision: 1,
        ref: BrowserRef('browser:00000000000000000000000000000014'),
      },
      surface: 'browser-ephemeral',
      sensitivity: 'ordinary',
      effect: 'local-interaction',
    })).toBe('ALLOW')
  })

  it('keeps Stop approval-free even when no target classification exists', () => {
    expect(classifyControlPolicy({
      request: {
        protocolVersion: 1,
        messageKind: 'request',
        requestKind: 'computer.stop',
        requestId: REQUEST,
        sessionId: SESSION,
        deadlineUnixMs: Date.now() + 1_000,
      },
      surface: 'native-application',
      sensitivity: 'not-applicable',
      effect: 'not-applicable',
    })).toBe('ALLOW')
    expect(classifyControlPolicy({
      request: {
        protocolVersion: 1,
        messageKind: 'request',
        requestKind: 'browser.stop',
        requestId: REQUEST,
        sessionId: SESSION,
        deadlineUnixMs: Date.now() + 1_000,
      },
      surface: 'browser-ephemeral',
      sensitivity: 'not-applicable',
      effect: 'not-applicable',
    })).toBe('ALLOW')
    expect(classifyControlPolicy({
      request: {
        protocolVersion: 1,
        messageKind: 'request',
        requestKind: 'computer.stop',
        requestId: REQUEST,
        sessionId: SESSION,
        deadlineUnixMs: Date.now() + 1_000,
      },
      surface: 'native-application',
      sensitivity: 'unknown',
      effect: 'unknown',
    })).toBe('ALLOW')
  })

  it('rejects fabricated target labels on targetless status requests', () => {
    expect(classifyControlPolicy({
      request: {
        protocolVersion: 1,
        messageKind: 'request',
        requestKind: 'desktop.status',
        requestId: REQUEST,
        sessionId: SESSION,
        deadlineUnixMs: Date.now() + 1_000,
      },
      surface: 'browser-ephemeral',
      sensitivity: 'ordinary',
      effect: 'read-only',
    })).toBe('DENY')
  })

  it('still denies Stop when routed to the wrong surface family', () => {
    expect(classifyControlPolicy({
      request: {
        protocolVersion: 1,
        messageKind: 'request',
        requestKind: 'browser.stop',
        requestId: REQUEST,
        sessionId: SESSION,
        deadlineUnixMs: Date.now() + 1_000,
      },
      surface: 'native-application',
      sensitivity: 'not-applicable',
      effect: 'not-applicable',
    })).toBe('DENY')
  })

  it('requires approval for external side effects and persistent human browser mutation', () => {
    expect(classifyControlPolicy({
      request: clickRequest(),
      surface: 'native-application',
      sensitivity: 'ordinary',
      effect: 'external-side-effect',
    })).toBe('APPROVAL_REQUIRED')

    expect(classifyControlPolicy({
      request: {
        protocolVersion: 1,
        messageKind: 'request',
        requestKind: 'browser.click',
        requestId: REQUEST,
        sessionId: SESSION,
        deadlineUnixMs: Date.now() + 1_000,
        leaseId: LEASE,
        leaseRevision: 1,
        ref: BrowserRef('browser:00000000000000000000000000000015'),
      },
      surface: 'browser-human-persistent',
      sensitivity: 'ordinary',
      effect: 'local-interaction',
    })).toBe('APPROVAL_REQUIRED')
  })

  it('fails closed for uncertain effect or contradictory read-only classification', () => {
    expect(classifyControlPolicy({
      request: clickRequest(),
      surface: 'native-application',
      sensitivity: 'ordinary',
      effect: 'unknown',
    })).toBe('DENY')
    expect(classifyControlPolicy({
      request: clickRequest(),
      surface: 'native-application',
      sensitivity: 'ordinary',
      effect: 'read-only',
    })).toBe('DENY')
  })
})
