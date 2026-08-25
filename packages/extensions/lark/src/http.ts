import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Exact loopback settings-control route. */
export const LARK_CONTROL_PATH = '/plugins/dsh-lark/control'
/** Per-process capability header accepted by the settings route. */
export const LARK_CONTROL_HEADER = 'x-dsh-lark-capability'
/** Browser bootstrap global carrying the route capability. */
export const LARK_BOOTSTRAP_GLOBAL = '__DSH_LARK__'
/** Maximum accepted settings action body size. */
export const MAX_CONTROL_BODY_BYTES = 64 * 1024

/** Lifecycle and status actions available only through the local capability. */
export interface LarkControlPort {
  status(): Promise<unknown>
  enable(): Promise<void>
  disable(): Promise<void>
  resume(): Promise<void>
  clear(): Promise<void>
  pair(code: string): Promise<void>
  repair(): Promise<void>
  cleanup(): Promise<number>
  test(): Promise<unknown>
  setCredentials(appId: string, appSecret: string): Promise<void>
}

/** Pure request facts used by the settings dispatcher. */
export interface LarkControlRequest {
  method: string
  host: string | undefined
  origin: string | undefined
  capability: string | undefined
  body: Uint8Array
}

/** Status and JSON body returned by the settings dispatcher. */
export interface LarkControlResponse {
  status: number
  body: unknown
}

/**
 * Generate one unguessable process-local settings capability.
 * @returns A URL-safe random capability.
 */
export const createLarkCapability = (): string => randomBytes(32).toString('base64url')

const capabilityMatches = (candidate: string | undefined, expected: string): boolean => {
  if (candidate === undefined) return false
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

const parseBody = (body: Uint8Array): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Dispatch one same-origin capability-authenticated settings action.
 * @param request - Normalized HTTP request facts.
 * @param port - Runtime lifecycle control surface.
 * @param capability - Exact process-local capability.
 * @param serverPort - Active loopback web-server port.
 * @returns A bounded JSON response.
 */
export async function dispatchLarkControl(
  request: LarkControlRequest,
  port: LarkControlPort,
  capability: string,
  serverPort: number,
): Promise<LarkControlResponse> {
  const authority = `127.0.0.1:${serverPort}`
  const origin = `http://${authority}`
  if (request.host !== authority || !capabilityMatches(request.capability, capability)
    || (request.origin !== undefined && request.origin !== origin)
    || (request.method === 'POST' && request.origin !== origin)) {
    return { status: 403, body: { error: 'forbidden' } }
  }
  if (request.body.byteLength > MAX_CONTROL_BODY_BYTES) return { status: 413, body: { error: 'payload-too-large' } }
  if (request.method === 'GET') return { status: 200, body: await port.status() }
  if (request.method !== 'POST') return { status: 405, body: { error: 'method-not-allowed' } }
  const body = parseBody(request.body)
  if (body === undefined || typeof body.action !== 'string') return { status: 400, body: { error: 'invalid-request' } }
  try {
    switch (body.action) {
      case 'enable': await port.enable(); break
      case 'disable': await port.disable(); break
      case 'resume': await port.resume(); break
      case 'cleanup': return { status: 200, body: { removed: await port.cleanup() } }
      case 'test': return { status: 200, body: await port.test() }
      case 'pair':
        if (typeof body.code !== 'string' || body.code.length > 32) return { status: 400, body: { error: 'invalid-code' } }
        await port.pair(body.code)
        break
      case 'clear':
        if (body.confirm !== true) return { status: 400, body: { error: 'confirmation-required' } }
        await port.clear()
        break
      case 'repair':
        if (body.confirm !== true) return { status: 400, body: { error: 'confirmation-required' } }
        await port.repair()
        break
      case 'set-credentials':
        if (typeof body.appId !== 'string' || body.appId.length === 0 || body.appId.length > 256
          || typeof body.appSecret !== 'string' || body.appSecret.length === 0 || body.appSecret.length > 4096) {
          return { status: 400, body: { error: 'invalid-credentials' } }
        }
        await port.setCredentials(body.appId, body.appSecret)
        break
      default: return { status: 400, body: { error: 'unknown-action' } }
    }
    return { status: 200, body: await port.status() }
  } catch {
    return { status: 409, body: { error: 'action-rejected' } }
  }
}

/**
 * Adapt the pure control dispatcher to the Harness web-server route.
 * @param port - Runtime lifecycle control surface.
 * @param capability - Exact process-local capability.
 * @param serverPort - Active loopback web-server port.
 * @returns A Harness web-route handler.
 */
export function createLarkControlHandler(
  port: LarkControlPort,
  capability: string,
  serverPort: number,
): WebRoute['handler'] {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      bytes += buffer.length
      if (bytes > MAX_CONTROL_BODY_BYTES) break
      chunks.push(buffer)
    }
    const header = (name: string): string | undefined => {
      const value = req.headers[name]
      return typeof value === 'string' ? value : undefined
    }
    const response = await dispatchLarkControl({
      method: req.method ?? '',
      host: header('host'),
      origin: header('origin'),
      capability: header(LARK_CONTROL_HEADER),
      body: bytes > MAX_CONTROL_BODY_BYTES ? new Uint8Array(bytes) : Buffer.concat(chunks),
    }, port, capability, serverPort)
    const encoded = JSON.stringify(response.body)
    res.writeHead(response.status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(Buffer.byteLength(encoded)),
    })
    res.end(encoded)
  }
}

/**
 * Inject the process-local capability into the served Harness shell.
 * @param html - Original Harness index document.
 * @param capability - Exact process-local capability.
 * @returns The index document with one escaped bootstrap script.
 */
export function injectLarkCapability(html: string, capability: string): string {
  const bootstrap = JSON.stringify({
    path: LARK_CONTROL_PATH,
    header: LARK_CONTROL_HEADER,
    capability,
  }).replaceAll('<', '\\u003c')
  return html.replace('</head>', `<script>window.${LARK_BOOTSTRAP_GLOBAL}=${bootstrap}</script></head>`)
}
