import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  ControlLeaseId,
  DesktopControlFrameDecoder,
  RequestId,
  SessionId,
  decodeJsonFrame,
  encodeJsonFrame,
  type BridgeRequest,
  type DecodedDesktopControlEnvelope,
  type DesktopControlMessage,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  DesktopControlBridgeServer,
  type DesktopControlBackend,
  type DesktopControlDispatchContext,
} from '../src/control/bridge-server.ts'
import type { HarnessControlChannel } from '../src/harness/process.ts'

const SESSION = SessionId('bridge-session')
const OTHER_SESSION = SessionId('other-bridge-session')
const LEASE = ControlLeaseId('00000000-0000-4000-8000-000000000055')

class FakeChannel implements HarnessControlChannel {
  connected = true
  readonly frames: Uint8Array[] = []
  readonly callbacks: Array<(error?: Error) => void> = []
  private readonly messageListeners = new Set<(frame: Uint8Array) => void>()
  private readonly disconnectListeners = new Set<() => void>()

  constructor(readonly generation: number) {}

  send(frame: Uint8Array, callback: (error?: Error) => void): void {
    this.frames.push(new Uint8Array(frame))
    this.callbacks.push(callback)
  }

  onMessage(listener: (frame: Uint8Array) => void): () => void {
    this.messageListeners.add(listener)
    return () => { this.messageListeners.delete(listener) }
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener)
    return () => { this.disconnectListeners.delete(listener) }
  }

  disconnect(): void {
    if (!this.connected) return
    this.connected = false
    for (const listener of [...this.disconnectListeners]) listener()
  }

  receive(message: DesktopControlMessage): void {
    this.receiveFrame(encodeJsonFrame(message))
  }

  receiveFrame(frame: Uint8Array): void {
    for (const listener of [...this.messageListeners]) listener(new Uint8Array(frame))
  }

  completeSend(error?: Error): void {
    this.callbacks.shift()?.(error)
  }
}

function statusRequest(sequence: number, deadlineUnixMs = 40_000): Extract<BridgeRequest, { requestKind: 'desktop.status' }> {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'desktop.status',
    requestId: RequestId(`00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`),
    sessionId: SESSION,
    deadlineUnixMs,
  }
}

function statusResponse(request: ReturnType<typeof statusRequest>): DecodedDesktopControlEnvelope {
  return {
    message: {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestId: request.requestId,
      requestKind: request.requestKind,
      result: { browserSupported: false, computerSupported: false },
    },
  }
}

function acquireRequest(
  deadlineUnixMs = 40_000,
): Extract<BridgeRequest, { requestKind: 'control.lease.acquire' }> {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'control.lease.acquire',
    requestId: RequestId('00000000-0000-4000-8000-000000000099'),
    sessionId: SESSION,
    deadlineUnixMs,
    surfaceKind: 'browser-ephemeral',
    targets: [],
    capabilities: ['observe'],
  }
}

function acquireResponse(request: ReturnType<typeof acquireRequest>): DecodedDesktopControlEnvelope {
  return {
    message: {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestId: request.requestId,
      requestKind: request.requestKind,
      result: {
        leaseId: LEASE,
        leaseRevision: 1,
        surfaceKind: 'browser-ephemeral',
        targets: [],
        capabilities: ['observe'],
        idleExpiresAfterMs: 300_000,
        hardExpiresAfterMs: 1_200_000,
      },
    },
  }
}

function navigateRequest(
  sequence: number,
  overrides: Partial<Extract<BridgeRequest, { requestKind: 'browser.navigate' }>> = {},
): Extract<BridgeRequest, { requestKind: 'browser.navigate' }> {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'browser.navigate',
    requestId: RequestId(`00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`),
    sessionId: SESSION,
    deadlineUnixMs: 40_000,
    leaseId: LEASE,
    leaseRevision: 3,
    url: 'https://example.test/',
    ...overrides,
  }
}

function backend(
  dispatch: (request: BridgeRequest, context: DesktopControlDispatchContext) => Promise<DecodedDesktopControlEnvelope>,
): DesktopControlBackend {
  return { dispatch, revokeSession: vi.fn(async () => undefined) }
}

describe('DesktopControlBridgeServer', () => {
  it('notifies the authority when an owned transport generation attaches and closes', () => {
    const transportAttached = vi.fn()
    const transportClosed = vi.fn()
    const authority = {
      ...backend(async request => statusResponse(request as ReturnType<typeof statusRequest>)),
      transportAttached,
      transportClosed,
    }
    const server = new DesktopControlBridgeServer({ backend: authority, now: () => 10_000 })
    const channel = new FakeChannel(1)

    server.attach(channel)
    expect(transportAttached).toHaveBeenCalledOnce()
    channel.disconnect()
    expect(transportClosed).toHaveBeenCalledWith('peer-disconnected')
  })

  it('accepts all bridge requests only from Harness and replies from the injected backend', async () => {
    const dispatch = vi.fn<DesktopControlBackend['dispatch']>(
      async request => statusResponse(request as ReturnType<typeof statusRequest>),
    )
    const server = new DesktopControlBridgeServer({ backend: backend(dispatch), now: () => 10_000 })
    const channel = new FakeChannel(1)
    server.attach(channel)

    const request = statusRequest(1)
    channel.receive(request)
    await vi.waitFor(() => { expect(dispatch).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(channel.frames).toHaveLength(1) })

    expect(decodeJsonFrame(channel.frames[0]!)).toEqual(statusResponse(request).message)
    expect(dispatch.mock.calls[0]?.[1]).toMatchObject({ timeoutMs: 30_000, generation: 1 })
  })

  it('closes the control link immediately for a wrong-direction image response without awaiting PNG', () => {
    const server = new DesktopControlBridgeServer({
      backend: backend(async request => statusResponse(request as ReturnType<typeof statusRequest>)),
      now: () => 10_000,
    })
    const channel = new FakeChannel(1)
    server.attach(channel)
    const imageResponse = readFileSync(new URL(
      '../../../packages/control/desktop-control-protocol/fixtures/browser-snapshot-json.bin',
      import.meta.url,
    ))

    channel.receiveFrame(imageResponse)

    expect(channel.connected).toBe(false)
  })

  it('serializes a JSON plus PNG envelope atomically and advances only from send callbacks', async () => {
    const fixtureDecoder = new DesktopControlFrameDecoder()
    fixtureDecoder.pushFrame(readFileSync(new URL(
      '../../../packages/control/desktop-control-protocol/fixtures/browser-snapshot-json.bin',
      import.meta.url,
    )))
    const fixture = fixtureDecoder.pushFrame(readFileSync(new URL(
      '../../../packages/control/desktop-control-protocol/fixtures/browser-snapshot-png.bin',
      import.meta.url,
    )))[0]!
    const fixturePng = fixture.png
    if (fixture.message.messageKind !== 'response'
      || fixture.message.responseKind !== 'ok'
      || fixture.message.requestKind !== 'browser.snapshot'
      || fixturePng === undefined) {
      throw new Error('Browser snapshot fixture did not decode as an image response.')
    }
    const firstRequest: Extract<BridgeRequest, { requestKind: 'browser.snapshot' }> = {
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'browser.snapshot',
      requestId: RequestId('00000000-0000-4000-8000-000000000901'),
      sessionId: SESSION,
      deadlineUnixMs: 10_001,
      leaseId: '00000000-0000-4000-8000-000000000055' as never,
      leaseRevision: 1,
      includeImage: true,
    }
    const imageMessage = { ...fixture.message, requestId: firstRequest.requestId }
    const server = new DesktopControlBridgeServer({
      backend: backend(async request => request.requestKind === 'browser.snapshot'
        ? { message: imageMessage, png: fixturePng }
        : statusResponse(request as ReturnType<typeof statusRequest>)),
      now: () => 10_000,
    })
    const channel = new FakeChannel(1)
    server.attach(channel)

    channel.receive(firstRequest)
    channel.receive(statusRequest(2))
    await vi.waitFor(() => { expect(channel.frames).toHaveLength(1) })
    expect(channel.frames[0]?.[0]).toBe(0x01)
    channel.completeSend()
    expect(channel.frames).toHaveLength(2)
    expect(channel.frames[1]?.[0]).toBe(0x02)
    channel.completeSend()
    expect(channel.frames).toHaveLength(3)
    expect(channel.frames[2]?.[0]).toBe(0x01)
  })

  it('rejects invalid deadlines, duplicates, and the 33rd pending request without clamping', async () => {
    const held = new Promise<DecodedDesktopControlEnvelope>(() => undefined)
    const server = new DesktopControlBridgeServer({
      backend: backend(async () => await held),
      now: () => 10_000,
    })
    const channel = new FakeChannel(1)
    server.attach(channel)

    channel.receive(statusRequest(1, 10_000))
    await vi.waitFor(() => { expect(channel.frames).toHaveLength(1) })
    expect(decodeJsonFrame(channel.frames[0]!)).toMatchObject({
      responseKind: 'error', error: { code: 'TIMEOUT' },
    })
    channel.completeSend()

    for (let index = 0; index < 32; index += 1) channel.receive(statusRequest(index + 10))
    channel.receive(statusRequest(10))
    channel.receive(statusRequest(100))
    await vi.waitFor(() => { expect(channel.frames.length).toBe(2) })
    channel.completeSend()
    await vi.waitFor(() => { expect(channel.frames.length).toBe(3) })
    expect(channel.frames.map(frame => decodeJsonFrame(frame)).filter(message => (
      message.messageKind === 'response' && message.responseKind === 'error'
    )).map(message => message.messageKind === 'response' && message.responseKind === 'error'
      ? message.error.code
      : undefined)).toEqual(expect.arrayContaining(['DUPLICATE_REQUEST', 'TOO_MANY_PENDING']))
  })

  it('requires cancellation to match the active official session and request tuple', async () => {
    const signals: AbortSignal[] = []
    const server = new DesktopControlBridgeServer({
      backend: backend(async (_request, context) => {
        signals.push(context.signal)
        return await new Promise<DecodedDesktopControlEnvelope>(() => undefined)
      }),
      now: () => 10_000,
    })
    const channel = new FakeChannel(1)
    server.attach(channel)
    const request = statusRequest(1)
    channel.receive(request)
    await vi.waitFor(() => { expect(signals).toHaveLength(1) })

    channel.receive({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'request.cancel',
      sessionId: SESSION,
      requestId: request.requestId,
    })

    expect(signals[0]?.aborted).toBe(true)
    await vi.waitFor(() => { expect(channel.frames).toHaveLength(1) })
    expect(decodeJsonFrame(channel.frames[0]!)).toMatchObject({
      responseKind: 'error', error: { code: 'CANCELLED' },
    })
  })

  it('cancels an activated acquisition on deadline and never accepts its late response', async () => {
    vi.useFakeTimers()
    try {
      let resolve!: (value: DecodedDesktopControlEnvelope) => void
      const held = new Promise<DecodedDesktopControlEnvelope>((done) => { resolve = done })
      const accepted = vi.fn()
      const cancelled = vi.fn(async () => undefined)
      const server = new DesktopControlBridgeServer({
        backend: backend(async (request, rawContext) => {
          const acquireContext = rawContext as DesktopControlDispatchContext & {
            registerAcquisition(completion: { accept(): void; cancel(): Promise<void> }): boolean
          }
          expect(acquireContext.registerAcquisition({ accept: accepted, cancel: cancelled })).toBe(true)
          return await held
        }),
        now: () => 10_000,
      })
      const channel = new FakeChannel(1)
      server.attach(channel)
      const request = acquireRequest(10_001)
      channel.receive(request)
      await Promise.resolve()

      await vi.advanceTimersByTimeAsync(1)
      expect(cancelled).toHaveBeenCalledOnce()
      expect(accepted).not.toHaveBeenCalled()
      expect(decodeJsonFrame(channel.frames[0]!)).toMatchObject({
        responseKind: 'error', error: { code: 'TIMEOUT' },
      })

      resolve(acquireResponse(request))
      await Promise.resolve()
      await Promise.resolve()
      expect(channel.frames).toHaveLength(1)
      expect(accepted).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a backend microtask completion when absolute time reached the deadline before its timer ran', async () => {
    vi.useFakeTimers()
    try {
      let nowUnixMs = 10_000
      let resolve!: (value: DecodedDesktopControlEnvelope) => void
      const held = new Promise<DecodedDesktopControlEnvelope>((done) => { resolve = done })
      let active = true
      const accepted = vi.fn()
      const cancelled = vi.fn(async () => { active = false })
      const request = acquireRequest(10_001)
      const server = new DesktopControlBridgeServer({
        backend: backend(async (_request, context) => {
          expect(context.registerAcquisition({ accept: accepted, cancel: cancelled })).toBe(true)
          return await held
        }),
        now: () => nowUnixMs,
      })
      const channel = new FakeChannel(1)
      server.attach(channel)
      channel.receive(request)
      await Promise.resolve()

      nowUnixMs = request.deadlineUnixMs
      resolve(acquireResponse(request))
      for (let index = 0; index < 4; index += 1) await Promise.resolve()

      expect(decodeJsonFrame(channel.frames[0]!)).toMatchObject({
        responseKind: 'error', error: { code: 'TIMEOUT' },
      })
      expect(accepted).not.toHaveBeenCalled()
      expect(cancelled).toHaveBeenCalledOnce()
      expect(active).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts only a registered acquisition while the exact response remains pending', async () => {
    const request = acquireRequest()
    const accepted = vi.fn()
    const cancelled = vi.fn(async () => undefined)
    const registered = new DesktopControlBridgeServer({
      backend: backend(async (_request, rawContext) => {
        const acquireContext = rawContext as DesktopControlDispatchContext & {
          registerAcquisition(completion: { accept(): void; cancel(): Promise<void> }): boolean
        }
        expect(acquireContext.registerAcquisition({ accept: accepted, cancel: cancelled })).toBe(true)
        return acquireResponse(request)
      }),
      now: () => 10_000,
    })
    const acceptedChannel = new FakeChannel(1)
    registered.attach(acceptedChannel)
    acceptedChannel.receive(request)
    await vi.waitFor(() => { expect(acceptedChannel.frames).toHaveLength(1) })
    expect(accepted).toHaveBeenCalledOnce()
    expect(cancelled).not.toHaveBeenCalled()
    expect(decodeJsonFrame(acceptedChannel.frames[0]!)).toMatchObject({ responseKind: 'ok' })

    const unregistered = new DesktopControlBridgeServer({
      backend: backend(async () => acquireResponse(request)),
      now: () => 10_000,
    })
    const rejectedChannel = new FakeChannel(2)
    unregistered.attach(rejectedChannel)
    rejectedChannel.receive(request)
    await vi.waitFor(() => { expect(rejectedChannel.frames).toHaveLength(1) })
    expect(decodeJsonFrame(rejectedChannel.frames[0]!)).toMatchObject({
      responseKind: 'error', error: { code: 'INTERNAL' },
    })
  })

  it('sends lease revocation before settling only the exact pending tuple', async () => {
    const signals = new Map<string, AbortSignal>()
    const server = new DesktopControlBridgeServer({
      backend: backend(async (request, context) => {
        signals.set(String(request.requestId), context.signal)
        return await new Promise<DecodedDesktopControlEnvelope>(() => undefined)
      }),
      now: () => 10_000,
    })
    const channel = new FakeChannel(1)
    server.attach(channel)
    const exact = navigateRequest(1)
    const otherRevision = navigateRequest(2, { leaseRevision: 4 })
    const otherSession = navigateRequest(3, { sessionId: OTHER_SESSION })
    channel.receive(exact)
    channel.receive(otherRevision)
    channel.receive(otherSession)
    await vi.waitFor(() => { expect(signals).toHaveLength(3) })

    server.revokeLease({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'lease.revoke',
      sessionId: SESSION,
      leaseId: LEASE,
      leaseRevision: 3,
    })

    expect(signals.get(String(exact.requestId))?.aborted).toBe(true)
    expect(signals.get(String(otherRevision.requestId))?.aborted).toBe(false)
    expect(signals.get(String(otherSession.requestId))?.aborted).toBe(false)
    expect(decodeJsonFrame(channel.frames[0]!)).toMatchObject({
      messageKind: 'control',
      controlKind: 'lease.revoke',
      sessionId: SESSION,
      leaseId: LEASE,
      leaseRevision: 3,
    })
    channel.completeSend()
    await vi.waitFor(() => { expect(channel.frames).toHaveLength(2) })
    expect(decodeJsonFrame(channel.frames[1]!)).toMatchObject({
      responseKind: 'error',
      requestId: exact.requestId,
      error: { code: 'LEASE_REVOKED' },
    })
  })

  it('retains exactly 256 terminal request IDs without refreshing duplicate order', async () => {
    const server = new DesktopControlBridgeServer({
      backend: backend(async request => statusResponse(request as ReturnType<typeof statusRequest>)),
      now: () => 10_000,
    })
    const channel = new FakeChannel(1)
    server.attach(channel)

    for (let index = 0; index < 257; index += 1) {
      channel.receive(statusRequest(index, 10_000))
      channel.completeSend()
    }
    channel.receive(statusRequest(1, 10_000))
    channel.completeSend()
    channel.receive(statusRequest(0, 10_000))

    const messages = channel.frames.map(frame => decodeJsonFrame(frame))
    expect(messages.at(-2)).toMatchObject({ responseKind: 'error', error: { code: 'DUPLICATE_REQUEST' } })
    expect(messages.at(-1)).toMatchObject({ responseKind: 'error', error: { code: 'TIMEOUT' } })
  })

  it('closes the callback queue on send failure without starting a later envelope', async () => {
    const server = new DesktopControlBridgeServer({
      backend: backend(async request => statusResponse(request as ReturnType<typeof statusRequest>)),
      now: () => 10_000,
    })
    const channel = new FakeChannel(1)
    server.attach(channel)
    channel.receive(statusRequest(1))
    channel.receive(statusRequest(2))
    await vi.waitFor(() => { expect(channel.frames).toHaveLength(1) })

    channel.completeSend(new Error('ipc write failed'))
    await vi.waitFor(() => { expect(channel.connected).toBe(false) })

    expect(channel.frames).toHaveLength(1)
  })

  it('guards late completions with exact channel identity and generation', async () => {
    let resolve!: (value: DecodedDesktopControlEnvelope) => void
    const held = new Promise<DecodedDesktopControlEnvelope>((done) => { resolve = done })
    const request = statusRequest(1)
    const server = new DesktopControlBridgeServer({
      backend: backend(async () => await held),
      now: () => 10_000,
    })
    const first = new FakeChannel(1)
    const second = new FakeChannel(2)
    server.attach(first)
    first.receive(request)
    server.detach(first)
    server.attach(second)

    resolve(statusResponse(request))
    await Promise.resolve()
    await Promise.resolve()

    expect(first.frames).toHaveLength(0)
    expect(second.frames).toHaveLength(0)
  })

  it('awaits injected cleanup, parent.shutdown callback, then disconnects only IPC', async () => {
    const order: string[] = []
    const beforeControlShutdown = vi.fn(async () => { order.push('authority-cleanup') })
    const server = new DesktopControlBridgeServer({
      backend: backend(async request => statusResponse(request as ReturnType<typeof statusRequest>)),
      beforeControlShutdown,
      now: () => 10_000,
    })
    const channel = new FakeChannel(1)
    server.attach(channel)

    const shutdown = server.beforeStop(channel)
    await vi.waitFor(() => { expect(channel.frames).toHaveLength(1) })
    order.push('send')
    expect(decodeJsonFrame(channel.frames[0]!)).toEqual({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'parent.shutdown',
    })
    channel.completeSend()
    await shutdown
    order.push(channel.connected ? 'connected' : 'disconnected')

    expect(order).toEqual(['authority-cleanup', 'send', 'disconnected'])
  })

  it('logs only bounded metadata and never protocol content', async () => {
    const log = vi.fn()
    const sentinel = 'https://secret.invalid/sentinel'
    const server = new DesktopControlBridgeServer({
      backend: backend(async () => { throw new Error(sentinel) }),
      now: () => 10_000,
      log,
    })
    const channel = new FakeChannel(1)
    server.attach(channel)
    channel.receive({ ...statusRequest(1), sessionId: SessionId('secret-session') })
    await vi.waitFor(() => { expect(channel.frames).toHaveLength(1) })

    const rendered = JSON.stringify(log.mock.calls)
    expect(rendered).not.toContain(sentinel)
    expect(rendered).not.toContain('secret-session')
  })
})
