/** Narrow loopback HTTP bridge for the reasoning-effort character preference. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  DEFAULT_REASONING_EFFORT_PREFERENCE,
  MAX_VISUAL_EFFORT_PREFERENCES,
  MAX_VISUAL_EFFORT_ROUTE_LENGTH,
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

/* jscpd:ignore-start -- removable plugins intentionally own independent HTTP security fences. */
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
/* jscpd:ignore-end */

type PreferencePatch =
  | { readonly chibiThumb: boolean }
  | { readonly visualEffort: { readonly route: string; readonly index: number } }

/** Accept only the exact plugin-owned JSON patch shapes. */
function parsePutBody(body: Buffer): PreferencePatch | undefined {
  let value: unknown
  try {
    value = JSON.parse(body.toString('utf8')) as unknown
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1) return undefined
  if (typeof record.chibiThumb === 'boolean') return { chibiThumb: record.chibiThumb }
  if (typeof record.visualEffort !== 'object'
    || record.visualEffort === null
    || Array.isArray(record.visualEffort)) return undefined
  const visualEffort = record.visualEffort as Record<string, unknown>
  if (Object.keys(visualEffort).length !== 2
    || typeof visualEffort.route !== 'string'
    || visualEffort.route.length === 0
    || visualEffort.route.length > MAX_VISUAL_EFFORT_ROUTE_LENGTH
    || !Number.isInteger(visualEffort.index)
    || Number(visualEffort.index) < 0
    || Number(visualEffort.index) > 5) return undefined
  try {
    const route = JSON.parse(visualEffort.route) as unknown
    if (!Array.isArray(route)
      || route.length !== 3
      || route.some(part => typeof part !== 'string' || part.length === 0)) return undefined
  } catch {
    return undefined
  }
  return {
    visualEffort: {
      route: visualEffort.route,
      index: Number(visualEffort.index),
    },
  }
}

/** Apply one narrow patch while retaining a bounded insertion-ordered route map. */
function applyPatch(currentValue: unknown, patch: PreferencePatch): ReasoningEffortPreference {
  const current = readPreference(currentValue)
  if ('chibiThumb' in patch) {
    return { chibiThumb: patch.chibiThumb, visualEfforts: { ...current.visualEfforts } }
  }
  const entries = Object.entries(current.visualEfforts)
  const alreadyStored = Object.hasOwn(current.visualEfforts, patch.visualEffort.route)
  if (!alreadyStored && entries.length >= MAX_VISUAL_EFFORT_PREFERENCES) entries.shift()
  const visualEfforts = Object.fromEntries([
    ...entries.filter(([route]) => route !== patch.visualEffort.route),
    [patch.visualEffort.route, patch.visualEffort.index],
  ])
  return { chibiThumb: current.chibiThumb, visualEfforts }
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
  let writeTail: Promise<void> = Promise.resolve()
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
      await writeTail
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
    const patch = parsePutBody(raw)
    if (patch === undefined) {
      text(res, 400, 'invalid preference')
      return
    }
    try {
      const write = writeTail.then(async () => {
        const preference = applyPatch(options.read(), patch)
        await options.write(preference)
        return preference
      })
      writeTail = write.then(() => undefined, () => undefined)
      const preference = await write
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
