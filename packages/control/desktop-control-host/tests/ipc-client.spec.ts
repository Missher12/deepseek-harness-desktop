import { describe, expect, it, vi } from 'vitest'
import {
  ControlLeaseId,
  RequestId,
  SessionId,
  decodeJsonFrame,
  encodeJsonFrame,
  type BridgeRequest,
  type DesktopControlMessage,
  type DesktopControlOkResponse,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  ControlLeaseCache,
  DesktopControlIpcClient,
  DesktopControlIpcError,
  MAX_CONTROL_TOMBSTONES,
  MAX_PENDING_CONTROL_REQUESTS,
  type DesktopControlIpcLink,
} from '../src/ipc-client.ts'

const SESSION = SessionId('host-session')
const OTHER_SESSION = SessionId('other-session')
const LEASE = ControlLeaseId('00000000-0000-4000-8000-000000000099')

class FakeLink implements DesktopControlIpcLink {
  readonly generation = 7
  connected = true
  readonly frames: Uint8Array[] = []
  readonly callbacks: Array<(error?: Error) => void> = []
  private readonly messageListeners = new Set<(frame: Uint8Array) => void>()
  private readonly disconnectListeners = new Set<() => void>()

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

  completeSend(error?: Error): void {
    this.callbacks.shift()?.(error)
  }

  receive(message: DesktopControlMessage): void {
    const frame = encodeJsonFrame(message)
    for (const listener of [...this.messageListeners]) listener(frame)
  }

  receiveFrame(frame: Uint8Array): void {
    for (const listener of [...this.messageListeners]) listener(new Uint8Array(frame))
  }
}

function request(
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

function response(
  input: ReturnType<typeof request>,
  requestKind: 'browser.navigate' = input.requestKind,
): DesktopControlOkResponse<'browser.navigate'> {
  return {
    protocolVersion: 1,
    messageKind: 'response',
    responseKind: 'ok',
    requestId: input.requestId,
    requestKind,
    result: { url: 'https://example.test/next', snapshotRevision: 4 },
  }
}

describe('DesktopControlIpcClient', () => {
  it('sends one copied unprefixed frame and settles only an exact response', async () => {
    const link = new FakeLink()
    const client = new DesktopControlIpcClient(link, { now: () => 10_000 })
    const outbound = request(1)
    const pending = client.request(outbound, new AbortController().signal)

    expect(link.frames).toHaveLength(1)
    expect(link.frames[0]?.[0]).toBe(0x01)
    expect(decodeJsonFrame(link.frames[0]!)).toEqual(outbound)
    link.completeSend()
    link.receive(response(outbound))

    await expect(pending).resolves.toMatchObject({
      message: { requestId: outbound.requestId, requestKind: outbound.requestKind },
    })
  })

  it('captures now once and rejects rather than clamps invalid deadlines', async () => {
    const link = new FakeLink()
    const now = vi.fn(() => 10_000)
    const client = new DesktopControlIpcClient(link, { now })

    await expect(client.request(request(1, { deadlineUnixMs: 10_000 }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'TIMEOUT' })
    await expect(client.request(request(2, { deadlineUnixMs: 40_001 }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(link.frames).toHaveLength(0)
    expect(now).toHaveBeenCalledTimes(2)
  })

  it('enforces 32 live requests and FIFO 256 terminal tombstones', async () => {
    const link = new FakeLink()
    const client = new DesktopControlIpcClient(link, { now: () => 10_000 })
    const live = Array.from({ length: MAX_PENDING_CONTROL_REQUESTS }, (_, index) =>
      client.request(request(index), new AbortController().signal))
    await expect(client.request(request(100), new AbortController().signal))
      .rejects.toMatchObject({ code: 'TOO_MANY_PENDING' })

    for (let index = 0; index < live.length; index += 1) {
      link.completeSend()
      link.receive(response(request(index)))
    }
    await Promise.all(live)

    for (let index = MAX_PENDING_CONTROL_REQUESTS; index < MAX_CONTROL_TOMBSTONES + 1; index += 1) {
      const current = request(index)
      const settled = client.request(current, new AbortController().signal)
      link.completeSend()
      link.receive(response(current))
      await settled
    }
    await expect(client.request(request(1), new AbortController().signal))
      .rejects.toMatchObject({ code: 'DUPLICATE_REQUEST' })
    const evicted = client.request(request(0), new AbortController().signal)
    link.completeSend()
    link.receive(response(request(0)))
    await expect(evicted).resolves.toBeDefined()
  })

  it('cancels with the official session tuple and ignores the late tombstoned response', async () => {
    const link = new FakeLink()
    const client = new DesktopControlIpcClient(link, { now: () => 10_000 })
    const controller = new AbortController()
    const outbound = request(1)
    const pending = client.request(outbound, controller.signal)
    link.completeSend()
    controller.abort('user')

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(decodeJsonFrame(link.frames[1]!)).toEqual({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'request.cancel',
      sessionId: SESSION,
      requestId: outbound.requestId,
    })
    link.completeSend()
    expect(() => { link.receive(response(outbound)) }).not.toThrow()
  })

  it('revokes only pending work with the exact session, lease id, and revision', async () => {
    const link = new FakeLink()
    const cache = new ControlLeaseCache()
    cache.remember(SESSION, {
      leaseId: LEASE,
      leaseRevision: 3,
      surfaceKind: 'browser-ephemeral',
      targets: [],
      capabilities: ['observe'],
      idleExpiresAfterMs: 300_000,
      hardExpiresAfterMs: 1_200_000,
    })
    const client = new DesktopControlIpcClient(link, { now: () => 10_000, leaseCache: cache })
    const exact = request(1)
    const otherRevision = request(2, { leaseRevision: 4 })
    const otherSession = request(3, { sessionId: OTHER_SESSION })
    const exactPending = client.request(exact, new AbortController().signal)
    const revisionPending = client.request(otherRevision, new AbortController().signal)
    const sessionPending = client.request(otherSession, new AbortController().signal)

    link.receive({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'lease.revoke',
      sessionId: SESSION,
      leaseId: LEASE,
      leaseRevision: 3,
    })
    expect(cache.peek(SESSION)).toBeUndefined()
    await expect(exactPending).rejects.toMatchObject({ code: 'LEASE_REVOKED' })
    link.receive(response(otherRevision))
    link.receive(response(otherSession))
    await expect(revisionPending).resolves.toBeDefined()
    await expect(sessionPending).resolves.toBeDefined()
  })

  it('closes only the control link on a wrong direction or mismatched response kind', async () => {
    const log = vi.fn()
    const link = new FakeLink()
    const client = new DesktopControlIpcClient(link, { now: () => 10_000, log })
    const outbound = request(1)
    const pending = client.request(outbound, new AbortController().signal)
    link.completeSend()
    link.receive({
      ...response(outbound),
      requestKind: 'browser.back',
      result: { url: 'https://example.test/', snapshotRevision: 4 },
    })

    await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' })
    expect(link.connected).toBe(false)
    expect(JSON.stringify(log.mock.calls)).not.toContain(String(SESSION))
    expect(JSON.stringify(log.mock.calls)).not.toContain(String(LEASE))
  })

  it('settles all work on disconnect without terminating the Harness process', async () => {
    const link = new FakeLink()
    const client = new DesktopControlIpcClient(link, { now: () => 10_000 })
    const pending = client.request(request(1), new AbortController().signal)
    link.disconnect()

    await expect(pending).rejects.toBeInstanceOf(DesktopControlIpcError)
    await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' })
  })

  it('closes the callback queue on send failure without starting a later frame', async () => {
    const link = new FakeLink()
    const client = new DesktopControlIpcClient(link, { now: () => 10_000 })
    const first = client.request(request(1), new AbortController().signal)
    const second = client.request(request(2), new AbortController().signal)

    expect(link.frames).toHaveLength(1)
    link.completeSend(new Error('ipc write failed'))

    await expect(first).rejects.toMatchObject({ code: 'DISCONNECTED' })
    await expect(second).rejects.toMatchObject({ code: 'DISCONNECTED' })
    expect(link.frames).toHaveLength(1)
    expect(link.connected).toBe(false)
  })

  it('rejects malformed non-JSON frames before any image-pending state survives', () => {
    const link = new FakeLink()
    new DesktopControlIpcClient(link, { now: () => 10_000 })

    link.receiveFrame(Uint8Array.of(0x02))

    expect(link.connected).toBe(false)
  })
})
