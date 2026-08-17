/** Exact same-origin HTTP bridge for session-message notification metadata. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  MAX_EVENT_CLIENTS,
  SessionMessengerEventHub,
  type NotificationEvent,
  type ReceiptEventSource,
} from './events.ts'
import { DeliveryId } from './types.ts'

/** Exact plugin route namespace. */
export const SNAPSHOT_PATH = '/plugins/dsh-session-messenger/snapshot'
export const ACK_PATH = '/plugins/dsh-session-messenger/ack'
export const EVENTS_PATH = '/plugins/dsh-session-messenger/events'
/** Secret header injected into the same-origin browser generation. */
export const MESSENGER_CAPABILITY_HEADER = 'x-dsh-session-messenger-capability'
/** Inline bootstrap variable read by the Client half. */
export const MESSENGER_BOOTSTRAP_GLOBAL = '__DSH_SESSION_MESSENGER__'
/** Maximum acknowledgement request bytes. */
export const MAX_ACK_BODY_BYTES = 4 * 1024
/** One stream is intentionally short-lived so reconnect revalidates a fresh snapshot. */
export const EVENT_STREAM_LIFETIME_MS = 55_000
/** Keep intermediaries from treating an otherwise quiet bounded stream as dead. */
export const EVENT_HEARTBEAT_MS = 15_000

interface SessionMessengerHttpOptions {
  readonly port: number
  readonly capability: string
  readonly source: ReceiptEventSource
}

/** Complete independently disposable Host notification surface. */
export interface SessionMessengerHttpSurface {
  readonly routes: readonly WebRoute[]
  readonly hub: SessionMessengerEventHub
  readonly injectIndex: (html: string) => string
  dispose(): void
}

interface AckBody {
  readonly sessionId: SessionId
  readonly deliveryIds: readonly DeliveryId[]
}

interface StreamConnection {
  readonly req: IncomingMessage
  readonly res: ServerResponse
  readonly unsubscribe: () => void
  readonly heartbeat: ReturnType<typeof setInterval>
  readonly lifetime: ReturnType<typeof setTimeout>
  readonly close: () => void
}

/** Produce one 256-bit URL/header-safe capability per plugin generation. */
export function createSessionMessengerCapability(): string {
  return randomBytes(32).toString('base64url')
}

/** Read a singleton Node header without accepting ambiguous duplicates. */
function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Constant-time secret comparison after an exact byte-length check. */
function matchesCapability(candidate: string | undefined, expected: string): boolean {
  if (candidate === undefined) return false
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

/** Write non-cacheable JSON without any CORS grant. */
function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}

/** Write terse non-cacheable text without leaking runtime details. */
function text(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(body)
}

/** Read the only body-bearing route with a hard byte limit. */
async function boundedAckBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Buffer | undefined> {
  const declared = header(req.headers, 'content-length')
  if (declared !== undefined && Number(declared) > MAX_ACK_BODY_BYTES) {
    text(res, 413, 'payload too large', { connection: 'close' })
    req.destroy()
    return undefined
  }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string | Uint8Array)
    received += buffer.byteLength
    if (received > MAX_ACK_BODY_BYTES) {
      text(res, 413, 'payload too large', { connection: 'close' })
      req.destroy()
      return undefined
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function safeOpaqueId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && Buffer.byteLength(value) <= 256
    && !/[\u0000-\u001F\u007F]/u.test(value)
}

/** Parse the exact acknowledgement wire shape and deduplicate ids. */
function parseAckBody(raw: Buffer): AckBody | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw.toString('utf8')) as unknown
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2
    || !safeOpaqueId(record.sessionId)
    || !Array.isArray(record.deliveryIds)
    || record.deliveryIds.length > 128
    || !record.deliveryIds.every(safeOpaqueId)) return undefined
  return {
    sessionId: record.sessionId as SessionId,
    deliveryIds: [...new Set(record.deliveryIds)].map(DeliveryId),
  }
}

function parseLastEventId(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return 0
  if (!/^\d{1,16}$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function sseFrame(event: NotificationEvent): string {
  return `id: ${String(event.id)}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * Construct exact POST routes plus their metadata journal. The caller owns
 * disposal, which terminates every bounded stream and source subscription.
 */
export function createSessionMessengerHttpSurface(
  options: SessionMessengerHttpOptions,
): SessionMessengerHttpSurface {
  const authority = `127.0.0.1:${String(options.port)}`
  const origin = `http://${authority}`
  const hub = new SessionMessengerEventHub(options.source)
  const connections = new Set<StreamConnection>()
  let disposed = false

  const trusted = (req: IncomingMessage): boolean =>
    header(req.headers, 'host') === authority
    && header(req.headers, 'origin') === origin
    && matchesCapability(
      header(req.headers, MESSENGER_CAPABILITY_HEADER),
      options.capability,
    )

  const preflight = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!trusted(req)) {
      text(res, 403, 'forbidden')
      return false
    }
    if (req.method !== 'POST') {
      text(res, 405, 'method not allowed', { allow: 'POST' })
      return false
    }
    if (disposed) {
      text(res, 503, 'unavailable')
      return false
    }
    return true
  }

  const snapshot: WebRoute = {
    kind: 'exact',
    path: SNAPSHOT_PATH,
    handler(req, res) {
      if (!preflight(req, res)) return
      json(res, 200, hub.snapshot())
    },
  }

  const acknowledge: WebRoute = {
    kind: 'exact',
    path: ACK_PATH,
    async handler(req, res) {
      if (!preflight(req, res)) return
      const mediaType = header(req.headers, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        text(res, 415, 'content type must be application/json')
        return
      }
      const raw = await boundedAckBody(req, res)
      if (raw === undefined) return
      const body = parseAckBody(raw)
      if (body === undefined) {
        text(res, 400, 'invalid acknowledgement')
        return
      }
      json(res, 200, { acknowledged: hub.acknowledge(body.sessionId, body.deliveryIds) })
    },
  }

  const events: WebRoute = {
    kind: 'exact',
    path: EVENTS_PATH,
    handler(req, res) {
      if (!preflight(req, res)) return
      const lastEventId = parseLastEventId(header(req.headers, 'last-event-id'))
      if (lastEventId === undefined) {
        text(res, 400, 'invalid event cursor')
        return
      }
      if (connections.size >= MAX_EVENT_CLIENTS) {
        text(res, 503, 'too many event streams')
        return
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.flushHeaders()
      res.write('retry: 1000\n\n')

      let closed = false
      const close = (): void => {
        if (closed) return
        closed = true
        req.off('aborted', close)
        res.off('close', close)
        connection.unsubscribe()
        clearInterval(connection.heartbeat)
        clearTimeout(connection.lifetime)
        connections.delete(connection)
        if (!res.writableEnded) res.end()
      }
      const unsubscribe = hub.subscribeAfter(lastEventId, (event) => {
        if (!closed && !res.writableEnded) res.write(sseFrame(event))
      })
      const heartbeat = setInterval(() => {
        if (!closed && !res.writableEnded) res.write(': keepalive\n\n')
      }, EVENT_HEARTBEAT_MS)
      heartbeat.unref()
      const lifetime = setTimeout(close, EVENT_STREAM_LIFETIME_MS)
      lifetime.unref()
      const connection: StreamConnection = { req, res, unsubscribe, heartbeat, lifetime, close }
      connections.add(connection)
      req.once('aborted', close)
      res.once('close', close)
    },
  }

  const injectIndex = (html: string): string =>
    injectSessionMessengerCapability(html, options.capability)

  return {
    routes: [snapshot, acknowledge, events],
    hub,
    injectIndex,
    dispose() {
      if (disposed) return
      disposed = true
      for (const connection of [...connections]) connection.close()
      hub.dispose()
    },
  }
}

/** Inject escaped generation facts before the shell bundle executes. */
export function injectSessionMessengerCapability(html: string, capability: string): string {
  const data = {
    snapshotPath: SNAPSHOT_PATH,
    ackPath: ACK_PATH,
    eventsPath: EVENTS_PATH,
    capabilityHeader: MESSENGER_CAPABILITY_HEADER,
    capability,
  }
  const serialized = JSON.stringify(data).replaceAll('<', '\\u003c')
  const script = `<script data-dsh-session-messenger-bootstrap>window.${MESSENGER_BOOTSTRAP_GLOBAL} = Object.freeze(${serialized})</script>`
  const head = html.indexOf('<head>')
  return head === -1
    ? `${script}${html}`
    : `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`
}

/** Register all three exact routes and the index tap under one Cordis fiber. */
export function installSessionMessengerHttp(ctx: Context, source: ReceiptEventSource): void {
  const surface = createSessionMessengerHttpSurface({
    port: ctx.webServer.port,
    capability: createSessionMessengerCapability(),
    source,
  })
  ctx.effect(() => () => { surface.dispose() }, 'session-messenger: notification journal')
  for (const route of surface.routes) {
    ctx.effect(
      () => ctx.webServer.register(route),
      `session-messenger: ${route.path}`,
    )
  }
  ctx.effect(
    () => ctx.webServer.tapIndex(surface.injectIndex),
    'session-messenger: browser capability bootstrap',
  )
}
