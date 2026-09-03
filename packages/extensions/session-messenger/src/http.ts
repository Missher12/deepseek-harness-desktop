/** Exact same-origin HTTP bridge for session-message notification metadata. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  CollaborationStopResult, DeliveryResult, SessionMessengerCoordinator,
} from './coordinator.ts'
import {
  MAX_EVENT_CLIENTS,
  SessionMessengerEventHub,
  type NotificationEvent,
  type ReceiptEventSource,
} from './events.ts'
import { MAX_ACK_BODY_BYTES, MAX_ACK_DELIVERY_IDS, MAX_OPERATOR_BODY_BYTES } from './protocol.ts'
import { MAX_MESSAGE_BYTES } from './spec.ts'
import { resolveOrdinaryOperatorSource } from './target-resolver.ts'
import { DeliveryId, MessengerError } from './types.ts'

export { MAX_ACK_BODY_BYTES, MAX_ACK_DELIVERY_IDS, MAX_OPERATOR_BODY_BYTES } from './protocol.ts'

/** Exact plugin route namespace. */
export const SNAPSHOT_PATH = '/plugins/dsh-session-messenger/snapshot'
/** Exact POST route for marking reply notifications as read. */
export const ACK_PATH = '/plugins/dsh-session-messenger/ack'
/** Exact POST route for bounded server-sent notification events. */
export const EVENTS_PATH = '/plugins/dsh-session-messenger/events'
/** Exact POST route for an operator-authored cross-session delivery. */
export const SEND_PATH = '/plugins/dsh-session-messenger/send'
/** Exact POST route for a receipt-bound operator reply. */
export const REPLY_PATH = '/plugins/dsh-session-messenger/reply'
/** Exact POST route for stopping one receipt-linked collaboration chain. */
export const STOP_PATH = '/plugins/dsh-session-messenger/stop'
/** Secret header injected into the same-origin browser generation. */
export const MESSENGER_CAPABILITY_HEADER = 'x-dsh-session-messenger-capability'
/** Inline bootstrap variable read by the Client half. */
export const MESSENGER_BOOTSTRAP_GLOBAL = '__DSH_SESSION_MESSENGER__'
/** One stream is intentionally short-lived so reconnect revalidates a fresh snapshot. */
export const EVENT_STREAM_LIFETIME_MS = 55_000
/** Keep intermediaries from treating an otherwise quiet bounded stream as dead. */
export const EVENT_HEARTBEAT_MS = 15_000

interface SessionMessengerHttpOptions {
  readonly port: number
  readonly capability: string
  readonly source: ReceiptEventSource
  readonly operator?: SessionMessengerOperator
}

/** Exact parsed browser request for a new delivery. */
export interface SessionMessengerSendBody {
  readonly sourceSessionId: string
  readonly targetSessionId: string
  readonly message: string
  readonly wake: boolean
}

/** Exact parsed browser request for a receipt-bound reply. */
export interface SessionMessengerReplyBody {
  readonly sourceSessionId: string
  readonly deliveryId: DeliveryId
  readonly message: string
  readonly wake: boolean
}

/** Exact parsed browser request for stopping a collaboration chain. */
export interface SessionMessengerStopBody {
  readonly sourceSessionId: string
  readonly deliveryId: DeliveryId
}

/** Host-owned mutation boundary exposed to the HTTP parser. */
export interface SessionMessengerOperator {
  send(body: SessionMessengerSendBody, signal: AbortSignal): Promise<DeliveryResult>
  reply(body: SessionMessengerReplyBody, signal: AbortSignal): Promise<DeliveryResult>
  stop(body: SessionMessengerStopBody): Promise<CollaborationStopResult>
}

/** Complete independently disposable Host notification surface. */
export interface SessionMessengerHttpSurface {
  readonly routes: readonly WebRoute[]
  readonly hub: SessionMessengerEventHub
  readonly injectIndex: (html: string) => string
  dispose(): void
}

/** Routes and bootstrap claimed before durable activation, then bound exactly once. */
export interface SessionMessengerHttpReservation {
  bind(source: ReceiptEventSource, coordinator?: SessionMessengerCoordinator): SessionMessengerHttpSurface
  dispose(): Promise<void>
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

/**
 * Produce one 256-bit URL/header-safe capability per plugin generation.
 * @returns a cryptographically random base64url capability.
 */
export function createSessionMessengerCapability(): string {
  return randomBytes(32).toString('base64url')
}

/* jscpd:ignore-start -- removable plugins intentionally own independent HTTP security fences. */
/** Read a singleton Node header without accepting ambiguous duplicates. */
function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Read one security-sensitive header only when the wire contains it exactly once. */
function exactWireHeader(req: IncomingMessage, name: string): string | undefined {
  const wanted = name.toLowerCase()
  let match: string | undefined
  let count = 0
  for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() !== wanted) continue
    count += 1
    match = req.rawHeaders[index + 1]
  }
  return count === 1 ? match : undefined
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
async function boundedBody(
  req: IncomingMessage,
  res: ServerResponse,
  maximum: number,
): Promise<Buffer | undefined> {
  const declared = header(req.headers, 'content-length')
  if (declared !== undefined && Number(declared) > maximum) {
    text(res, 413, 'payload too large', { connection: 'close' })
    req.destroy()
    return undefined
  }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string | Uint8Array)
    received += buffer.byteLength
    if (received > maximum) {
      text(res, 413, 'payload too large', { connection: 'close' })
      req.destroy()
      return undefined
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}
/* jscpd:ignore-end */

/** Validate JSON media type, body bound, and exact parser through one response path. */
async function parsedJsonBody<T>(
  req: IncomingMessage,
  res: ServerResponse,
  maximum: number,
  parse: (raw: Buffer) => T | undefined,
  invalidMessage: string,
): Promise<T | undefined> {
  const mediaType = header(req.headers, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    text(res, 415, 'content type must be application/json')
    return undefined
  }
  const raw = await boundedBody(req, res, maximum)
  if (raw === undefined) return undefined
  const body = parse(raw)
  if (body === undefined) text(res, 400, invalidMessage)
  return body
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

function safeMessage(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value) <= MAX_MESSAGE_BYTES
}

function parseSendBody(raw: Buffer): SessionMessengerSendBody | undefined {
  const value = parseJson(raw)
  if (!isExactRecord(value, ['sourceSessionId', 'targetSessionId', 'message', 'wake'])
    || !safeOpaqueId(value.sourceSessionId)
    || !safeOpaqueId(value.targetSessionId)
    || !safeMessage(value.message)
    || typeof value.wake !== 'boolean') return undefined
  return {
    sourceSessionId: value.sourceSessionId,
    targetSessionId: value.targetSessionId,
    message: value.message,
    wake: value.wake,
  }
}

function parseReplyBody(raw: Buffer): SessionMessengerReplyBody | undefined {
  const value = parseJson(raw)
  if (!isExactRecord(value, ['sourceSessionId', 'deliveryId', 'message', 'wake'])
    || !safeOpaqueId(value.sourceSessionId)
    || !safeOpaqueId(value.deliveryId)
    || !safeMessage(value.message)
    || typeof value.wake !== 'boolean') return undefined
  return {
    sourceSessionId: value.sourceSessionId,
    deliveryId: DeliveryId(value.deliveryId),
    message: value.message,
    wake: value.wake,
  }
}

function parseStopBody(raw: Buffer): SessionMessengerStopBody | undefined {
  const value = parseJson(raw)
  if (!isExactRecord(value, ['sourceSessionId', 'deliveryId'])
    || !safeOpaqueId(value.sourceSessionId)
    || !safeOpaqueId(value.deliveryId)) return undefined
  return { sourceSessionId: value.sourceSessionId, deliveryId: DeliveryId(value.deliveryId) }
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
    || record.deliveryIds.length > MAX_ACK_DELIVERY_IDS
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
 * @param options - bound port, generation capability, and receipt event source.
 * @returns independently disposable routes, event hub, and index transformer.
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
    exactWireHeader(req, 'host') === authority
    && exactWireHeader(req, 'origin') === origin
    && matchesCapability(
      exactWireHeader(req, MESSENGER_CAPABILITY_HEADER),
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
      const body = await parsedJsonBody(
        req,
        res,
        MAX_ACK_BODY_BYTES,
        parseAckBody,
        'invalid acknowledgement',
      )
      if (body === undefined) return
      json(res, 200, { acknowledged: hub.acknowledge(body.sessionId, body.deliveryIds) })
    },
  }

  const operatorRoute = <T extends SessionMessengerSendBody | SessionMessengerReplyBody | SessionMessengerStopBody>(
    path: string,
    parse: (raw: Buffer) => T | undefined,
    invoke: (operator: SessionMessengerOperator, body: T, signal: AbortSignal) => Promise<unknown>,
  ): WebRoute => ({
    kind: 'exact',
    path,
    async handler(req, res) {
      if (!preflight(req, res)) return
      const body = await parsedJsonBody(
        req,
        res,
        MAX_OPERATOR_BODY_BYTES,
        parse,
        'invalid operator request',
      )
      if (body === undefined) return
      if (options.operator === undefined) {
        text(res, 503, 'unavailable')
        return
      }
      const controller = new AbortController()
      const abort = (): void => { controller.abort() }
      req.once('aborted', abort)
      try {
        json(res, 200, await invoke(options.operator, body, controller.signal))
      } catch (error: unknown) {
        if (error instanceof MessengerError) json(res, 409, { errorCode: error.code })
        else text(res, 500, 'operator request failed')
      } finally {
        req.off('aborted', abort)
      }
    },
  })

  const send = operatorRoute(
    SEND_PATH,
    parseSendBody,
    (operator, body, signal) => operator.send(body, signal),
  )
  const reply = operatorRoute(
    REPLY_PATH,
    parseReplyBody,
    (operator, body, signal) => operator.reply(body, signal),
  )
  const stop = operatorRoute(
    STOP_PATH,
    parseStopBody,
    (operator, body) => operator.stop(body),
  )

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
      if (!hub.canReplayAfter(lastEventId)) {
        text(res, 409, 'event replay unavailable')
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
    routes: [snapshot, acknowledge, events, send, reply, stop],
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

/**
 * Inject escaped generation facts before the shell bundle executes.
 * @param html - index document served by the Host fallback.
 * @param capability - generation-bound secret sent only through request headers.
 * @returns the document containing one frozen messenger bootstrap script.
 */
export function injectSessionMessengerCapability(html: string, capability: string): string {
  const data = {
    snapshotPath: SNAPSHOT_PATH,
    ackPath: ACK_PATH,
    eventsPath: EVENTS_PATH,
    sendPath: SEND_PATH,
    replyPath: REPLY_PATH,
    stopPath: STOP_PATH,
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

/**
 * Register all six exact routes and the index tap under one Cordis fiber.
 * @param ctx - Cordis context providing the generation-bound WebServer service.
 * @returns a reservation that can be bound exactly once to a receipt source.
 */
export function reserveSessionMessengerHttp(ctx: Context): SessionMessengerHttpReservation {
  const capability = ctx.webServer.generationValue(
    'dsh-session-messenger.capability',
    createSessionMessengerCapability,
  )
  let surface: SessionMessengerHttpSurface | undefined
  let disposed = false
  const paths = [SNAPSHOT_PATH, ACK_PATH, EVENTS_PATH, SEND_PATH, REPLY_PATH, STOP_PATH] as const
  const proxies: WebRoute[] = paths.map((path, index) => ({
    kind: 'exact',
    path,
    handler(req, res) {
      const route = surface?.routes[index]
      if (route === undefined) {
        text(res, 503, 'unavailable')
        return
      }
      return route.handler(req, res)
    },
  }))
  const release = ctx.effect(function* () {
    // Yield first so reverse disposal unpublishes tap/routes before closing streams.
    yield () => {
      disposed = true
      surface?.dispose()
      surface = undefined
    }
    for (const route of proxies) yield ctx.webServer.register(route)
    yield ctx.webServer.tapIndex(html => injectSessionMessengerCapability(html, capability))
  }, 'session-messenger: reserved HTTP surface')

  return {
    bind(source, coordinator) {
      if (disposed) throw new Error('session messenger HTTP reservation is disposed')
      if (surface !== undefined) throw new Error('session messenger HTTP reservation is already bound')
      const next = createSessionMessengerHttpSurface({
        port: ctx.webServer.port,
        capability,
        source,
        ...(coordinator === undefined
          ? {}
          : { operator: createSessionMessengerOperator(ctx, coordinator) }),
      })
      surface = next
      return next
    },
    dispose: release,
  }
}

/**
 * Reserve the HTTP surface and optionally bind an already-created source.
 * @param ctx - Cordis context providing the generation-bound WebServer service.
 * @param source - optional coordinator projection to bind immediately.
 * @param coordinator - optional mutation authority paired with the receipt source.
 * @returns the owned HTTP reservation.
 */
export function installSessionMessengerHttp(
  ctx: Context,
  source?: ReceiptEventSource,
  coordinator?: SessionMessengerCoordinator,
): SessionMessengerHttpReservation {
  const reservation = reserveSessionMessengerHttp(ctx)
  if (source !== undefined) reservation.bind(source, coordinator)
  return reservation
}

/**
 * Bind browser inputs to an exact live source before entering coordinator mutation paths.
 * @param ctx - Cordis context used to resolve the exact live ordinary source.
 * @param coordinator - bounded delivery and receipt-reply mutation authority.
 * @returns an operator that resolves source identity before each coordinator call.
 */
export function createSessionMessengerOperator(
  ctx: Context,
  coordinator: Pick<SessionMessengerCoordinator, 'deliver' | 'replyToDelivery' | 'stopCollaboration'>,
): SessionMessengerOperator {
  return {
    async send(body, signal) {
      const source = resolveOrdinaryOperatorSource(ctx, body.sourceSessionId)
      return await coordinator.deliver(source, {
        targetSessionId: body.targetSessionId,
        message: body.message,
        mode: body.wake ? 'followup' : 'inject',
      }, signal)
    },
    async reply(body, signal) {
      const source = resolveOrdinaryOperatorSource(ctx, body.sourceSessionId)
      return await coordinator.replyToDelivery(source, {
        deliveryId: body.deliveryId,
        message: body.message,
        wake: body.wake,
      }, signal)
    },
    async stop(body) {
      const source = resolveOrdinaryOperatorSource(ctx, body.sourceSessionId)
      return await coordinator.stopCollaboration(source, body.deliveryId)
    },
  }
}
