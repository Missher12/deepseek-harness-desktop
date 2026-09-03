/**
 * Optional read-only DeepSeek account-balance bridge: one capability-gated
 * same-origin GET route serving a cached `/user/balance` read. Mounted only
 * when the `webServer` service exists (the Web/desktop composition); the CLI
 * and headless compositions skip the route and its index bootstrap entirely.
 *
 * @module @deepseek-ai/dsh-llm-deepseek/balance
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { DeepSeekConnectionOptions } from './adapter.ts'

/** Exact plugin route namespace. */
export const BALANCE_PATH = '/plugins/llm-deepseek/balance'
/** Secret header injected into the same-origin browser generation. */
export const BALANCE_CAPABILITY_HEADER = 'x-dsh-llm-deepseek-capability'
/** Inline bootstrap variable read by the Client half. */
export const BALANCE_BOOTSTRAP_GLOBAL = '__DSH_DEEPSEEK_BALANCE__'
/** Successful balance snapshot cache lifetime. */
export const BALANCE_TTL_MS = 60_000
/** Abort an outstanding provider balance read after this long. */
export const BALANCE_TIMEOUT_MS = 10_000

/** Provider-validated account balance, currency-scoped fields as finite numbers. */
export interface DeepSeekBalanceSnapshot {
  /** Epoch ms of the provider read (or of the failed attempt). */
  readonly fetchedAt: number
  /** Provider currency code (e.g. `CNY`), or null when unreadable. */
  readonly currency: string | null
  /** Total available balance, or null when unavailable. */
  readonly totalBalance: number | null
  /** Granted (promotional) balance, or null when unavailable. */
  readonly grantedBalance: number | null
  /** Topped-up (recharged) balance, or null when unavailable. */
  readonly toppedUpBalance: number | null
  /** Stable error description for a failed read, or null on success. */
  readonly error: string | null
}

/** The subset of the WebServer service face this bridge consumes. */
interface BalanceWebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
  tapIndex(transform: (html: string) => string): () => void
}

/** Connection and credential facts owned by the llm-deepseek apply scope. */
export interface DeepSeekBalanceFacts {
  options: () => DeepSeekConnectionOptions
  resolveApiKey: (connection: DeepSeekConnectionOptions) => Promise<string>
}

/** Read one bounded non-negative numeric field off a provider balance record. */
function moneyField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Resolve only the documented public DeepSeek balance endpoint. */
function officialBalanceEndpoint(baseURL: string): string | null {
  try {
    const url = new URL(baseURL)
    if (url.protocol !== 'https:' || url.hostname !== 'api.deepseek.com') return null
    return `${url.origin}/user/balance`
  } catch {
    return null
  }
}

/**
 * Validate the provider's `/user/balance` payload: one balance list entry is
 * enough; the CNY entry wins when several currencies are present.
 * @param value - parsed response body.
 * @param fetchedAt - wall-clock timestamp captured for this provider response.
 * @returns the validated snapshot, or a null-bodied snapshot with an error.
 */
export function parseDeepSeekBalance(value: unknown, fetchedAt: number): DeepSeekBalanceSnapshot {
  const invalid = (error: string): DeepSeekBalanceSnapshot => ({
    fetchedAt,
    currency: null,
    totalBalance: null,
    grantedBalance: null,
    toppedUpBalance: null,
    error,
  })
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('unexpected balance payload')
  }
  const record = value as Record<string, unknown>
  if (record.is_available !== true) return invalid('balance is not available')
  const infos = Array.isArray(record.balance_infos) ? record.balance_infos : []
  let cnyEntry: Record<string, unknown> | null = null
  let usdEntry: Record<string, unknown> | null = null
  for (const item of infos) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const candidate = item as Record<string, unknown>
    if (moneyField(candidate, 'total_balance') === null) continue
    if (candidate.currency === 'CNY') {
      cnyEntry = candidate
      break
    }
    if (candidate.currency === 'USD' && usdEntry === null) usdEntry = candidate
  }
  const entry = cnyEntry ?? usdEntry
  if (entry === null) return invalid('no balance entries')
  const totalBalance = moneyField(entry, 'total_balance')
  if (totalBalance === null) return invalid('invalid total balance')
  return {
    fetchedAt,
    currency: typeof entry.currency === 'string' && entry.currency !== '' ? entry.currency : null,
    totalBalance,
    grantedBalance: moneyField(entry, 'granted_balance'),
    toppedUpBalance: moneyField(entry, 'topped_up_balance'),
    error: null,
  }
}

/** Read the provider balance endpoint with the same credential as chat requests. */
async function fetchDeepSeekBalance(
  endpoint: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<DeepSeekBalanceSnapshot> {
  const fetchedAt = Date.now()
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
      signal,
    })
  } catch (error) {
    return {
      fetchedAt,
      currency: null,
      totalBalance: null,
      grantedBalance: null,
      toppedUpBalance: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  if (!response.ok) {
    return {
      fetchedAt,
      currency: null,
      totalBalance: null,
      grantedBalance: null,
      toppedUpBalance: null,
      error: `balance endpoint failed (${response.status})`,
    }
  }
  try {
    return parseDeepSeekBalance(await response.json(), fetchedAt)
  } catch (error) {
    return {
      fetchedAt,
      currency: null,
      totalBalance: null,
      grantedBalance: null,
      toppedUpBalance: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Constant-time capability check against one request's headers. */
function requestAuthorized(req: IncomingMessage, capability: string): boolean {
  const raw = req.headers[BALANCE_CAPABILITY_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value === '') return false
  const expected = createHash('sha256').update(capability).digest()
  const received = createHash('sha256').update(value).digest()
  return timingSafeEqual(expected, received)
}

/**
 * Inject frozen generation facts before the shell bundle executes.
 * @param html - index document served by the Host fallback.
 * @param capability - generation-bound secret sent only through request headers.
 * @returns the document containing one frozen balance bootstrap script.
 */
export function injectDeepSeekBalanceBootstrap(html: string, capability: string): string {
  const data = {
    path: BALANCE_PATH,
    capabilityHeader: BALANCE_CAPABILITY_HEADER,
    capability,
  }
  const serialized = JSON.stringify(data).replaceAll('<', '\\u003c')
  const script = `<script data-dsh-deepseek-balance-bootstrap>window.${BALANCE_BOOTSTRAP_GLOBAL} = Object.freeze(${serialized})</script>`
  const head = html.indexOf('<head>')
  return head === -1
    ? `${script}${html}`
    : `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`
}

/**
 * Register the balance route and index tap under the owning apply fiber when
 * the WebServer service exists. The returned disposer removes both; callers
 * own it through a context effect. Returns undefined outside Web compositions.
 * @param ctx - Cordis context carrying the optional WebServer service.
 * @param facts - connection and credential resolution owned by apply.
 * @returns the combined disposer, or undefined when no WebServer is present.
 */
export function installDeepSeekBalanceHttp(ctx: Context, facts: DeepSeekBalanceFacts): (() => void) | undefined {
  const webServer = ctx.get('webServer') as BalanceWebServerFace | undefined
  if (webServer === undefined) return undefined
  const capability = randomBytes(32).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
  let cached: DeepSeekBalanceSnapshot | null = null
  let inFlight: Promise<DeepSeekBalanceSnapshot> | null = null
  const snapshot = (): Promise<DeepSeekBalanceSnapshot> => {
    if (cached !== null && Date.now() - cached.fetchedAt < BALANCE_TTL_MS) return Promise.resolve(cached)
    if (inFlight !== null) return inFlight
    const read = async (): Promise<DeepSeekBalanceSnapshot> => {
      const fetchedAt = Date.now()
      try {
        const connection = facts.options()
        const endpoint = officialBalanceEndpoint(connection.baseURL)
        if (endpoint === null) {
          return {
            fetchedAt,
            currency: null,
            totalBalance: null,
            grantedBalance: null,
            toppedUpBalance: null,
            error: 'balance endpoint is available only for api.deepseek.com',
          }
        }
        const apiKey = await facts.resolveApiKey(connection)
        const controller = new AbortController()
        const timer = setTimeout(() => { controller.abort() }, BALANCE_TIMEOUT_MS)
        try {
          const value = await fetchDeepSeekBalance(endpoint, apiKey, controller.signal)
          if (value.error === null) cached = value
          return value
        } finally {
          clearTimeout(timer)
        }
      } catch (error) {
        return {
          fetchedAt,
          currency: null,
          totalBalance: null,
          grantedBalance: null,
          toppedUpBalance: null,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    inFlight = read()
    const clear = (): void => { inFlight = null }
    void inFlight.then(clear, clear)
    return inFlight
  }
  const disposeRoute = webServer.register({
    kind: 'exact',
    path: BALANCE_PATH,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      if (!requestAuthorized(req, capability)) {
        res.writeHead(403)
        res.end()
        return
      }
      const value = await snapshot()
      const body = JSON.stringify(value)
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  })
  const disposeTap = webServer.tapIndex(html => injectDeepSeekBalanceBootstrap(html, capability))
  return () => {
    disposeTap()
    disposeRoute()
  }
}
