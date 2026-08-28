import { isIP } from 'node:net'
import { AgentBrowserError, normalizeAgentBrowserTarget } from './contracts.ts'

/** DNS resolver used by the Agent URL policy. */
export type AgentBrowserLookup = (hostname: string, signal?: AbortSignal) => Promise<readonly string[]>

/** Explicit user-owned exception for one private destination and resolved address. */
export type AgentBrowserPrivateAllowlist = (url: URL, address: string) => boolean

/** Agent navigation policy dependencies. */
export interface AgentBrowserUrlPolicyOptions {
  /** Chromium resolver for the exact Electron Session that owns the surface. */
  readonly lookup: AgentBrowserLookup
  readonly allowPrivateDestination?: AgentBrowserPrivateAllowlist
}

/** Canonical destination plus addresses that a pinned transport may connect to directly. */
export interface AgentBrowserResolvedNavigation {
  readonly url: string
  readonly hostname: string
  readonly addresses: readonly string[]
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

/** Redirect-safe URL authority that validates userinfo, literal IPs, and every DNS answer. */
export class AgentBrowserUrlPolicy {
  private readonly lookup: AgentBrowserLookup
  private readonly allowPrivateDestination: AgentBrowserPrivateAllowlist

  constructor(options: AgentBrowserUrlPolicyOptions) {
    this.lookup = options.lookup
    this.allowPrivateDestination = options.allowPrivateDestination ?? (() => false)
  }

  /** Authorize one initial or redirected destination and return its canonical URL. */
  async authorize(value: string, signal?: AbortSignal): Promise<string> {
    return (await this.resolve(value, signal)).url
  }

  /** Re-resolve one CONNECT destination immediately before a trusted transport pins its socket. */
  async resolveForConnect(value: string, signal?: AbortSignal): Promise<AgentBrowserResolvedNavigation> {
    return await this.resolve(value, signal, true)
  }

  private async resolve(
    value: string,
    signal?: AbortSignal,
    connectTime = false,
  ): Promise<AgentBrowserResolvedNavigation> {
    assertNavigationActive(signal)
    const normalized = normalizeAgentBrowserTarget(value)
    if (normalized === undefined) throw new AgentBrowserError('POLICY_DENIED', 'browser destination is not allowed')
    const url = new URL(normalized)
    const hostname = normalizedIpHost(url.hostname).replace(/\.$/u, '')
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      if (!this.allowPrivateDestination(url, hostname)) {
        throw new AgentBrowserError('POLICY_DENIED', 'browser destination is not allowed')
      }
      if (!connectTime) return Object.freeze({ url: normalized, hostname, addresses: Object.freeze([hostname]) })
    }
    const literalKind = isIP(hostname)
    if (literalKind !== 0) {
      if (isBlockedAgentBrowserAddress(hostname) && !this.allowPrivateDestination(url, hostname)) {
        throw new AgentBrowserError('POLICY_DENIED', 'browser destination is not allowed')
      }
      return Object.freeze({ url: normalized, hostname, addresses: Object.freeze([hostname]) })
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
    return Object.freeze({ url: normalized, hostname, addresses: Object.freeze([...addresses]) })
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
type BrowserPermissionCheckHandler = (...args: unknown[]) => boolean
type BrowserPermissionRequestHandler = (
  contents: unknown,
  permission: string,
  callback: (allowed: boolean) => void,
  ...details: unknown[]
) => void
type BrowserWindowOpenResponse = { readonly action: 'allow' | 'deny'; readonly [key: string]: unknown }
type BrowserWindowOpenHandler = (details: { readonly url: string }) => BrowserWindowOpenResponse

/** Minimal WebContents face needed to install generation-owned browser guards. */
export interface BrowserSecurityWebContents {
  on(event: string, listener: BrowserListener): unknown
  removeListener(event: string, listener: BrowserListener): unknown
  setWindowOpenHandler(handler: BrowserWindowOpenHandler): void
}

/** Minimal Electron Session face needed to deny downloads and every permission. */
export interface BrowserSecuritySession {
  on(event: string, listener: BrowserListener): unknown
  removeListener(event: string, listener: BrowserListener): unknown
  setPermissionCheckHandler(handler: BrowserPermissionCheckHandler | null): void
  setPermissionRequestHandler(handler: BrowserPermissionRequestHandler | null): void
}

/** Human behavior captured when main creates one long-lived handler owner. */
export interface BrowserSecurityHandlerOwnerOptions {
  readonly contents: BrowserSecurityWebContents
  readonly session: BrowserSecuritySession
  readonly baseWindowOpenHandler: BrowserWindowOpenHandler
  readonly basePermissionCheckHandler: BrowserPermissionCheckHandler
  readonly basePermissionRequestHandler: BrowserPermissionRequestHandler
}

/** Generation registration parameters; the owner keeps Electron's single-slot dispatchers stable. */
export interface BrowserSecurityGenerationOptions {
  readonly generation: number
  readonly allowsNavigation: (url: string) => boolean
}

/** Idempotent disposer that removes only one owned handler generation. */
export interface BrowserSecurityHandlerRegistration { dispose(): void }

/** Main-process multiplexer installed before human and Agent browser lifecycles share a session. */
export interface BrowserSecurityHandlerOwner {
  install(options: BrowserSecurityGenerationOptions): BrowserSecurityHandlerRegistration
}

interface BrowserSecurityLayer { readonly generation: number }

class BrowserSecurityHandlerOwnerImpl implements BrowserSecurityHandlerOwner {
  private readonly layers: BrowserSecurityLayer[] = []

  constructor(private readonly options: BrowserSecurityHandlerOwnerOptions) {
    options.contents.setWindowOpenHandler(details => this.layers.length > 0
      ? { action: 'deny' }
      : options.baseWindowOpenHandler(details))
    options.session.setPermissionCheckHandler((...args) => this.layers.length > 0
      ? false
      : options.basePermissionCheckHandler(...args))
    options.session.setPermissionRequestHandler((contents, permission, callback, ...details) => {
      if (this.layers.length > 0) callback(false)
      else options.basePermissionRequestHandler(contents, permission, callback, ...details)
    })
  }

  install(options: BrowserSecurityGenerationOptions): BrowserSecurityHandlerRegistration {
    if (!Number.isSafeInteger(options.generation) || options.generation < 1
      || this.layers.some(layer => layer.generation === options.generation)) {
      throw new AgentBrowserError('INTERNAL', 'browser security handler generation is invalid')
    }
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
    const layer: BrowserSecurityLayer = { generation: options.generation }
    this.layers.push(layer)
    this.options.contents.on('will-navigate', guardNavigation)
    this.options.contents.on('will-redirect', guardNavigation)
    this.options.session.on('will-download', denyDownload)
    let disposed = false
    return Object.freeze({
      dispose: (): void => {
        if (disposed) return
        this.options.contents.removeListener('will-navigate', guardNavigation)
        this.options.contents.removeListener('will-redirect', guardNavigation)
        this.options.session.removeListener('will-download', denyDownload)
        const index = this.layers.indexOf(layer)
        if (index >= 0) this.layers.splice(index, 1)
        disposed = true
      },
    })
  }
}

/** Install stable single-slot dispatchers once and retain the supplied human behavior as the base layer. */
export function createBrowserSecurityHandlerOwner(
  options: BrowserSecurityHandlerOwnerOptions,
): BrowserSecurityHandlerOwner {
  return new BrowserSecurityHandlerOwnerImpl(options)
}

/** Security handler installation parameters for one manager generation. */
export interface BrowserSecurityHandlerOptions extends BrowserSecurityGenerationOptions {
  readonly owner: BrowserSecurityHandlerOwner
}

/** Install popup, download, navigation, and deny-all permission guards for one surface generation. */
export function installBrowserSecurityHandlers(
  options: BrowserSecurityHandlerOptions,
): BrowserSecurityHandlerRegistration {
  return options.owner.install(options)
}
