import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { AgentBrowserError, normalizeAgentBrowserTarget } from './contracts.ts'

/** DNS resolver used by the Agent URL policy. */
export type AgentBrowserLookup = (hostname: string, signal?: AbortSignal) => Promise<readonly string[]>

/** Explicit user-owned exception for one private destination and resolved address. */
export type AgentBrowserPrivateAllowlist = (url: URL, address: string) => boolean

/** Agent navigation policy dependencies. */
export interface AgentBrowserUrlPolicyOptions {
  readonly lookup?: AgentBrowserLookup
  readonly allowPrivateDestination?: AgentBrowserPrivateAllowlist
}

function ipv4Parts(address: string): readonly number[] | undefined {
  if (isIP(address) !== 4) return undefined
  const values = address.split('.').map(value => Number.parseInt(value, 10))
  return values.length === 4 ? values : undefined
}

function isPrivateIpv4(address: string): boolean {
  const parts = ipv4Parts(address)
  if (parts === undefined) return false
  const [first = -1, second = -1] = parts
  return first === 0 || first === 10 || first === 127
    || first === 100 && second >= 64 && second <= 127
    || first === 169 && second === 254
    || first === 172 && second >= 16 && second <= 31
    || first === 192 && second === 168
    || first >= 224
}

function normalizedIpHost(address: string): string {
  const lower = address.toLowerCase()
  return lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower
}

function ipv6Words(address: string): readonly number[] | undefined {
  let normalized = normalizedIpHost(address)
  if (isIP(normalized) !== 6) return undefined
  const dottedTail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/u)?.[1]
  if (dottedTail !== undefined) {
    const parts = ipv4Parts(dottedTail)
    if (parts === undefined) return undefined
    const [first = 0, second = 0, third = 0, fourth = 0] = parts
    normalized = `${normalized.slice(0, -dottedTail.length)}${((first << 8) | second).toString(16)}:${((third << 8) | fourth).toString(16)}`
  }
  const halves = normalized.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] === '' ? [] : halves[0]?.split(':') ?? []
  const right = halves.length === 1 || halves[1] === '' ? [] : halves[1]?.split(':') ?? []
  const zeroCount = 8 - left.length - right.length
  if (zeroCount < 0 || (halves.length === 1 && zeroCount !== 0)) return undefined
  const words = [...left, ...Array.from({ length: zeroCount }, () => '0'), ...right]
    .map(value => Number.parseInt(value, 16))
  return words.length === 8 && words.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffff)
    ? words
    : undefined
}

function isPrivateIpv6(address: string): boolean {
  const words = ipv6Words(address)
  if (words === undefined) return false
  const first = words[0] ?? 0
  if (words.every(value => value === 0)
    || words.slice(0, 7).every(value => value === 0) && words[7] === 1
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xffc0) === 0xfec0
    || (first & 0xff00) === 0xff00) return true
  const hasEmbeddedIpv4 = words.slice(0, 5).every(value => value === 0)
    && (words[5] === 0 || words[5] === 0xffff)
  if (!hasEmbeddedIpv4) return false
  const embedded = `${(words[6] ?? 0) >> 8}.${(words[6] ?? 0) & 0xff}.${(words[7] ?? 0) >> 8}.${(words[7] ?? 0) & 0xff}`
  return isPrivateIpv4(embedded)
}

function assertNavigationActive(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new AgentBrowserError('CANCELLED', 'browser navigation was cancelled')
}

function hasPreventDefault(value: unknown): value is { preventDefault(): void } {
  if (typeof value !== 'object' || value === null) return false
  const source = value as { readonly preventDefault?: unknown }
  return typeof source.preventDefault === 'function'
}

/** Return whether an IP address is loopback, link-local, private, unspecified, carrier-grade NAT, or multicast. */
export function isBlockedAgentBrowserAddress(address: string): boolean {
  return isPrivateIpv4(address) || isPrivateIpv6(address)
}

async function defaultLookup(hostname: string, signal?: AbortSignal): Promise<readonly string[]> {
  assertNavigationActive(signal)
  const answers = await dnsLookup(hostname, { all: true, order: 'verbatim' })
  assertNavigationActive(signal)
  return answers.map(answer => answer.address)
}

/** Redirect-safe URL authority that validates userinfo, literal IPs, and every DNS answer. */
export class AgentBrowserUrlPolicy {
  private readonly lookup: AgentBrowserLookup
  private readonly allowPrivateDestination: AgentBrowserPrivateAllowlist

  constructor(options: AgentBrowserUrlPolicyOptions = {}) {
    this.lookup = options.lookup ?? defaultLookup
    this.allowPrivateDestination = options.allowPrivateDestination ?? (() => false)
  }

  /** Authorize one initial or redirected destination and return its canonical URL. */
  async authorize(value: string, signal?: AbortSignal): Promise<string> {
    assertNavigationActive(signal)
    const normalized = normalizeAgentBrowserTarget(value)
    if (normalized === undefined) throw new AgentBrowserError('POLICY_DENIED', 'browser destination is not allowed')
    const url = new URL(normalized)
    const hostname = normalizedIpHost(url.hostname).replace(/\.$/u, '')
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      if (!this.allowPrivateDestination(url, hostname)) {
        throw new AgentBrowserError('POLICY_DENIED', 'browser destination is not allowed')
      }
      return normalized
    }
    const literalKind = isIP(hostname)
    if (literalKind !== 0) {
      if (isBlockedAgentBrowserAddress(hostname) && !this.allowPrivateDestination(url, hostname)) {
        throw new AgentBrowserError('POLICY_DENIED', 'browser destination is not allowed')
      }
      return normalized
    }
    let addresses: readonly string[]
    try {
      addresses = await this.lookup(hostname, signal)
    } catch {
      assertNavigationActive(signal)
      throw new AgentBrowserError('POLICY_DENIED', 'browser destination could not be verified')
    }
    if (addresses.length === 0) throw new AgentBrowserError('POLICY_DENIED', 'browser destination could not be verified')
    if (addresses.some(address => isIP(normalizedIpHost(address)) === 0
      || isBlockedAgentBrowserAddress(address) && !this.allowPrivateDestination(url, address))) {
      throw new AgentBrowserError('POLICY_DENIED', 'browser destination is not allowed')
    }
    return normalized
  }
}

/** Page-derived facts used only to remove sensitive targets from the semantic registry. */
export interface BrowserTargetPolicyInput {
  readonly role: string
  readonly name: string
  readonly editable: boolean
  readonly type?: string
  readonly autocomplete?: string
  readonly disabled?: boolean
  readonly readonly?: boolean
}

const SENSITIVE_CREDENTIAL_NAME = /(?:password|passcode|one[ -]?time|\botp\b|verification code|security code)/iu
const SENSITIVE_FINANCIAL_OR_FILE_NAME = /(?:credit|debit|card|cvv|cvc|payment|bank|routing|account number|file|upload|attachment)/iu
const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password', 'new-password', 'one-time-code', 'cc-name', 'cc-given-name',
  'cc-additional-name', 'cc-family-name', 'cc-number', 'cc-exp', 'cc-exp-month',
  'cc-exp-year', 'cc-csc', 'cc-type', 'transaction-currency', 'transaction-amount',
])
const SAFE_AUTOCOMPLETE = new Set([
  'off', 'name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name',
  'honorific-suffix', 'nickname', 'username', 'organization-title', 'organization',
  'street-address', 'address-line1', 'address-line2', 'address-line3', 'address-level4',
  'address-level3', 'address-level2', 'address-level1', 'country', 'country-name',
  'postal-code', 'email', 'tel', 'url', 'photo', 'language', 'bday', 'sex',
])
const SAFE_EDITABLE_TYPES = new Set([
  'text', 'search', 'email', 'tel', 'url', 'number', 'date', 'month', 'week', 'time', 'datetime-local',
])

/** Fail closed on known or uncertain sensitive browser targets. */
export function classifyBrowserTarget(input: BrowserTargetPolicyInput): 'ALLOW' | 'DENY' {
  if (input.disabled === true || input.readonly === true
    || SENSITIVE_CREDENTIAL_NAME.test(input.name) || SENSITIVE_FINANCIAL_OR_FILE_NAME.test(input.name)) return 'DENY'
  const type = input.type?.toLowerCase()
  if (type === 'password' || type === 'file') return 'DENY'
  const autocomplete = input.autocomplete?.toLowerCase().trim()
  const autocompleteTokens = autocomplete?.split(/\s+/u).filter(Boolean) ?? []
  if (autocompleteTokens.some(token => SENSITIVE_AUTOCOMPLETE.has(token))) return 'DENY'
  if (!input.editable) return 'ALLOW'
  if (type === undefined || !SAFE_EDITABLE_TYPES.has(type) || autocompleteTokens.length === 0) return 'DENY'
  return autocompleteTokens.every(token => SAFE_AUTOCOMPLETE.has(token)) ? 'ALLOW' : 'DENY'
}

type BrowserListener = (...args: unknown[]) => void

/** Minimal WebContents face needed to install generation-owned browser guards. */
export interface BrowserSecurityWebContents {
  on(event: string, listener: BrowserListener): unknown
  removeListener(event: string, listener: BrowserListener): unknown
  setWindowOpenHandler(handler: (details: { readonly url: string }) => { readonly action: 'deny' }): void
}

/** Minimal Electron Session face needed to deny downloads and every permission. */
export interface BrowserSecuritySession {
  on(event: string, listener: BrowserListener): unknown
  removeListener(event: string, listener: BrowserListener): unknown
  setPermissionCheckHandler(handler: ((...args: unknown[]) => boolean) | null): void
  setPermissionRequestHandler(
    handler: ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | null,
  ): void
}

/** Security handler installation parameters for one manager generation. */
export interface BrowserSecurityHandlerOptions {
  readonly contents: BrowserSecurityWebContents
  readonly session: BrowserSecuritySession
  readonly allowsNavigation: (url: string) => boolean
}

/** Idempotent disposer that removes only one owned handler generation. */
export interface BrowserSecurityHandlerRegistration { dispose(): void }

interface PermissionLayer {
  readonly check: (...args: unknown[]) => boolean
  readonly request: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void
}

const permissionLayers = new WeakMap<object, PermissionLayer[]>()

/** Install popup, download, navigation, and deny-all permission guards for one surface generation. */
export function installBrowserSecurityHandlers(
  options: BrowserSecurityHandlerOptions,
): BrowserSecurityHandlerRegistration {
  const denyWindowOpen = (): { readonly action: 'deny' } => ({ action: 'deny' })
  const denyDownload: BrowserListener = (event) => {
    if (hasPreventDefault(event)) event.preventDefault()
  }
  const guardNavigation: BrowserListener = (event, url) => {
    if (typeof url === 'string') {
      const normalized = normalizeAgentBrowserTarget(url)
      if (normalized !== undefined && options.allowsNavigation(normalized)) return
    }
    if (hasPreventDefault(event)) event.preventDefault()
  }
  const layer: PermissionLayer = {
    check: () => false,
    request: (_contents, _permission, callback) => { callback(false) },
  }
  const sessionKey: object = options.session
  const layers = permissionLayers.get(sessionKey) ?? []
  layers.push(layer)
  permissionLayers.set(sessionKey, layers)
  options.contents.setWindowOpenHandler(denyWindowOpen)
  options.contents.on('will-navigate', guardNavigation)
  options.contents.on('will-redirect', guardNavigation)
  options.session.on('will-download', denyDownload)
  options.session.setPermissionCheckHandler(layer.check)
  options.session.setPermissionRequestHandler(layer.request)
  let disposed = false
  return Object.freeze({
    dispose(): void {
      if (disposed) return
      disposed = true
      options.contents.removeListener('will-navigate', guardNavigation)
      options.contents.removeListener('will-redirect', guardNavigation)
      options.session.removeListener('will-download', denyDownload)
      const current = permissionLayers.get(sessionKey)
      if (current === undefined) return
      const wasTop = current.at(-1) === layer
      const index = current.indexOf(layer)
      if (index >= 0) current.splice(index, 1)
      if (!wasTop) return
      const previous = current.at(-1)
      options.session.setPermissionCheckHandler(previous?.check ?? null)
      options.session.setPermissionRequestHandler(previous?.request ?? null)
      if (current.length === 0) permissionLayers.delete(sessionKey)
    },
  })
}
