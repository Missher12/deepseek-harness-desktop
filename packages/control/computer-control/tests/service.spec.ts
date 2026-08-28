import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  BrowserRef,
  ComputerRef,
  ControlLeaseId,
  ImmutablePng,
  PngTransferId,
  RequestId,
  SessionId,
  type ComputerClickRequest as ProtocolComputerClickRequest,
  type ComputerListRequest,
  type ComputerListResult,
  type ComputerSnapshotRequest,
  type ComputerSnapshotResult,
  type ComputerStatusResult,
  type ControlLeaseAcquireRequest,
  type ControlLeaseAcquireResult,
  type ControlLeaseSurfaceKind,
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
  freezeComputerSnapshotEnvelope,
  type ComputerActionRequest,
  type ComputerActionResult,
  type ComputerClickRequest,
  type ComputerControlStatus,
  type ComputerReferenceBinding,
  type ComputerSnapshot,
  type ComputerSnapshotEnvelope,
  type ControlPolicyInput,
  type ControlSurfaceClass,
  type ControlTargetSensitivity,
} from '../src/index.ts'

function computerSnapshotEnvelopeTypeContracts(
  result: Omit<ComputerSnapshotResult, 'image'>,
  png: ImmutablePng,
): void {
  const withoutImage: ComputerSnapshotEnvelope = { result }
  void withoutImage
  const image = {
    transferId: PngTransferId('00000000-0000-4000-8000-000000000199'),
    byteLength: 1,
    sha256: 'b'.repeat(64),
    width: 1,
    height: 1,
  }
  const withImage: ComputerSnapshotEnvelope = { result: { ...result, image }, png }
  void withImage

  // @ts-expect-error -- image metadata cannot cross the Service seam without its paired PNG owner.
  const metadataWithoutPng: ComputerSnapshotEnvelope = {
    result: { ...result, image },
  }
  void metadataWithoutPng

  // @ts-expect-error -- PNG bytes cannot cross the Service seam without matching protocol metadata.
  const pngWithoutMetadata: ComputerSnapshotEnvelope = { result, png }
  void pngWithoutMetadata
}
void computerSnapshotEnvelopeTypeContracts

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

function inheritedClickRequest(): unknown {
  const request = Object.create({ inherited: true }) as object
  return Object.assign(request, clickRequest())
}

class StubComputerControl extends ComputerControl {
  stopped: readonly SessionId[] = []

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

  async status(_sessionId: SessionId): Promise<ComputerStatusResult> {
    return { viewing: 'granted', assistive: 'granted', supported: true }
  }

  async list(_request: ComputerListRequest, signal: AbortSignal): Promise<ComputerListResult> {
    signal.throwIfAborted()
    return freezeComputerList({ apps: [{ appId: 'com.example.editor', name: 'Editor', windows: [{ windowId: 'window-1', title: 'Note' }] }] })
  }

  async snapshot(_request: ComputerSnapshotRequest, signal: AbortSignal): Promise<ComputerSnapshotEnvelope> {
    signal.throwIfAborted()
    return freezeComputerSnapshotEnvelope({ result: snapshot() })
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
    const acquired = await provider.acquireLease({
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'control.lease.acquire',
      requestId: REQUEST,
      sessionId: SESSION,
      deadlineUnixMs: Date.now() + 1_000,
      surfaceKind: 'native-application',
      targets: [{ appId: 'com.example.editor', windowIds: ['window-1'] }],
      capabilities: ['observe'],
    }, new AbortController().signal)
    expect(acquired.surfaceKind).toBe('native-application')
    await expect(provider.status(SESSION)).resolves.toEqual({ viewing: 'granted', assistive: 'granted', supported: true })
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
    expectTypeOf<Awaited<ReturnType<ComputerControl['snapshot']>>>().toEqualTypeOf<ComputerSnapshotEnvelope>()
    expectTypeOf<Parameters<ComputerControl['acquireLease']>[0]>().toEqualTypeOf<ControlLeaseAcquireRequest>()
    expectTypeOf<Awaited<ReturnType<ComputerControl['acquireLease']>>>().toEqualTypeOf<ControlLeaseAcquireResult>()
    expectTypeOf<ControlSurfaceClass>().toEqualTypeOf<ControlLeaseSurfaceKind>()
  })

  it('keeps act on the exact eight-action computer roster', () => {
    type ExpectedComputerActionKind =
      | 'computer.focus' | 'computer.click' | 'computer.double-click'
      | 'computer.drag' | 'computer.type' | 'computer.key'
      | 'computer.scroll' | 'computer.wait'
    type NonActionKind = Extract<
      ComputerActionRequest['requestKind'],
      'desktop.status' | 'computer.status' | 'computer.list' | 'computer.snapshot' | 'computer.stop'
    >

    expectTypeOf<ComputerActionRequest['requestKind']>().toEqualTypeOf<ExpectedComputerActionKind>()
    expectTypeOf<NonActionKind>().toEqualTypeOf<never>()
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
    expect(() => {
      assertComputerReferenceCurrent(value, {
        sessionId: SESSION,
        appId: 'com.example.editor',
        processId: 4242,
        processIdentity: 'launch-identity-1',
        windowId: 'window-1',
        snapshotRevision: 7,
        displayScale: 2,
      })
    }).not.toThrow()
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
      .toThrow(expect.objectContaining<Partial<ComputerControlError>>({ code: 'QUOTA_EXCEEDED' }))
  })

  it('rejects boxed and object-coercible computer binding primitives', () => {
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
    expect(() => bindComputerReference({
      ...base,
      ref: { toString: () => String(REF) } as unknown as typeof REF,
    })).toThrow(TypeError)
    expect(() => bindComputerReference({
      ...base,
      sessionId: new String(SESSION) as unknown as typeof SESSION,
    })).toThrow(TypeError)
    expect(() => bindComputerReference({
      ...base,
      processIdentity: new String('launch-identity-1') as unknown as string,
    })).toThrow(TypeError)
  })

  it('rejects a foreign session before revealing native target freshness', () => {
    expect(() => {
      assertComputerReferenceCurrent(binding(), {
        sessionId: OTHER_SESSION,
        appId: 'com.example.editor',
        processId: 4242,
        processIdentity: 'launch-identity-1',
        windowId: 'window-1',
        snapshotRevision: 7,
        displayScale: 2,
      })
    }).toThrow(expect.objectContaining<Partial<ComputerControlError>>({ code: 'UNAUTHORIZED' }))
  })

  it.each([
    { processId: 4343 },
    { processIdentity: 'launch-identity-2' },
    { windowId: 'window-2' },
    { snapshotRevision: 8 },
    { displayScale: 1 },
  ])('rejects stale native reference scope %#', (change) => {
    expect(() => {
      assertComputerReferenceCurrent(binding(), {
        sessionId: SESSION,
        appId: 'com.example.editor',
        processId: 4242,
        processIdentity: 'launch-identity-1',
        windowId: 'window-1',
        snapshotRevision: 7,
        displayScale: 2,
        ...change,
      })
    }).toThrow(expect.objectContaining<Partial<ComputerControlError>>({ code: 'STALE_REF' }))
  })

  it('enforces action and collection bounds and freezes returned collections', () => {
    expect(assertComputerActionCount(MAX_COMPUTER_ACTIONS_PER_TURN)).toBe(MAX_COMPUTER_ACTIONS_PER_TURN)
    expect(() => assertComputerActionCount(MAX_COMPUTER_ACTIONS_PER_TURN + 1))
      .toThrow(expect.objectContaining<Partial<ComputerControlError>>({ code: 'QUOTA_EXCEEDED' }))

    const source: ComputerListResult = { apps: [{ appId: 'app', name: 'App', windows: [{ windowId: 'window', title: 'Window' }] }] }
    const frozen = freezeComputerList(source)
    expect(frozen).not.toBe(source)
    expect(Object.isFrozen(frozen.apps)).toBe(true)
    expect(Object.isFrozen(frozen.apps[0]?.windows)).toBe(true)
    expect(() => {
      ;(frozen.apps as unknown[]).push({})
    }).toThrow()

    expect(() => freezeComputerList({ apps: Array.from({ length: 129 }, (_, index) => ({ appId: `app-${index}`, name: 'App', windows: [] })) }))
      .toThrow(expect.objectContaining<Partial<ComputerControlError>>({ code: 'QUOTA_EXCEEDED' }))
    expect(() => freezeComputerList({ apps: [{ appId: 'app', name: 'App', windows: Array.from({ length: 257 }, (_, index) => ({ windowId: `${index}`, title: '' })) }] }))
      .toThrow(expect.objectContaining<Partial<ComputerControlError>>({ code: 'QUOTA_EXCEEDED' }))
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

  it('preserves correlated image bytes in a detached deeply frozen snapshot envelope', () => {
    const bytes = Uint8Array.of(4, 5, 6)
    const png = new ImmutablePng(bytes)
    const result = {
      ...snapshot(),
      image: {
        transferId: PngTransferId('00000000-0000-4000-8000-000000000199'),
        byteLength: bytes.byteLength,
        sha256: 'b'.repeat(64),
        width: 1,
        height: 1,
      },
    }
    const envelope = freezeComputerSnapshotEnvelope({
      result,
      png,
      nested: { secret: 'must-not-cross' },
    } as ComputerSnapshotEnvelope)

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
    expect(second).toEqual(Uint8Array.of(4, 5, 6))
    expect(envelope.png!.read()).toEqual(Uint8Array.of(4, 5, 6))
    expect(envelope).not.toHaveProperty('nested')
    expect(envelope.png).not.toHaveProperty('bytes')
  })

  it('rejects missing, extra, or forged snapshot image owners', () => {
    const png = new ImmutablePng(Uint8Array.of(1))
    const resultWithImage = {
      ...snapshot(),
      image: {
        transferId: PngTransferId('00000000-0000-4000-8000-000000000199'),
        byteLength: 1,
        sha256: 'b'.repeat(64),
        width: 1,
        height: 1,
      },
    }

    expect(() => freezeComputerSnapshotEnvelope({ result: resultWithImage })).toThrow(/image.*PNG|PNG.*image/i)
    expect(() => freezeComputerSnapshotEnvelope({ result: snapshot(), png })).toThrow(/image.*PNG|PNG.*image/i)
    expect(() => freezeComputerSnapshotEnvelope({
      result: resultWithImage,
      png: Object.create(ImmutablePng.prototype) as ImmutablePng,
    })).toThrow(TypeError)
    expect(() => freezeComputerSnapshotEnvelope(Object.create({
      result: resultWithImage,
      png,
    }) as ComputerSnapshotEnvelope)).toThrow(TypeError)
  })

  it('canonicalizes and deeply freezes only the five PNG metadata fields', () => {
    const secret = { value: 'must-not-cross' }
    const image = {
      transferId: PngTransferId('00000000-0000-4000-8000-000000000199'),
      byteLength: 24,
      sha256: 'b'.repeat(64),
      width: 1,
      height: 1,
      secret,
    }
    const frozen = freezeComputerSnapshot({ ...snapshot(), image })
    expect(frozen.image).toEqual({
      transferId: image.transferId,
      byteLength: 24,
      sha256: 'b'.repeat(64),
      width: 1,
      height: 1,
    })
    expect(frozen.image).not.toBe(image)
    expect(Object.isFrozen(frozen.image)).toBe(true)
    expect(frozen.image).not.toHaveProperty('secret')
    secret.value = 'changed'
    expect(frozen.image).not.toHaveProperty('secret')
  })

  it('rejects pseudo-string list, snapshot, and PNG metadata primitives', () => {
    expect(() => freezeComputerList({
      apps: [{
        appId: new String('com.example.editor') as unknown as string,
        name: 'Editor',
        windows: [],
      }],
    })).toThrow(TypeError)
    expect(() => freezeComputerSnapshot({
      ...snapshot(),
      refs: [{
        ref: { toString: () => String(REF) } as unknown as typeof REF,
        role: 'button',
        name: 'Save',
      }],
    })).toThrow(TypeError)
    expect(() => freezeComputerSnapshot({
      ...snapshot(),
      image: {
        transferId: { toString: () => '00000000-0000-4000-8000-000000000199' } as unknown as ReturnType<typeof PngTransferId>,
        byteLength: 24,
        sha256: 'b'.repeat(64),
        width: 1,
        height: 1,
      },
    })).toThrow(TypeError)
  })

  it('rejects invalid PNG metadata ranges and hashes', () => {
    const image = {
      transferId: PngTransferId('00000000-0000-4000-8000-000000000199'),
      byteLength: 24,
      sha256: 'b'.repeat(64),
      width: 1,
      height: 1,
    } as const
    expect(() => freezeComputerSnapshot({ ...snapshot(), image: { ...image, byteLength: 4_194_305 } })).toThrow(TypeError)
    expect(() => freezeComputerSnapshot({ ...snapshot(), image: { ...image, sha256: 'g'.repeat(64) } })).toThrow(TypeError)
    expect(() => freezeComputerSnapshot({ ...snapshot(), image: { ...image, height: 0 } })).toThrow(TypeError)
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
        requestKind: 'browser.stop',
        requestId: REQUEST,
        sessionId: SESSION,
        deadlineUnixMs: Date.now() + 1_000,
      },
      surface: 'browser-human-persistent',
      sensitivity: 'secure-text',
      effect: 'external-side-effect',
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
    expect(classifyControlPolicy({
      request: {
        protocolVersion: 1,
        messageKind: 'request',
        requestKind: 'computer.stop',
        requestId: REQUEST,
        sessionId: SESSION,
        deadlineUnixMs: Date.now() + 1_000,
      },
      surface: 'browser-ephemeral',
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

  it.each([
    ['non-object input', null],
    ['array input', []],
    ['non-plain input', Object.assign(Object.create({ inherited: true }), {
      request: clickRequest(),
      surface: 'native-application',
      sensitivity: 'ordinary',
      effect: 'local-interaction',
    })],
    ['unknown request kind', {
      request: { ...clickRequest(), requestKind: 'computer.launch' },
      surface: 'native-application',
      sensitivity: 'ordinary',
      effect: 'local-interaction',
    }],
    ['non-string request kind', {
      request: { ...clickRequest(), requestKind: 7 },
      surface: 'native-application',
      sensitivity: 'ordinary',
      effect: 'local-interaction',
    }],
    ['unknown surface', {
      request: {
        protocolVersion: 1,
        messageKind: 'request',
        requestKind: 'browser.click',
        requestId: REQUEST,
        sessionId: SESSION,
        deadlineUnixMs: Date.now() + 1_000,
        leaseId: LEASE,
        leaseRevision: 1,
        ref: BrowserRef('browser:00000000000000000000000000000016'),
      },
      surface: 'browser-popup',
      sensitivity: 'ordinary',
      effect: 'local-interaction',
    }],
    ['non-string surface', {
      request: clickRequest(),
      surface: 1,
      sensitivity: 'ordinary',
      effect: 'local-interaction',
    }],
    ['unknown sensitivity', {
      request: clickRequest(),
      surface: 'native-application',
      sensitivity: 'routine',
      effect: 'local-interaction',
    }],
    ['non-string sensitivity', {
      request: clickRequest(),
      surface: 'native-application',
      sensitivity: {},
      effect: 'local-interaction',
    }],
    ['unknown effect', {
      request: clickRequest(),
      surface: 'native-application',
      sensitivity: 'ordinary',
      effect: 'visual-only',
    }],
    ['non-string effect', {
      request: clickRequest(),
      surface: 'native-application',
      sensitivity: 'ordinary',
      effect: {},
    }],
    ['non-plain request', {
      request: inheritedClickRequest(),
      surface: 'native-application',
      sensitivity: 'ordinary',
      effect: 'local-interaction',
    }],
  ])('denies hostile runtime policy input: %s', (_label, input) => {
    expect(() => classifyControlPolicy(input as unknown as ControlPolicyInput)).not.toThrow()
    expect(classifyControlPolicy(input as unknown as ControlPolicyInput)).toBe('DENY')
  })

  it('denies throwing accessors without invoking a default allow path', () => {
    const input = Object.defineProperty({}, 'request', {
      enumerable: true,
      get: () => { throw new Error('hostile getter') },
    })
    expect(() => classifyControlPolicy(input as unknown as ControlPolicyInput)).not.toThrow()
    expect(classifyControlPolicy(input as unknown as ControlPolicyInput)).toBe('DENY')
  })

  it('validates the runtime fact rosters before allowing Stop', () => {
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
      effect: 'bogus',
    } as unknown as ControlPolicyInput)).toBe('DENY')
  })
})
