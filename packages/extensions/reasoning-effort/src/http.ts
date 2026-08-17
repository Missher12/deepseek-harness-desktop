/** Narrow loopback HTTP bridge for the reasoning-effort character preference. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  DEFAULT_REASONING_EFFORT_PREFERENCE,
  readPreference,
  type ReasoningEffortPreference,
} from './preference.ts'

/** Exact plugin-owned route; no generic settings surface is exposed. */
export const PREFERENCE_PATH = '/plugins/dsh-reasoning-effort/preference'

/** Per-generation browser capability header. */
export const PREFERENCE_CAPABILITY_HEADER = 'x-dsh-reasoning-effort-capability'

/** Inline bootstrap variable read by this package's Client half. */
export const PREFERENCE_BOOTSTRAP_GLOBAL = '__DSH_REASONING_EFFORT__'

/** Maximum buffered PUT body. */
export const MAX_PREFERENCE_BODY_BYTES = 1024

/** HTTP handler dependencies kept explicit for request-fence testing. */
export interface PreferenceHttpOptions {
  /** Active OS-assigned WebServer port. */
  port: number
  /** Random secret scoped to this plugin activation. */
  capability: string
  /** Read the current profile-backed section. */
  read(): unknown
  /** Durably replace the complete section. */
  write(value: ReasoningEffortPreference): Promise<void>
}

/**
 * Produce a 256-bit, URL/header-safe capability for one plugin generation.
 * @returns A fresh base64url capability.
 */
export function createPreferenceCapability(): string {
  return randomBytes(32).toString('base64url')
}

/** Read a singleton Node header without accepting ambiguous duplicate values. */
function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Compare the random capability without a content-dependent prefix check. */
function matchesCapability(candidate: string | undefined, expected: string): boolean {
  if (candidate === undefined) return false
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

/** Write a non-cacheable JSON response without any CORS grant. */
function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}

/** Write a terse, non-cacheable text response without leaking host paths. */
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

/** Read a bounded request body, returning undefined after a 413 response. */
async function boundedBody(req: IncomingMessage, res: ServerResponse): Promise<Buffer | undefined> {
  const declared = header(req.headers, 'content-length')
  if (declared !== undefined && Number(declared) > MAX_PREFERENCE_BODY_BYTES) {
    text(res, 413, 'payload too large', { connection: 'close' })
    req.destroy()
    return undefined
  }

  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string | Uint8Array)
    received += buffer.byteLength
    if (received > MAX_PREFERENCE_BODY_BYTES) {
      text(res, 413, 'payload too large', { connection: 'close' })
      req.destroy()
      return undefined
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** Accept only the exact one-key JSON wire shape. */
function parsePutBody(body: Buffer): ReasoningEffortPreference | undefined {
  let value: unknown
  try {
    value = JSON.parse(body.toString('utf8')) as unknown
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || typeof record.chibiThumb !== 'boolean') return undefined
  return { chibiThumb: record.chibiThumb }
}

/**
 * Create the exact route handler. Host and capability bind every method; GET
 * rejects a supplied foreign Origin while allowing the markerless shape real
 * same-origin browser GETs emit. PUT additionally requires the exact Origin.
 * @param options - Active loopback authority, capability, and settings seams.
 * @returns The exact WebServer route handler.
 */
export function createPreferenceHttpHandler(options: PreferenceHttpOptions): WebRoute['handler'] {
  const authority = `127.0.0.1:${String(options.port)}`
  const origin = `http://${authority}`
  return async (req, res) => {
    if (header(req.headers, 'host') !== authority
      || !matchesCapability(header(req.headers, PREFERENCE_CAPABILITY_HEADER), options.capability)) {
      text(res, 403, 'forbidden')
      return
    }

    const requestOrigin = header(req.headers, 'origin')
    if (requestOrigin !== undefined && requestOrigin !== origin) {
      text(res, 403, 'forbidden')
      return
    }

    if (req.method === 'GET') {
      json(res, 200, readPreference(options.read()))
      return
    }

    if (req.method !== 'PUT') {
      text(res, 405, 'method not allowed', { allow: 'GET, PUT' })
      return
    }

    if (requestOrigin !== origin) {
      text(res, 403, 'forbidden')
      return
    }
    const mediaType = header(req.headers, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (mediaType !== 'application/json') {
      text(res, 415, 'content type must be application/json')
      return
    }
    const raw = await boundedBody(req, res)
    if (raw === undefined) return
    const preference = parsePutBody(raw)
    if (preference === undefined) {
      text(res, 400, 'invalid preference')
      return
    }
    try {
      await options.write(preference)
      json(res, 200, preference)
    } catch {
      // Settings persistence diagnostics stay in the Host logger; the browser
      // receives no document path or provider detail.
      json(res, 500, DEFAULT_REASONING_EFFORT_PREFERENCE)
    }
  }
}

/**
 * Inject the per-generation route facts before the shell bundle. `<` is JSON-
 * escaped so even a hostile test capability cannot terminate the script.
 * @param html - Complete index document served by the Host.
 * @param capability - Fresh capability for this plugin generation.
 * @returns The index document with one bootstrap script injected.
 */
export function injectPreferenceCapability(html: string, capability: string): string {
  const data = {
    preferencePath: PREFERENCE_PATH,
    capabilityHeader: PREFERENCE_CAPABILITY_HEADER,
    capability,
  }
  const serialized = JSON.stringify(data).replaceAll('<', '\\u003c')
  const script = `<script data-dsh-reasoning-effort-bootstrap>window.${PREFERENCE_BOOTSTRAP_GLOBAL} = Object.freeze(${serialized})</script>`
  const head = html.indexOf('<head>')
  return head === -1
    ? `${script}${html}`
    : `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`
}
