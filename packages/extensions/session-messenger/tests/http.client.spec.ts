import { EventEmitter } from 'node:events'
import { IncomingMessage, type ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import {
  ACK_PATH,
  EVENTS_PATH,
  MAX_ACK_BODY_BYTES,
  MESSENGER_CAPABILITY_HEADER,
  SNAPSHOT_PATH,
  createSessionMessengerCapability,
  createSessionMessengerHttpSurface,
  createSessionMessengerOperator,
  injectSessionMessengerCapability,
  installSessionMessengerHttp,
} from '../src/http.ts'
import {
  MAX_EVENT_CLIENTS,
  SessionMessengerEventHub,
  type ReceiptEventSource,
  type ReceiptTransitionListener,
} from '../src/events.ts'
import { DeliveryId, ReplyToken, type Receipt, type ReceiptTransition } from '../src/types.ts'
import { apply as applyMessenger, inject as messengerInject } from '../src/index.ts'
import { fakeAgent, fakeContext } from './helpers.client.ts'

const SEND_PATH = '/plugins/dsh-session-messenger/send'
const REPLY_PATH = '/plugins/dsh-session-messenger/reply'
const STOP_PATH = '/plugins/dsh-session-messenger/stop'

const PORT = 50_288
const AUTHORITY = `127.0.0.1:${String(PORT)}`
const ORIGIN = `http://${AUTHORITY}`
const CAPABILITY = 'test-only-capability'

function receipt(
  id: string,
  status: Receipt['status'] = 'delivered',
  overrides: Partial<Receipt> = {},
): Receipt {
  const common = {
    id: DeliveryId(id),
    sourceSessionId: 'source-session' as SessionId,
    targetSessionId: 'target-session' as SessionId,
    messageId: `${id}-message` as MessageId,
    mode: 'inject' as const,
    createdAt: 1,
    updatedAt: 2,
    expiresAt: 86_400_001,
    replyToken: ReplyToken(`${id}-private-reply-token`),
    hop: 0,
    wakeRequested: false,
  }
  if (status === 'prepared') {
    return { ...common, status, envelope: { body: `secret body ${id}` }, ...overrides } as Receipt
  }
  if (status === 'delivery-recovery-pending') {
    return {
      ...common,
      status,
      envelope: { body: `secret body ${id}` },
      recoveryReason: 'test',
      ...overrides,
    } as Receipt
  }
  if (status === 'delivered') {
    return { ...common, status, deliveredAt: 2, ...overrides } as Receipt
  }
  if (status === 'claimed') {
    return { ...common, status, deliveredAt: 2, claimedAt: 3, ...overrides } as Receipt
  }
  if (status === 'replied') {
    return {
      ...common,
      status,
      deliveredAt: 2,
      repliedAt: 3,
      replyDeliveryId: DeliveryId('reverse-delivery'),
      ...overrides,
    } as Receipt
  }
  return { ...common, status, settledAt: 3, errorCode: 'delivery-failed', ...overrides } as Receipt
}

class FakeSource implements ReceiptEventSource {
  readonly records = new Map<DeliveryId, Receipt>()
  private readonly listeners = new Set<ReceiptTransitionListener>()

  constructor(initial: readonly Receipt[] = []) {
    for (const item of initial) this.records.set(item.id, item)
  }

  receiptEntries(): Array<[DeliveryId, Receipt]> {
    return [...this.records.entries()]
  }

  subscribe(listener: ReceiptTransitionListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit(item: Receipt): void {
    this.records.set(item.id, item)
    const transition: ReceiptTransition = { kind: 'upsert', receipt: item }
    for (const listener of this.listeners) listener(transition)
  }

  remove(id: DeliveryId): void {
    this.records.delete(id)
    for (const listener of this.listeners) {
      listener({ kind: 'delete', deliveryId: id })
    }
  }

  listenerCount(): number {
    return this.listeners.size
  }
}

interface ResponseState {
  status?: number
  headers: Record<string, string>
  body: string
  ended: boolean
}

function request(
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: string | Buffer,
  rawHeaders: readonly string[] = Object.entries(headers).flatMap(([name, value]) => [name, value]),
): IncomingMessage {
  const req = new IncomingMessage(new Socket())
  req.url = path
  req.method = method
  req.headers = headers
  req.rawHeaders = [...rawHeaders]
  if (body !== undefined) req.push(Buffer.isBuffer(body) ? body : Buffer.from(body))
  req.push(null)
  return req
}

function response(): { res: ServerResponse; state: ResponseState } {
  const state: ResponseState = { headers: {}, body: '', ended: false }
  const chunks: Buffer[] = []
  const emitter = new EventEmitter()
  const res = Object.assign(emitter, {
    writableEnded: false,
    writeHead(status: number, headers?: Record<string, string>) {
      state.status = status
      state.headers = Object.fromEntries(
        Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
      )
      return this
    },
    flushHeaders() {},
    write(chunk: string | Uint8Array) {
      chunks.push(Buffer.from(chunk))
      state.body = Buffer.concat(chunks).toString('utf8')
      return true
    },
    end(this: { writableEnded: boolean }, chunk?: string | Uint8Array) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk))
      state.body = Buffer.concat(chunks).toString('utf8')
      state.ended = true
      this.writableEnded = true
      emitter.emit('finish')
      return this
    },
  }) as unknown as ServerResponse
  return { res, state }
}

function validHeaders(contentType = false): Record<string, string> {
  return {
    host: AUTHORITY,
    origin: ORIGIN,
    [MESSENGER_CAPABILITY_HEADER]: CAPABILITY,
    ...(contentType ? { 'content-type': 'application/json' } : {}),
  }
}

async function invoke(
  route: WebRoute,
  headers = validHeaders(),
  body?: string | Buffer,
  method = 'POST',
): Promise<ResponseState> {
  const output = response()
  await route.handler(request(route.path, method, headers, body), output.res)
  return output.state
}

function route(surface: ReturnType<typeof createSessionMessengerHttpSurface>, path: string): WebRoute {
  const found = surface.routes.find(candidate => candidate.path === path)
  if (found === undefined) throw new Error(`route not found: ${path}`)
  return found
}

describe('session messenger HTTP trust fence', () => {
  it('requires exact loopback Host, Origin, and per-generation capability on every POST', async () => {
    const source = new FakeSource()
    const surface = createSessionMessengerHttpSurface({ port: PORT, capability: CAPABILITY, source })
    const paths = [SNAPSHOT_PATH, ACK_PATH, EVENTS_PATH, SEND_PATH, REPLY_PATH]
    for (const path of paths) {
      const candidate = route(surface, path)
      const body = path === ACK_PATH
        ? JSON.stringify({ sessionId: 'target-session', deliveryIds: [] })
        : path === SEND_PATH
          ? JSON.stringify({ sourceSessionId: 'source-session', targetSessionId: 'target-session', message: 'hello', wake: false })
          : path === REPLY_PATH
            ? JSON.stringify({ sourceSessionId: 'target-session', deliveryId: 'delivery-1', message: 'answer', wake: false })
            : undefined
      for (const headers of [
        { ...validHeaders(body !== undefined), host: 'localhost:50288' },
        { ...validHeaders(body !== undefined), host: '127.0.0.1:50289' },
        { ...validHeaders(body !== undefined), origin: 'http://localhost:50288' },
        Object.fromEntries(Object.entries(validHeaders(body !== undefined)).filter(([key]) => key !== 'origin')),
        { ...validHeaders(body !== undefined), [MESSENGER_CAPABILITY_HEADER]: 'wrong' },
        Object.fromEntries(Object.entries(validHeaders(body !== undefined))
          .filter(([key]) => key !== MESSENGER_CAPABILITY_HEADER)),
      ]) {
        const state = await invoke(candidate, headers, body)
        expect(state.status, `${path} accepted ${JSON.stringify(headers)}`).toBe(403)
        expect(Object.keys(state.headers)).not.toContain('access-control-allow-origin')
      }
    }
    surface.dispose()
  })

  it('accepts only POST and never grants CORS', async () => {
    const surface = createSessionMessengerHttpSurface({
      port: PORT,
      capability: CAPABILITY,
      source: new FakeSource(),
    })
    const state = await invoke(route(surface, SNAPSHOT_PATH), validHeaders(), undefined, 'GET')
    expect(state.status).toBe(405)
    expect(state.headers.allow).toBe('POST')
    expect(Object.keys(state.headers)).not.toContain('access-control-allow-origin')
    surface.dispose()
  })

  it('rejects duplicate security headers even when normalized headers contain the trusted value', async () => {
    const source = new FakeSource()
    const surface = createSessionMessengerHttpSurface({ port: PORT, capability: CAPABILITY, source })
    const headers = validHeaders(true)
    const trustedRaw = Object.entries(headers).flatMap(([name, value]) => [name, value])
    const ambiguous = [
      [...trustedRaw, 'Host', 'evil.example'],
      [...trustedRaw, 'Origin', 'http://evil.example'],
      [...trustedRaw, MESSENGER_CAPABILITY_HEADER, 'evil-capability'],
      [],
    ]

    for (const path of [SNAPSHOT_PATH, ACK_PATH, EVENTS_PATH, SEND_PATH, REPLY_PATH]) {
      for (const rawHeaders of ambiguous) {
        const output = response()
        const body = path === ACK_PATH
          ? JSON.stringify({ sessionId: 'target-session', deliveryIds: [] })
          : path === SEND_PATH
            ? JSON.stringify({ sourceSessionId: 'source-session', targetSessionId: 'target-session', message: 'hello', wake: false })
            : path === REPLY_PATH
              ? JSON.stringify({ sourceSessionId: 'target-session', deliveryId: 'delivery-1', message: 'answer', wake: false })
              : undefined
        await route(surface, path).handler(
          request(path, 'POST', headers, body, rawHeaders),
          output.res,
        )
        expect(output.state.status, `${path} accepted ${JSON.stringify(rawHeaders)}`).toBe(403)
        expect(Object.keys(output.state.headers)).not.toContain('access-control-allow-origin')
      }
    }
    surface.dispose()
  })

  it('bounds acknowledgement JSON to 4 KiB before changing notification state', async () => {
    const incoming = receipt('reply', 'delivered', { replyToDeliveryId: DeliveryId('original') })
    const source = new FakeSource([incoming])
    const surface = createSessionMessengerHttpSurface({ port: PORT, capability: CAPABILITY, source })
    const ackRoute = route(surface, ACK_PATH)

    const oversized = await invoke(
      ackRoute,
      { ...validHeaders(true), 'content-length': String(MAX_ACK_BODY_BYTES + 1) },
      Buffer.alloc(MAX_ACK_BODY_BYTES + 1, 0x20),
    )
    expect(oversized.status).toBe(413)
    expect(surface.hub.snapshot().receipts[0]?.acknowledged).toBe(false)

    const accepted = await invoke(
      ackRoute,
      validHeaders(true),
      JSON.stringify({ sessionId: 'target-session', deliveryIds: ['reply'] }),
    )
    expect(accepted.status).toBe(200)
    expect(JSON.parse(accepted.body)).toEqual({ acknowledged: 1 })
    expect(surface.hub.snapshot().receipts[0]?.acknowledged).toBe(true)
    expect(source.records.get(DeliveryId('reply'))).toBe(incoming)
    expect(source.records.size).toBe(1)
    surface.dispose()
  })

  it('accepts bounded send and receipt-bound reply requests without exposing reply authority', async () => {
    const source = new FakeSource()
    const send = vi.fn(async () => ({
      deliveryId: DeliveryId('outgoing'),
      messageId: 'outgoing-message' as MessageId,
      status: 'delivered' as const,
      wakeRequested: true,
    }))
    const reply = vi.fn(async () => ({
      deliveryId: DeliveryId('reverse'),
      messageId: 'reverse-message' as MessageId,
      status: 'delivered' as const,
      wakeRequested: false,
    }))
    const stop = vi.fn(async () => ({
      deliveryId: DeliveryId('reverse'),
      rootDeliveryId: DeliveryId('outgoing'),
      status: 'stopped' as const,
      stoppedAt: 2_000,
    }))
    const surface = createSessionMessengerHttpSurface({
      port: PORT,
      capability: CAPABILITY,
      source,
      operator: { send, reply, stop },
    })

    const sent = await invoke(
      route(surface, SEND_PATH),
      validHeaders(true),
      JSON.stringify({
        sourceSessionId: 'source-session',
        targetSessionId: 'target-session',
        message: 'hello',
        wake: true,
      }),
    )
    expect(sent.status).toBe(200)
    expect(send).toHaveBeenCalledWith({
      sourceSessionId: 'source-session',
      targetSessionId: 'target-session',
      message: 'hello',
      wake: true,
    }, expect.any(AbortSignal))
    expect(JSON.parse(sent.body)).toEqual({
      deliveryId: 'outgoing',
      messageId: 'outgoing-message',
      status: 'delivered',
      wakeRequested: true,
    })
    expect(sent.body).not.toContain('replyToken')

    const replied = await invoke(
      route(surface, REPLY_PATH),
      validHeaders(true),
      JSON.stringify({
        sourceSessionId: 'target-session',
        deliveryId: 'delivery-1',
        message: 'answer',
        wake: false,
      }),
    )
    expect(replied.status).toBe(200)
    expect(reply).toHaveBeenCalledWith({
      sourceSessionId: 'target-session',
      deliveryId: DeliveryId('delivery-1'),
      message: 'answer',
      wake: false,
    }, expect.any(AbortSignal))
    expect(replied.body).not.toContain('replyToken')

    const stopped = await invoke(
      route(surface, STOP_PATH),
      validHeaders(true),
      JSON.stringify({ sourceSessionId: 'source-session', deliveryId: 'reverse' }),
    )
    expect(stopped.status).toBe(200)
    expect(stop).toHaveBeenCalledWith({
      sourceSessionId: 'source-session', deliveryId: DeliveryId('reverse'),
    })
    expect(JSON.parse(stopped.body)).toMatchObject({ status: 'stopped', rootDeliveryId: 'outgoing' })
    surface.dispose()
  })

  it('rejects malformed, non-JSON, and oversized operator bodies before calling the coordinator', async () => {
    const send = vi.fn()
    const reply = vi.fn()
    const surface = createSessionMessengerHttpSurface({
      port: PORT,
      capability: CAPABILITY,
      source: new FakeSource(),
      operator: { send, reply, stop: vi.fn() },
    })
    const candidate = route(surface, SEND_PATH)

    expect((await invoke(candidate, validHeaders(), '{}')).status).toBe(415)
    expect((await invoke(candidate, validHeaders(true), '{')).status).toBe(400)
    expect((await invoke(candidate, validHeaders(true), JSON.stringify({
      sourceSessionId: 'source-session',
      targetSessionId: 'target-session',
      message: 'hello',
      wake: false,
      replyToken: 'must-not-be-accepted',
    }))).status).toBe(400)
    expect((await invoke(candidate, {
      ...validHeaders(true),
      'content-length': String(18 * 1024 + 1),
    }, Buffer.alloc(18 * 1024 + 1, 0x20))).status).toBe(413)
    expect(send).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
    surface.dispose()
  })
})

describe('session messenger metadata event stream', () => {
  it('publishes authoritative snapshots and strips bodies, reply tokens, and capabilities', async () => {
    const source = new FakeSource([receipt('prepared', 'prepared')])
    const surface = createSessionMessengerHttpSurface({ port: PORT, capability: CAPABILITY, source })
    const snapshot = await invoke(route(surface, SNAPSHOT_PATH))

    expect(snapshot.status).toBe(200)
    const parsed = JSON.parse(snapshot.body) as Record<string, unknown>
    expect(parsed).toMatchObject({ lastEventId: 0 })
    expect(JSON.stringify(parsed)).not.toContain('secret body')
    expect(JSON.stringify(parsed)).not.toContain('private-reply-token')
    expect(JSON.stringify(parsed)).not.toContain(CAPABILITY)
    expect(Object.keys(snapshot.headers)).not.toContain('access-control-allow-origin')
    surface.dispose()
  })

  it('uses monotonic ids and replays only events after Last-Event-ID', async () => {
    const source = new FakeSource()
    const surface = createSessionMessengerHttpSurface({ port: PORT, capability: CAPABILITY, source })
    source.emit(receipt('first'))
    source.emit(receipt('second', 'failed'))

    const output = response()
    await route(surface, EVENTS_PATH).handler(request(EVENTS_PATH, 'POST', {
      ...validHeaders(),
      'last-event-id': '1',
    }), output.res)

    expect(output.state.status).toBe(200)
    expect(output.state.body).toContain('id: 2\n')
    expect(output.state.body).not.toContain('id: 1\n')
    expect(output.state.body).toContain('"deliveryId":"second"')
    expect(output.state.body).not.toContain('private-reply-token')
    expect(output.state.body).not.toContain('secret body')
    expect(Object.keys(output.state.headers)).not.toContain('access-control-allow-origin')
    surface.dispose()
    expect(output.state.ended).toBe(true)
  })

  it('returns 409 when the requested cursor predates the bounded replay ring', async () => {
    const source = new FakeSource()
    const surface = createSessionMessengerHttpSurface({ port: PORT, capability: CAPABILITY, source })
    for (let index = 1; index <= 257; index += 1) {
      source.emit(receipt(`receipt-${String(index)}`))
    }

    const stale = await invoke(route(surface, EVENTS_PATH), {
      ...validHeaders(),
      'last-event-id': '0',
    })
    expect(stale.status).toBe(409)
    expect(stale.body).toBe('event replay unavailable')
    expect(Object.keys(stale.headers)).not.toContain('access-control-allow-origin')

    const replayable = response()
    await route(surface, EVENTS_PATH).handler(request(EVENTS_PATH, 'POST', {
      ...validHeaders(),
      'last-event-id': '1',
    }), replayable.res)
    expect(replayable.state.status).toBe(200)
    expect(replayable.state.body).toContain('id: 2\n')
    expect(replayable.state.body).toContain('id: 257\n')
    surface.dispose()
  })

  it('removes compacted metadata from snapshots and publishes a metadata-only tombstone', () => {
    const incoming = receipt('reply', 'delivered', {
      replyToDeliveryId: DeliveryId('original'),
    })
    const source = new FakeSource([incoming])
    const hub = new SessionMessengerEventHub(source)
    expect(hub.acknowledge('target-session' as SessionId, [DeliveryId('reply')])).toBe(1)

    source.remove(DeliveryId('reply'))

    expect(hub.snapshot().receipts).toEqual([])
    const replay: unknown[] = []
    hub.subscribeAfter(0, (event) => { replay.push(event) })()
    expect(replay).toContainEqual({ id: 2, kind: 'remove', deliveryId: DeliveryId('reply') })
    expect(JSON.stringify(replay)).not.toContain('secret body')
    expect(JSON.stringify(replay)).not.toContain('private-reply-token')

    source.emit(receipt('reply', 'delivered', { replyToDeliveryId: DeliveryId('replacement') }))
    expect(hub.snapshot().receipts[0]?.acknowledged).toBe(false)
    hub.dispose()
  })

  it('caps active streaming clients and releases every connection on dispose', async () => {
    const surface = createSessionMessengerHttpSurface({
      port: PORT,
      capability: CAPABILITY,
      source: new FakeSource(),
    })
    const open: ResponseState[] = []
    for (let index = 0; index < MAX_EVENT_CLIENTS; index += 1) {
      const output = response()
      await route(surface, EVENTS_PATH).handler(
        request(EVENTS_PATH, 'POST', validHeaders()),
        output.res,
      )
      expect(output.state.status).toBe(200)
      open.push(output.state)
    }
    const refused = await invoke(route(surface, EVENTS_PATH))
    expect(refused.status).toBe(503)
    surface.dispose()
    expect(open.every(state => state.ended)).toBe(true)
  })

  it('keeps streaming after the POST request completes and closes with the response transport', async () => {
    const surface = createSessionMessengerHttpSurface({
      port: PORT,
      capability: CAPABILITY,
      source: new FakeSource(),
    })
    const input = request(EVENTS_PATH, 'POST', validHeaders())
    const output = response()
    await route(surface, EVENTS_PATH).handler(input, output.res)
    input.emit('close')
    expect(output.state.ended).toBe(false)

    output.res.emit('close')
    expect(output.state.ended).toBe(true)
    surface.dispose()
  })

  it('does not mutate receipt storage when acknowledgement clears an unread notification', () => {
    const incoming = receipt('reply', 'claimed', { replyToDeliveryId: DeliveryId('original') })
    const source = new FakeSource([incoming])
    const hub = new SessionMessengerEventHub(source)
    expect(hub.acknowledge('target-session' as SessionId, [DeliveryId('reply')])).toBe(1)
    expect(hub.snapshot().receipts[0]?.acknowledged).toBe(true)
    expect(source.records.get(DeliveryId('reply'))).toBe(incoming)
    hub.dispose()
  })
})

describe('session messenger Host operator', () => {
  it('rejects a blank displayed source before any coordinator or session mutation', async () => {
    const source = fakeAgent('source')
    const target = fakeAgent('target', { events: [{ type: 'turn/start' }] })
    const h = fakeContext([source, target])
    const deliver = vi.fn()
    const replyToDelivery = vi.fn()
    const stopCollaboration = vi.fn()
    const operator = createSessionMessengerOperator(h.ctx as never, {
      deliver,
      replyToDelivery,
      stopCollaboration,
    })
    const before = {
      sourceEvents: source.session.events.length,
      targetEvents: target.session.events.length,
      sourceInbox: source.inbox.nextStep.length,
      targetInbox: target.inbox.nextStep.length,
    }

    await expect(operator.send({
      sourceSessionId: 'source',
      targetSessionId: 'target',
      message: 'must not deliver',
      wake: false,
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'source-blank' })
    expect(deliver).not.toHaveBeenCalled()
    expect(replyToDelivery).not.toHaveBeenCalled()
    expect({
      sourceEvents: source.session.events.length,
      targetEvents: target.session.events.length,
      sourceInbox: source.inbox.nextStep.length,
      targetInbox: target.inbox.nextStep.length,
    }).toEqual(before)
  })
})

describe('session messenger Host registration', () => {
  it('requires the WebServer alongside the already-reviewed core services', () => {
    expect(messengerInject).toEqual([
      'tools',
      'systemPrompt',
      'storageDomain',
      'workspaceRegistry',
      'typert',
      'agents',
      'sessionPersistence',
      'webServer',
    ])
  })

  it('injects a 256-bit escaped generation capability before shell code', () => {
    expect(createSessionMessengerCapability()).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const html = injectSessionMessengerCapability(
      '<html><head><script src="shell.js"></script></head></html>',
      'safe</script><script>unsafe()',
    )
    expect(html.indexOf('data-dsh-session-messenger-bootstrap')).toBeLessThan(html.indexOf('shell.js'))
    expect(html).toContain('safe\\u003c/script>\\u003cscript>unsafe()')
    expect(html).not.toContain('safe</script><script>unsafe()')
    expect(html).toContain(SNAPSHOT_PATH)
    expect(html).toContain(ACK_PATH)
    expect(html).toContain(EVENTS_PATH)
    expect(html).toContain(SEND_PATH)
    expect(html).toContain(REPLY_PATH)
  })

  it('reserves every HTTP and index seat before opening receipts and rolls partial registration back', async () => {
    vi.useFakeTimers()
    const cases = ['route', 'index'] as const
    try {
      for (const collision of cases) {
        const routes = new Map<string, WebRoute>()
        if (collision === 'route') {
          routes.set(ACK_PATH, { kind: 'exact', path: ACK_PATH, handler: () => undefined })
        }
        const taps: Array<(html: string) => string> = []
        const effects: Array<() => void | Promise<void>> = []
        const generationValues = new Map<string, unknown>()
        const open = vi.fn(async () => ({
          table: () => {
            const records = new Map<string, unknown>()
            return {
              get: (id: string) => records.get(id),
              entries: () => records.entries(),
              put: async (id: string, value: unknown) => { records.set(id, value) },
              delete: async (id: string) => records.delete(id),
            }
          },
          close: vi.fn(async () => undefined),
        }))
        const registerTool = vi.fn(() => vi.fn())
        const on = vi.fn(() => vi.fn())
        const ctx = {
          webServer: {
            port: PORT,
            generationValue<T>(key: string, initialize: () => T): T {
              if (generationValues.has(key)) return generationValues.get(key) as T
              const value = initialize()
              generationValues.set(key, value)
              return value
            },
            register(candidate: WebRoute) {
              if (routes.has(candidate.path)) throw new Error(`collision: ${candidate.path}`)
              routes.set(candidate.path, candidate)
              return () => { routes.delete(candidate.path) }
            },
            tapIndex(tap: (html: string) => string) {
              if (collision === 'index') throw new Error('index tap collision')
              taps.push(tap)
              return () => { taps.splice(taps.indexOf(tap), 1) }
            },
          },
          storageDomain: { open },
          tools: { register: registerTool },
          workspaceRegistry: { archivedSessionIds: [] },
          sessionPersistence: { inspect: vi.fn(), list: vi.fn(async () => []) },
          agents: { get: vi.fn(), isOwnedBy: vi.fn(() => false) },
          typert: { lookups: { get: vi.fn() } },
          logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
          on,
          effect(setup: () => unknown) {
            const result = setup()
            const admitted: Array<() => void | Promise<void>> = []
            try {
              if (typeof result === 'function') admitted.push(result as () => void | Promise<void>)
              else if (typeof (result as { [Symbol.iterator]?: unknown })?.[Symbol.iterator] === 'function') {
                for (const dispose of result as Iterable<() => void | Promise<void>>) admitted.push(dispose)
              }
            } catch (error: unknown) {
              for (const dispose of admitted.reverse()) void dispose()
              throw error
            }
            effects.push(...admitted)
          },
        }

        await expect(applyMessenger(ctx as never)).rejects.toThrow(/collision/)
        expect(open).not.toHaveBeenCalled()
        expect(registerTool).not.toHaveBeenCalled()
        expect(on).not.toHaveBeenCalled()
        expect([...routes.keys()]).toEqual(collision === 'route' ? [ACK_PATH] : [])
        expect(taps).toHaveLength(0)
        expect(vi.getTimerCount()).toBe(0)
        await Promise.allSettled(effects.reverse().map(dispose => Promise.resolve(dispose())))
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('registers exactly six routes plus one index tap and disposes only its own surfaces', async () => {
    const source = new FakeSource()
    const ctx = new Context()
    const routes: WebRoute[] = []
    const taps: Array<(html: string) => string> = []
    const generationValues = new Map<string, unknown>()
    const unrelated: WebRoute = { kind: 'exact', path: '/unrelated', handler: () => undefined }
    routes.push(unrelated)
    ctx.provide('webServer', {
      port: PORT,
      generationValue<T>(key: string, initialize: () => T): T {
        if (generationValues.has(key)) return generationValues.get(key) as T
        const value = initialize()
        generationValues.set(key, value)
        return value
      },
      register(candidate: WebRoute) {
        routes.push(candidate)
        return () => { routes.splice(routes.indexOf(candidate), 1) }
      },
      tapIndex(tap: (html: string) => string) {
        taps.push(tap)
        return () => { taps.splice(taps.indexOf(tap), 1) }
      },
    } as WebServer)

    const fiber = ctx.plugin({
      inject: ['webServer'],
      apply(httpCtx: Context) { installSessionMessengerHttp(httpCtx, source) },
    })
    await fiber.await()
    expect(routes.slice(1).map(candidate => candidate.path)).toEqual([
      SNAPSHOT_PATH,
      ACK_PATH,
      EVENTS_PATH,
      SEND_PATH,
      REPLY_PATH,
      STOP_PATH,
    ])
    expect(taps).toHaveLength(1)
    expect(source.listenerCount()).toBe(1)

    await fiber.dispose()
    expect(routes).toEqual([unrelated])
    expect(taps).toHaveLength(0)
    expect(source.listenerCount()).toBe(0)
  })

  it('keeps the page capability valid across Host disable and re-enable on the same WebServer', async () => {
    const ctx = new Context()
    const routes = new Map<string, WebRoute>()
    const taps: Array<(html: string) => string> = []
    const generationValues = new Map<string, unknown>()
    const webServer = {
      port: PORT,
      generationValue<T>(key: string, initialize: () => T): T {
        if (generationValues.has(key)) return generationValues.get(key) as T
        const value = initialize()
        generationValues.set(key, value)
        return value
      },
      register(candidate: WebRoute) {
        if (routes.has(candidate.path)) throw new Error(`duplicate ${candidate.path}`)
        routes.set(candidate.path, candidate)
        return () => { routes.delete(candidate.path) }
      },
      tapIndex(tap: (html: string) => string) {
        taps.push(tap)
        return () => { taps.splice(taps.indexOf(tap), 1) }
      },
    }
    ctx.provide('webServer', webServer as WebServer)
    const mount = async () => {
      const fiber = ctx.plugin({
        inject: ['webServer'],
        apply(httpCtx: Context) { installSessionMessengerHttp(httpCtx, new FakeSource()) },
      })
      await fiber.await()
      const html = taps[0]?.('<html><head></head></html>') ?? ''
      const capability = /"capability":"([A-Za-z0-9_-]+)"/u.exec(html)?.[1]
      if (capability === undefined) throw new Error('missing capability bootstrap')
      return { fiber, capability }
    }

    const first = await mount()
    await first.fiber.dispose()
    expect(routes.size).toBe(0)
    expect(taps).toHaveLength(0)

    const second = await mount()
    const headers = {
      host: AUTHORITY,
      origin: ORIGIN,
      [MESSENGER_CAPABILITY_HEADER]: first.capability,
    }
    const state = await invoke(routes.get(SNAPSHOT_PATH)!, headers)
    expect(second.capability).toBe(first.capability)
    expect(state.status).toBe(200)
    await second.fiber.dispose()
  })
})
