import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  ACK_PATH,
  EVENTS_PATH,
  MAX_ACK_BODY_BYTES,
  MESSENGER_CAPABILITY_HEADER,
  SNAPSHOT_PATH,
  createSessionMessengerCapability,
  createSessionMessengerHttpSurface,
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
import { inject as messengerInject } from '../src/index.ts'

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
): IncomingMessage {
  const req = Readable.from(body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)]) as unknown as IncomingMessage
  Object.assign(req, { url: path, method, headers })
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
    const paths = [SNAPSHOT_PATH, ACK_PATH, EVENTS_PATH]
    for (const path of paths) {
      const candidate = route(surface, path)
      const body = path === ACK_PATH ? JSON.stringify({ sessionId: 'target-session', deliveryIds: [] }) : undefined
      for (const headers of [
        { ...validHeaders(path === ACK_PATH), host: 'localhost:50288' },
        { ...validHeaders(path === ACK_PATH), host: '127.0.0.1:50289' },
        { ...validHeaders(path === ACK_PATH), origin: 'http://localhost:50288' },
        Object.fromEntries(Object.entries(validHeaders(path === ACK_PATH)).filter(([key]) => key !== 'origin')),
        { ...validHeaders(path === ACK_PATH), [MESSENGER_CAPABILITY_HEADER]: 'wrong' },
        Object.fromEntries(Object.entries(validHeaders(path === ACK_PATH))
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

describe('session messenger Host registration', () => {
  it('requires the WebServer alongside the already-reviewed core services', () => {
    expect(messengerInject).toEqual([
      'tools',
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
  })

  it('registers exactly three routes plus one index tap and disposes only its own surfaces', async () => {
    const source = new FakeSource()
    const ctx = new Context()
    const routes: WebRoute[] = []
    const taps: Array<(html: string) => string> = []
    const unrelated: WebRoute = { kind: 'exact', path: '/unrelated', handler: () => undefined }
    routes.push(unrelated)
    ctx.provide('webServer', {
      port: PORT,
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
    ])
    expect(taps).toHaveLength(1)
    expect(source.listenerCount()).toBe(1)

    await fiber.dispose()
    expect(routes).toEqual([unrelated])
    expect(taps).toHaveLength(0)
    expect(source.listenerCount()).toBe(0)
  })
})
