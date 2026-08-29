export interface DesktopBrowserBounds { x: number; y: number; width: number; height: number }

/** Persistent signed-in partition retained exclusively by the human Workbench browser. */
export const WORKBENCH_BROWSER_PARTITION = 'persist:dsh-workbench-browser'

/** Non-persistent partition prefix reserved for session-owned Agent surfaces. */
export const AGENT_BROWSER_PARTITION_PREFIX = 'dsh-agent-browser-'

/** Fixed resource limits for the Desktop-owned Agent browser. */
export const BROWSER_AGENT_LIMITS = Object.freeze({
  rawNodes: 2_000,
  depth: 32,
  cdpCalls: 512,
  startupMs: 10_000,
  startupAttempts: 2,
  accessibilityAttempts: 3,
  accessibilityRetryMs: 500,
  cleanupMs: 2_000,
  wallMs: 10_000,
  actionableNodes: 300,
  semanticUtf8Bytes: 49_152,
  encodedJsonBytes: 65_536,
  pngBytes: 4_194_304,
  screenshotEdge: 2_048,
  screenshotPixels: 4_194_304,
  screenshotAttempts: 3,
  waitDurationMs: 10_000,
})

/** Structured local failure translated to the frozen Desktop-control error vocabulary by the provider. */
export class AgentBrowserError extends Error {
  /** Create a bounded Agent browser failure without page data. */
  constructor(
    readonly code: 'BUSY' | 'STALE_REF' | 'TARGET_CLOSED' | 'POLICY_DENIED'
      | 'QUOTA_EXCEEDED' | 'TIMEOUT' | 'CANCELLED' | 'INTERNAL',
    message: string,
  ) {
    super(message)
    this.name = 'AgentBrowserError'
  }
}

/** Opaque browser element identity bound to one adapter revision. */
export type AgentBrowserRef = `browser:${string}`

/** Closed key modifier roster supported by browser actions. */
export type AgentBrowserKeyModifier = 'Alt' | 'Control' | 'Meta' | 'Shift'

/** Closed action roster accepted by the semantic CDP adapter. */
export type AgentBrowserAction =
  | { readonly kind: 'navigate'; readonly url: string }
  | { readonly kind: 'click'; readonly ref: AgentBrowserRef }
  | { readonly kind: 'type'; readonly ref: AgentBrowserRef; readonly text: string }
  | { readonly kind: 'key'; readonly key: string; readonly modifiers: readonly AgentBrowserKeyModifier[] }
  | { readonly kind: 'select'; readonly ref: AgentBrowserRef; readonly value: string }
  | { readonly kind: 'scroll'; readonly ref?: AgentBrowserRef; readonly deltaX: number; readonly deltaY: number }
  | { readonly kind: 'wait'; readonly mode: 'duration'; readonly durationMs: number }
  | { readonly kind: 'wait'; readonly mode: 'navigation' | 'loading-idle'; readonly durationMs?: never }
  | { readonly kind: 'back' }
  | { readonly kind: 'forward' }
  | { readonly kind: 'reload' }

/** One bounded semantic reference exposed by an Agent browser snapshot. */
export interface AgentBrowserSemanticRef {
  readonly ref: AgentBrowserRef
  readonly role: string
  readonly name: string
}

/** Verified PNG metadata paired with detached image bytes. */
export interface AgentBrowserImageMetadata {
  readonly transferId: string
  readonly byteLength: number
  readonly sha256: string
  readonly width: number
  readonly height: number
}

/** Local provider result matching the frozen browser snapshot result fields. */
export interface AgentBrowserSnapshotResult {
  readonly surfaceId: string
  readonly url: string
  readonly title: string
  readonly snapshotRevision: number
  readonly semanticText: string
  readonly refs: readonly AgentBrowserSemanticRef[]
  readonly image?: AgentBrowserImageMetadata
}

/** Pair-preserving local snapshot envelope ready for protocol wrapping. */
export type AgentBrowserSnapshotEnvelope =
  | { readonly result: AgentBrowserSnapshotResult & { readonly image?: never }; readonly png?: never }
  | { readonly result: AgentBrowserSnapshotResult & { readonly image: AgentBrowserImageMetadata }; readonly png: Uint8Array }

const AGENT_BROWSER_REF = /^browser:[0-9a-f]{32}$/u
const KEY_MODIFIERS = new Set<AgentBrowserKeyModifier>(['Alt', 'Control', 'Meta', 'Shift'])
const utf8 = new TextEncoder()

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : undefined
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function browserRef(value: unknown): value is AgentBrowserRef {
  return typeof value === 'string' && AGENT_BROWSER_REF.test(value)
}

/** Convert a protocol string into the local semantic browser reference type. */
export function toAgentBrowserRef(value: string): AgentBrowserRef {
  if (!browserRef(value)) throw new AgentBrowserError('STALE_REF', 'browser reference is invalid')
  return value
}

function boundedString(value: unknown, bytes: number, allowEmpty = false): value is string {
  return typeof value === 'string' && (allowEmpty || value.length > 0) && utf8.encode(value).byteLength <= bytes
}

function delta(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000
}

/** Check an untrusted value against the closed Agent browser action roster. */
export function isAgentBrowserAction(value: unknown): value is AgentBrowserAction {
  const item = plainRecord(value)
  if (item === undefined || typeof item.kind !== 'string') return false
  switch (item.kind) {
    case 'navigate':
      return exactKeys(item, ['kind', 'url']) && typeof item.url === 'string'
        && normalizeAgentBrowserTarget(item.url) !== undefined
    case 'click':
      return exactKeys(item, ['kind', 'ref']) && browserRef(item.ref)
    case 'type':
      return exactKeys(item, ['kind', 'ref', 'text']) && browserRef(item.ref)
        && boundedString(item.text, 8_192, true)
    case 'key': {
      if (!exactKeys(item, ['kind', 'key', 'modifiers']) || !boundedString(item.key, 64)
        || !Array.isArray(item.modifiers) || item.modifiers.length > KEY_MODIFIERS.size) return false
      const modifiers = item.modifiers as unknown[]
      return modifiers.every(modifier => typeof modifier === 'string' && KEY_MODIFIERS.has(modifier as AgentBrowserKeyModifier))
        && new Set(modifiers).size === modifiers.length
    }
    case 'select':
      return exactKeys(item, ['kind', 'ref', 'value']) && browserRef(item.ref)
        && boundedString(item.value, 8_192, true)
    case 'scroll':
      return exactKeys(item, item.ref === undefined
        ? ['kind', 'deltaX', 'deltaY']
        : ['kind', 'ref', 'deltaX', 'deltaY'])
        && (item.ref === undefined || browserRef(item.ref)) && delta(item.deltaX) && delta(item.deltaY)
    case 'wait':
      if (item.mode === 'duration') {
        return exactKeys(item, ['kind', 'mode', 'durationMs'])
          && typeof item.durationMs === 'number' && Number.isSafeInteger(item.durationMs)
          && item.durationMs >= 0 && item.durationMs <= BROWSER_AGENT_LIMITS.waitDurationMs
      }
      return (item.mode === 'navigation' || item.mode === 'loading-idle') && exactKeys(item, ['kind', 'mode'])
    case 'back':
    case 'forward':
    case 'reload':
      return exactKeys(item, ['kind'])
    default:
      return false
  }
}

/** Normalize an Agent browser destination without applying network-address policy. */
export function normalizeAgentBrowserTarget(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(trimmed)
    ? trimmed
    : trimmed.includes('.') && !/\s/u.test(trimmed)
      ? `https://${trimmed}`
      : undefined
  if (candidate === undefined) return undefined
  try {
    const url = new URL(candidate)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === ''
      || url.username !== '' || url.password !== '') return undefined
    return url.href
  } catch {
    return undefined
  }
}

export type DesktopBrowserRequest =
  | { kind: 'navigate'; value: string }
  | { kind: 'back' | 'forward' | 'reload' | 'stop' }

export interface DesktopBrowserSnapshot {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
}

export function isDesktopBrowserBounds(value: unknown): value is DesktopBrowserBounds {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]))
    && (item.width as number) >= 1 && (item.height as number) >= 1
}

export function normalizeBrowserTarget(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(trimmed)
    ? trimmed
    : trimmed.includes('.') && !/\s/u.test(trimmed)
      ? `https://${trimmed}`
      : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch { return undefined }
}

export function isDesktopBrowserRequest(value: unknown): value is DesktopBrowserRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (item.kind === 'navigate') return typeof item.value === 'string' && normalizeBrowserTarget(item.value) !== undefined
  return item.kind === 'back' || item.kind === 'forward' || item.kind === 'reload' || item.kind === 'stop'
}

export function isDesktopBrowserSnapshot(value: unknown): value is DesktopBrowserSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.url === 'string' && typeof item.title === 'string' && typeof item.loading === 'boolean'
    && typeof item.canGoBack === 'boolean' && typeof item.canGoForward === 'boolean'
    && (item.error === null || typeof item.error === 'string')
}
