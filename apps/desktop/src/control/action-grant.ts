import { createHash, timingSafeEqual } from 'node:crypto'
import { PROTOCOL_LIMITS } from '@deepseek-ai/dsh-desktop-control-protocol'
import type {
  BridgeRequest,
  BrowserRef,
  ControlLeaseId,
  SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type {
  NativeApprovalCoordinator,
  NativeApprovalScope,
  NativeApprovalTicket,
} from './native-approval.ts'

export const ACTION_GRANT_LIFETIME_MS = 30_000

type PersistentBrowserMutationKind =
  | 'browser.navigate'
  | 'browser.click'
  | 'browser.type'
  | 'browser.key'
  | 'browser.select'
  | 'browser.scroll'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.reload'

export type PersistentBrowserMutationRequest = Extract<
  BridgeRequest,
  { readonly requestKind: PersistentBrowserMutationKind }
>

export interface BrowserActionGrantScope {
  readonly request: PersistentBrowserMutationRequest
  readonly surfaceId: string
  readonly navigationRevision: number
}

declare const ACTION_GRANT: unique symbol
export interface ActionGrant {
  readonly [ACTION_GRANT]: true
}

export interface MonotonicGrantClock {
  now(): number
}

interface CanonicalGrantScope {
  readonly sessionId: SessionId
  readonly leaseId: ControlLeaseId
  readonly leaseRevision: number
  readonly surfaceId: string
  readonly navigationRevision: number
  readonly digest: Buffer
  readonly ref: BrowserRef | undefined
}

interface GrantRecord extends CanonicalGrantScope {
  readonly issuedAt: number
}

const utf8 = new TextEncoder()
const BASE_FIELDS = Object.freeze([
  'protocolVersion', 'messageKind', 'requestKind', 'requestId',
  'sessionId', 'deadlineUnixMs', 'leaseId', 'leaseRevision',
] as const)

const ACTION_FIELDS = Object.freeze({
  'browser.navigate': Object.freeze(['url'] as const),
  'browser.click': Object.freeze(['ref'] as const),
  'browser.type': Object.freeze(['ref', 'text'] as const),
  'browser.key': Object.freeze(['key', 'modifiers'] as const),
  'browser.select': Object.freeze(['ref', 'value'] as const),
  'browser.scroll': Object.freeze(['ref', 'deltaX', 'deltaY'] as const),
  'browser.back': Object.freeze([] as const),
  'browser.forward': Object.freeze([] as const),
  'browser.reload': Object.freeze([] as const),
} as const)

const ACTION_KINDS: ReadonlySet<string> = new Set(Object.keys(ACTION_FIELDS))

function isPlainObject(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${key} must be an own data property`)
  }
  return descriptor.value
}

function optionalOwnData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor) return undefined
  if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`${key} must be an own data property`)
  return descriptor.value
}

function assertExactKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Reflect.ownKeys(value)
  const allowed = new Set([...required, ...optional])
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key))
    || required.some(key => !keys.includes(key))) {
    throw new TypeError('action grant scope has unexpected or missing fields')
  }
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string primitive`)
  return value
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer`)
  }
  return value
}

function finiteCoordinateDelta(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
    || value < -PROTOCOL_LIMITS.maxCoordinate || value > PROTOCOL_LIMITS.maxCoordinate) {
    throw new TypeError(`${label} must be a finite coordinate delta`)
  }
  return value
}

function finiteClockValue(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - ACTION_GRANT_LIFETIME_MS) {
    throw new TypeError('monotonic clock is outside the supported range')
  }
  return value
}

function hashPart(hash: ReturnType<typeof createHash>, label: string, value: string): void {
  const labelBytes = utf8.encode(label)
  const valueBytes = utf8.encode(value)
  if (labelBytes.byteLength > 0xffff_ffff || valueBytes.byteLength > 0xffff_ffff) {
    throw new TypeError('action field is too large to hash')
  }
  const labelLength = Buffer.allocUnsafe(4)
  labelLength.writeUInt32BE(labelBytes.byteLength)
  const valueLength = Buffer.allocUnsafe(4)
  valueLength.writeUInt32BE(valueBytes.byteLength)
  hash.update(labelLength).update(labelBytes).update(valueLength).update(valueBytes)
}

function canonicalModifiers(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError('modifiers must be an array')
  const source: readonly unknown[] = value
  const modifiers = source.map((modifier): string => {
    if (modifier !== 'Alt' && modifier !== 'Control' && modifier !== 'Meta' && modifier !== 'Shift') {
      throw new TypeError('modifier is not supported')
    }
    return modifier
  })
  return Object.freeze(modifiers)
}

function requestActionFields(
  request: object,
  kind: PersistentBrowserMutationKind,
): { readonly fields: readonly (readonly [string, string])[]; readonly ref?: BrowserRef } {
  switch (kind) {
    case 'browser.navigate':
      return { fields: [['url', stringValue(ownData(request, 'url'), 'url')]] }
    case 'browser.click': {
      const ref = stringValue(ownData(request, 'ref'), 'ref') as BrowserRef
      return { fields: [['ref', ref]], ref }
    }
    case 'browser.type': {
      const ref = stringValue(ownData(request, 'ref'), 'ref') as BrowserRef
      return { fields: [['ref', ref], ['text', stringValue(ownData(request, 'text'), 'text')]], ref }
    }
    case 'browser.key': {
      const modifiers = canonicalModifiers(ownData(request, 'modifiers'))
      return {
        fields: [
          ['key', stringValue(ownData(request, 'key'), 'key')],
          ['modifiers.length', String(modifiers.length)],
          ...modifiers.map((modifier, index) => [`modifiers.${index}`, modifier] as const),
        ],
      }
    }
    case 'browser.select': {
      const ref = stringValue(ownData(request, 'ref'), 'ref') as BrowserRef
      return {
        fields: [['ref', ref], ['value', stringValue(ownData(request, 'value'), 'value')]],
        ref,
      }
    }
    case 'browser.scroll': {
      const rawRef = optionalOwnData(request, 'ref')
      const ref = rawRef === undefined ? undefined : stringValue(rawRef, 'ref') as BrowserRef
      return {
        fields: [
          ['ref.present', ref === undefined ? '0' : '1'],
          ['ref', ref ?? ''],
          ['deltaX', String(finiteCoordinateDelta(ownData(request, 'deltaX'), 'deltaX'))],
          ['deltaY', String(finiteCoordinateDelta(ownData(request, 'deltaY'), 'deltaY'))],
        ],
        ...(ref === undefined ? {} : { ref }),
      }
    }
    case 'browser.back':
    case 'browser.forward':
    case 'browser.reload':
      return { fields: [] }
  }
}

function canonicalScope(input: BrowserActionGrantScope): CanonicalGrantScope {
  if (!isPlainObject(input)) throw new TypeError('action grant scope must be a plain object')
  assertExactKeys(input, ['request', 'surfaceId', 'navigationRevision'])
  const request = ownData(input, 'request')
  if (!isPlainObject(request)) throw new TypeError('action request must be a plain object')
  const rawKind = ownData(request, 'requestKind')
  if (typeof rawKind !== 'string' || !ACTION_KINDS.has(rawKind)) {
    throw new TypeError('request kind does not require an action grant')
  }
  const kind = rawKind as PersistentBrowserMutationKind
  const actionFields = ACTION_FIELDS[kind]
  assertExactKeys(
    request,
    [...BASE_FIELDS, ...actionFields.filter(field => !(kind === 'browser.scroll' && field === 'ref'))],
    kind === 'browser.scroll' ? ['ref'] : [],
  )

  if (ownData(request, 'protocolVersion') !== 1 || ownData(request, 'messageKind') !== 'request') {
    throw new TypeError('action request is not protocol version 1')
  }
  const requestId = stringValue(ownData(request, 'requestId'), 'requestId')
  const sessionId = stringValue(ownData(request, 'sessionId'), 'sessionId') as SessionId
  const deadlineUnixMs = safeInteger(ownData(request, 'deadlineUnixMs'), 'deadlineUnixMs', 1)
  const leaseId = stringValue(ownData(request, 'leaseId'), 'leaseId') as ControlLeaseId
  const leaseRevision = safeInteger(ownData(request, 'leaseRevision'), 'leaseRevision', 1)
  const surfaceId = stringValue(ownData(input, 'surfaceId'), 'surfaceId')
  const navigationRevision = safeInteger(ownData(input, 'navigationRevision'), 'navigationRevision', 1)
  const { fields, ref } = requestActionFields(request, kind)

  const hash = createHash('sha256')
  const canonicalFields: readonly (readonly [string, string])[] = [
    ['scope.version', '1'],
    ['surfaceId', surfaceId],
    ['navigationRevision', String(navigationRevision)],
    ['protocolVersion', '1'],
    ['messageKind', 'request'],
    ['requestKind', kind],
    ['requestId', requestId],
    ['sessionId', sessionId],
    ['deadlineUnixMs', String(deadlineUnixMs)],
    ['leaseId', leaseId],
    ['leaseRevision', String(leaseRevision)],
    ...fields,
  ]
  for (const [label, value] of canonicalFields) hashPart(hash, label, value)

  return {
    sessionId,
    leaseId,
    leaseRevision,
    surfaceId,
    navigationRevision,
    digest: hash.digest(),
    ref,
  }
}

export type BrowserActionApprovalBase = Omit<
  NativeApprovalScope,
  'purpose' | 'actionDigest'
>

export class ActionGrantAuthority {
  readonly #records = new Map<ActionGrant, GrantRecord>()

  constructor(
    private readonly clock: MonotonicGrantClock,
    private readonly approvals: NativeApprovalCoordinator,
  ) {}

  get size(): number {
    return this.#records.size
  }

  approvalScope(
    input: BrowserActionGrantScope,
    base: BrowserActionApprovalBase,
  ): NativeApprovalScope {
    const scope = canonicalScope(input)
    return Object.freeze({
      ...base,
      purpose: 'browser-action',
      actionDigest: scope.digest.toString('hex'),
    })
  }

  issueFromApproval(
    input: BrowserActionGrantScope,
    approvalScope: NativeApprovalScope,
    ticket: NativeApprovalTicket,
    revalidate: () => boolean,
  ): ActionGrant {
    if (!this.approvals.consumeBeforeDispatch(ticket, approvalScope, revalidate)) {
      throw new TypeError('an exact one-use native approval ticket is required')
    }
    const scope = canonicalScope(input)
    const approvedDigest = approvalScope.actionDigest
    if (approvalScope.purpose !== 'browser-action'
      || typeof approvedDigest !== 'string'
      || !/^[0-9a-f]{64}$/.test(approvedDigest)
      || !timingSafeEqual(scope.digest, Buffer.from(approvedDigest, 'hex'))) {
      throw new TypeError('the approved ticket does not match the exact action')
    }
    const issuedAt = finiteClockValue(this.clock.now())
    this.#purgeExpired(issuedAt)
    const grant = Object.freeze({}) as ActionGrant
    this.#records.set(grant, { ...scope, issuedAt })
    return grant
  }

  consumeBeforeDispatch(
    grant: ActionGrant,
    input: BrowserActionGrantScope,
    revalidate: () => boolean,
  ): boolean {
    const record = this.#records.get(grant)
    if (!record) return false
    this.#records.delete(grant)

    let candidate: CanonicalGrantScope
    let now: number
    try {
      candidate = canonicalScope(input)
      now = finiteClockValue(this.clock.now())
    } catch {
      return false
    }
    if (now < record.issuedAt || now - record.issuedAt >= ACTION_GRANT_LIFETIME_MS
      || !timingSafeEqual(record.digest, candidate.digest)) return false
    try {
      const current: unknown = revalidate()
      return current === true
    } catch {
      return false
    }
  }

  clearNavigation(sessionId: SessionId, surfaceId: string): number {
    return this.#deleteWhere(record => (
      record.sessionId === sessionId && record.surfaceId === surfaceId
    ))
  }

  clearReference(sessionId: SessionId, ref: BrowserRef): number {
    return this.#deleteWhere(record => record.sessionId === sessionId && record.ref === ref)
  }

  clearSession(sessionId: SessionId): number {
    return this.#deleteWhere(record => record.sessionId === sessionId)
  }

  revokeLease(sessionId: SessionId, leaseId: ControlLeaseId, leaseRevision: number): number {
    return this.#deleteWhere(record => (
      record.sessionId === sessionId
      && record.leaseId === leaseId
      && record.leaseRevision === leaseRevision
    ))
  }

  #purgeExpired(now: number): void {
    this.#deleteWhere(record => now < record.issuedAt
      || now - record.issuedAt >= ACTION_GRANT_LIFETIME_MS)
  }

  #deleteWhere(predicate: (record: GrantRecord) => boolean): number {
    let deleted = 0
    for (const [grant, record] of this.#records) {
      if (!predicate(record)) continue
      this.#records.delete(grant)
      deleted += 1
    }
    return deleted
  }
}
