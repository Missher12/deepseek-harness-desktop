import {
  CONTROL_LEASE_CAPABILITIES,
  CONTROL_LEASE_SURFACE_KINDS,
  ControlLeaseId,
  PROTOCOL_LIMITS,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type {
  BridgeRequest,
  ControlLeaseAcquireRequest,
  ControlLeaseAcquireResult,
  ControlLeaseCapability,
  ControlLeaseQuotaSnapshot,
  ControlLeaseSurfaceKind,
  ControlLeaseTarget,
  DesktopControlErrorCode,
  SessionIdType,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  classifyAuthorityRequest,
  controlRequestRule,
  type AdapterPolicyFacts,
} from './policy.ts'

export const CONTROL_LEASE_IDLE_MS = 300_000
export const CONTROL_LEASE_HARD_MS = 1_200_000

export function effectiveHelperTimeoutMs(bridgeRemainingMs: number, hardRemainingMs: number): number {
  if (!Number.isSafeInteger(bridgeRemainingMs) || bridgeRemainingMs <= 0
    || !Number.isSafeInteger(hardRemainingMs) || hardRemainingMs <= 0) {
    fail('TIMEOUT', 'no positive helper deadline remains')
  }
  return Math.min(bridgeRemainingMs, hardRemainingMs, PROTOCOL_LIMITS.maxHelperTimeoutMs)
}

export class ControlAuthorityError extends Error {
  constructor(readonly code: DesktopControlErrorCode, message: string) {
    super(message)
    this.name = 'ControlAuthorityError'
  }
}

export interface MonotonicClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface LeaseAcquisitionFacts {
  readonly officialSessionId: SessionIdType
  readonly surfaceKind: ControlLeaseSurfaceKind
  readonly targets: readonly ControlLeaseTarget[]
  readonly capabilities: readonly ControlLeaseCapability[]
  readonly policyAllowed: boolean
}

export interface OperationAuthorityFacts {
  readonly officialSessionId: SessionIdType
  readonly surfaceKind: ControlLeaseSurfaceKind
  readonly targets: readonly ControlLeaseTarget[]
  readonly capabilities: readonly ControlLeaseCapability[]
  readonly policy: AdapterPolicyFacts
  readonly nativeGrantValidated: boolean
}

export interface ActiveControlLease extends ControlLeaseAcquireResult {
  readonly generation: number
  readonly agentId: string
  readonly issuedAt: number
  readonly lastActionAt: number
  readonly hardExpiresAt: number
  readonly remaining: ControlLeaseQuotaSnapshot
}

interface MutableControlLease {
  readonly leaseId: ActiveControlLease['leaseId']
  readonly leaseRevision: number
  readonly generation: number
  readonly sessionId: SessionIdType
  readonly agentId: string
  readonly surfaceKind: ControlLeaseSurfaceKind
  readonly targets: readonly ControlLeaseTarget[]
  readonly capabilities: ReadonlySet<ControlLeaseCapability>
  readonly issuedAt: number
  lastActionAt: number
  readonly hardExpiresAt: number
  remaining: ControlLeaseQuotaSnapshot
}

export interface ControlLeaseAuthorityOptions {
  readonly clock: MonotonicClock
  readonly mintLeaseId: () => string
  readonly initialRevision?: number
  readonly quotas?: ControlLeaseQuotaSnapshot
}

export const DEFAULT_CONTROL_LEASE_QUOTAS: ControlLeaseQuotaSnapshot = Object.freeze({
  operations: 256,
  snapshots: 64,
  pointerActions: 128,
  keyActions: 128,
  textBytes: 49_152,
})

const SURFACES: ReadonlySet<string> = new Set(CONTROL_LEASE_SURFACE_KINDS)
const CAPABILITIES: ReadonlySet<string> = new Set(CONTROL_LEASE_CAPABILITIES)

function fail(code: DesktopControlErrorCode, message: string): never {
  throw new ControlAuthorityError(code, message)
}

function freezeTargets(targets: readonly ControlLeaseTarget[]): readonly ControlLeaseTarget[] {
  return Object.freeze(targets.map(target => Object.freeze({
    appId: target.appId,
    windowIds: Object.freeze([...target.windowIds]),
  })))
}

function freezeQuotas(quotas: ControlLeaseQuotaSnapshot): ControlLeaseQuotaSnapshot {
  return Object.freeze({ ...quotas })
}

function plainRecord(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

function assertQuotas(value: ControlLeaseQuotaSnapshot): ControlLeaseQuotaSnapshot {
  for (const field of ['operations', 'snapshots', 'pointerActions', 'keyActions', 'textBytes'] as const) {
    const amount = value[field]
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > PROTOCOL_LIMITS.maxLeaseQuota) {
      fail('INTERNAL', `invalid Electron-authored ${field} quota`)
    }
  }
  return freezeQuotas(value)
}

function targetMap(
  targets: readonly ControlLeaseTarget[],
  surface: ControlLeaseSurfaceKind,
  label: string,
): ReadonlyMap<string, ReadonlySet<string>> {
  const source: readonly unknown[] = targets
  if (!Array.isArray(source)) fail('POLICY_DENIED', `${label} targets are invalid`)
  if (surface !== 'native-application') {
    if (source.length !== 0) fail('POLICY_DENIED', 'browser targets must be empty')
    return new Map()
  }
  if (source.length === 0 || source.length > PROTOCOL_LIMITS.maxGrantableApps) {
    fail('POLICY_DENIED', `${label} targets are invalid`)
  }
  const result = new Map<string, ReadonlySet<string>>()
  const allWindows = new Set<string>()
  for (const target of source) {
    if (!plainRecord(target)) fail('POLICY_DENIED', `${label} target set is invalid`)
    const appId = ownData(target, 'appId')
    const rawWindowIds = ownData(target, 'windowIds')
    if (typeof appId !== 'string' || appId.length === 0
      || result.has(appId) || !Array.isArray(rawWindowIds)
      || rawWindowIds.length === 0
      || rawWindowIds.length > PROTOCOL_LIMITS.maxGrantableWindowsPerApp) {
      fail('POLICY_DENIED', `${label} target set is invalid`)
    }
    const windows = new Set<string>()
    const windowIds: readonly unknown[] = rawWindowIds
    for (const windowId of windowIds) {
      if (typeof windowId !== 'string' || windowId.length === 0
        || windows.has(windowId) || allWindows.has(windowId)) {
        fail('POLICY_DENIED', `${label} target set is invalid`)
      }
      windows.add(windowId)
      allWindows.add(windowId)
    }
    result.set(appId, windows)
  }
  return result
}

function effectiveTargets(
  requested: readonly ControlLeaseTarget[],
  available: readonly ControlLeaseTarget[],
  surface: ControlLeaseSurfaceKind,
): readonly ControlLeaseTarget[] {
  const requestedMap = targetMap(requested, surface, 'requested')
  const availableMap = targetMap(available, surface, 'available')
  if (surface !== 'native-application') return Object.freeze([])
  const effective: ControlLeaseTarget[] = []
  for (const target of requested) {
    const allowed = availableMap.get(target.appId)
    if (allowed === undefined) continue
    const windowIds = target.windowIds.filter(windowId => allowed.has(windowId))
    if (windowIds.length > 0) effective.push({ appId: target.appId, windowIds })
  }
  if (effective.length === 0 || requestedMap.size === 0) {
    fail('POLICY_DENIED', 'no requested native target remains authorized')
  }
  return freezeTargets(effective)
}

function effectiveCapabilities(
  requested: readonly ControlLeaseCapability[],
  available: readonly ControlLeaseCapability[],
): readonly ControlLeaseCapability[] {
  if (!Array.isArray(requested) || !Array.isArray(available) || requested.length === 0) {
    fail('POLICY_DENIED', 'lease capabilities are invalid')
  }
  const requestedSet = new Set<ControlLeaseCapability>()
  const availableSet = new Set<ControlLeaseCapability>()
  for (const unknownItem of available as readonly unknown[]) {
    if (typeof unknownItem !== 'string' || !CAPABILITIES.has(unknownItem)) {
      fail('POLICY_DENIED', 'available capabilities are invalid')
    }
    const item = unknownItem as ControlLeaseCapability
    if (availableSet.has(item)) fail('POLICY_DENIED', 'available capabilities are invalid')
    availableSet.add(item)
  }
  const effective: ControlLeaseCapability[] = []
  for (const unknownItem of requested as readonly unknown[]) {
    if (typeof unknownItem !== 'string' || !CAPABILITIES.has(unknownItem)) {
      fail('POLICY_DENIED', 'requested capabilities are invalid')
    }
    const item = unknownItem as ControlLeaseCapability
    if (requestedSet.has(item)) fail('POLICY_DENIED', 'requested capabilities are invalid')
    requestedSet.add(item)
    if (availableSet.has(item)) effective.push(item)
  }
  if (effective.length === 0) fail('POLICY_DENIED', 'no requested capability remains authorized')
  return Object.freeze(effective)
}

function safeNow(clock: MonotonicClock): number {
  const now = clock.now()
  if (!Number.isSafeInteger(now) || now < 0) fail('INTERNAL', 'monotonic clock is invalid')
  return now
}

export class ControlLeaseAuthority {
  readonly #clock: MonotonicClock
  readonly #mintLeaseId: () => string
  readonly #quotas: ControlLeaseQuotaSnapshot
  #nextRevision: number | null
  #generation = 0
  #active: MutableControlLease | null = null
  #timer: unknown = null

  constructor(options: ControlLeaseAuthorityOptions) {
    this.#clock = options.clock
    this.#mintLeaseId = options.mintLeaseId
    this.#quotas = assertQuotas(options.quotas ?? DEFAULT_CONTROL_LEASE_QUOTAS)
    const initialRevision = options.initialRevision ?? 1
    if (!Number.isSafeInteger(initialRevision) || initialRevision < 1) {
      fail('INTERNAL', 'initial lease revision is invalid')
    }
    this.#nextRevision = initialRevision
  }

  acquire(
    request: ControlLeaseAcquireRequest,
    facts: LeaseAcquisitionFacts,
    agentId: string,
  ): ControlLeaseAcquireResult {
    this.#expireIfNeeded()
    if (this.#active !== null) fail('BUSY', 'another control lease is active')
    if (request.sessionId !== facts.officialSessionId) {
      fail('UNAUTHORIZED', 'request does not belong to the official session')
    }
    if (typeof facts.surfaceKind !== 'string' || !SURFACES.has(facts.surfaceKind)
      || request.surfaceKind !== facts.surfaceKind) {
      fail('POLICY_DENIED', 'surface is not currently authorized')
    }
    if (typeof facts.policyAllowed !== 'boolean' || !facts.policyAllowed) {
      fail('POLICY_DENIED', 'lease policy denied the request')
    }
    if (typeof agentId !== 'string') fail('INTERNAL', 'agent display metadata is invalid')
    if (this.#nextRevision === null) fail('INTERNAL', 'lease revision space is exhausted')
    const targets = effectiveTargets(request.targets, facts.targets, facts.surfaceKind)
    const capabilities = effectiveCapabilities(request.capabilities, facts.capabilities)
    let leaseId: ActiveControlLease['leaseId']
    try {
      leaseId = ControlLeaseId(this.#mintLeaseId())
    } catch {
      return fail('INTERNAL', 'Electron failed to mint a valid lease id')
    }
    const now = safeNow(this.#clock)
    if (now > Number.MAX_SAFE_INTEGER - CONTROL_LEASE_HARD_MS) {
      fail('INTERNAL', 'lease monotonic deadline would overflow')
    }
    const revision = this.#nextRevision
    this.#nextRevision = revision === Number.MAX_SAFE_INTEGER ? null : revision + 1
    this.#generation = this.#nextGeneration()
    this.#active = {
      leaseId,
      leaseRevision: revision,
      generation: this.#generation,
      sessionId: request.sessionId,
      agentId,
      surfaceKind: facts.surfaceKind,
      targets,
      capabilities: new Set(capabilities),
      issuedAt: now,
      lastActionAt: now,
      hardExpiresAt: now + CONTROL_LEASE_HARD_MS,
      remaining: freezeQuotas(this.#quotas),
    }
    this.#schedule(this.#active)
    return this.#descriptor(this.#active)
  }

  prepareDispatch(request: BridgeRequest, facts: OperationAuthorityFacts): void {
    if (request.sessionId !== facts.officialSessionId) {
      fail('UNAUTHORIZED', 'request does not belong to the official session')
    }
    const rule = controlRequestRule(request)
    if (!rule.leaseScoped) {
      if (classifyAuthorityRequest(request, facts.surfaceKind, facts.policy) !== 'ALLOW') {
        fail('POLICY_DENIED', 'control policy denied the request')
      }
      return
    }
    this.#expireIfNeeded()
    const active = this.#active
    if (active === null) fail('LEASE_EXPIRED', 'no active control lease')
    if (request.sessionId !== active.sessionId) {
      fail('UNAUTHORIZED', 'request does not own the active control lease')
    }
    const leaseFields = request as BridgeRequest & { readonly leaseId?: unknown; readonly leaseRevision?: unknown }
    if (leaseFields.leaseId !== active.leaseId) fail('LEASE_REVOKED', 'lease id is no longer active')
    if (leaseFields.leaseRevision !== active.leaseRevision) fail('LEASE_REVOKED', 'lease revision is no longer active')
    if (facts.surfaceKind !== active.surfaceKind) fail('POLICY_DENIED', 'lease surface changed')
    if (!active.capabilities.has(rule.capability)
      || !facts.capabilities.includes(rule.capability)) {
      fail('POLICY_DENIED', 'required capability is not authorized')
    }
    this.#revalidateTarget(request, facts, active)
    const policy = classifyAuthorityRequest(request, active.surfaceKind, facts.policy)
    if (policy === 'DENY' || (policy === 'APPROVAL_REQUIRED'
      && (typeof facts.nativeGrantValidated !== 'boolean' || !facts.nativeGrantValidated))) {
      fail('POLICY_DENIED', 'control policy denied the request')
    }
    const amount = rule.amount ?? 0
    if (active.remaining.operations < 1
      || (rule.quota !== undefined && active.remaining[rule.quota] < amount)) {
      fail('QUOTA_EXCEEDED', 'control lease quota is exhausted')
    }
    active.remaining = freezeQuotas({
      ...active.remaining,
      operations: active.remaining.operations - 1,
      ...(rule.quota === undefined ? {} : {
        [rule.quota]: active.remaining[rule.quota] - amount,
      }),
    })
    active.lastActionAt = safeNow(this.#clock)
    this.#schedule(active)
  }

  revoke(_reason: string): boolean {
    if (this.#active === null) return false
    this.#clearTimer()
    this.#active = null
    this.#generation = this.#nextGeneration()
    return true
  }

  revokeExact(
    sessionId: SessionIdType,
    leaseId: ActiveControlLease['leaseId'],
    leaseRevision: number,
    reason: string,
  ): boolean {
    const active = this.#active
    if (active === null
      || active.sessionId !== sessionId
      || active.leaseId !== leaseId
      || active.leaseRevision !== leaseRevision) return false
    return this.revoke(reason)
  }

  revokeSession(sessionId: SessionIdType, reason: string): boolean {
    if (this.#active?.sessionId !== sessionId) return false
    return this.revoke(reason)
  }

  activeSnapshot(): ActiveControlLease | null {
    this.#expireIfNeeded()
    return this.#active === null ? null : this.#snapshot(this.#active)
  }

  #descriptor(active: MutableControlLease): ControlLeaseAcquireResult {
    return Object.freeze({
      leaseId: active.leaseId,
      leaseRevision: active.leaseRevision,
      surfaceKind: active.surfaceKind,
      targets: freezeTargets(active.targets),
      capabilities: Object.freeze([...active.capabilities]),
      idleExpiresAfterMs: CONTROL_LEASE_IDLE_MS,
      hardExpiresAfterMs: CONTROL_LEASE_HARD_MS,
    })
  }

  #snapshot(active: MutableControlLease): ActiveControlLease {
    return Object.freeze({
      ...this.#descriptor(active),
      generation: active.generation,
      agentId: active.agentId,
      issuedAt: active.issuedAt,
      lastActionAt: active.lastActionAt,
      hardExpiresAt: active.hardExpiresAt,
      remaining: freezeQuotas(active.remaining),
    })
  }

  #nextGeneration(): number {
    if (this.#generation === Number.MAX_SAFE_INTEGER) {
      this.#clearTimer()
      this.#active = null
      fail('INTERNAL', 'lease timer generation space is exhausted')
    }
    return this.#generation + 1
  }

  #schedule(active: MutableControlLease): void {
    this.#clearTimer()
    const now = safeNow(this.#clock)
    const expiresAt = Math.min(active.lastActionAt + CONTROL_LEASE_IDLE_MS, active.hardExpiresAt)
    const generation = active.generation
    try {
      this.#timer = this.#clock.setTimeout(() => {
        if (this.#active?.generation !== generation) return
        this.#timer = null
        if (!this.#expireIfNeeded()) {
          this.#schedule(this.#active)
        }
      }, Math.max(0, expiresAt - now))
    } catch {
      if (this.#active?.generation === generation) this.revoke('timer-registration-failed')
      fail('INTERNAL', 'failed to arm the lease expiry timer')
    }
  }

  #clearTimer(): void {
    if (this.#timer === null) return
    this.#clock.clearTimeout(this.#timer)
    this.#timer = null
  }

  #expireIfNeeded(): boolean {
    const active = this.#active
    if (active === null) return false
    const now = safeNow(this.#clock)
    if (now - active.lastActionAt < CONTROL_LEASE_IDLE_MS
      && now - active.issuedAt < CONTROL_LEASE_HARD_MS) return false
    this.revoke('expired')
    return true
  }

  #revalidateTarget(
    request: BridgeRequest,
    facts: OperationAuthorityFacts,
    active: MutableControlLease,
  ): void {
    targetMap(facts.targets, active.surfaceKind, 'current')
    if (active.surfaceKind !== 'native-application') {
      if (facts.targets.length !== 0) fail('POLICY_DENIED', 'browser target facts are invalid')
      return
    }
    const targetRequest = request as BridgeRequest & { readonly appId?: unknown; readonly windowId?: unknown }
    if (typeof targetRequest.appId !== 'string' || typeof targetRequest.windowId !== 'string') {
      fail('POLICY_DENIED', 'native request has no current target')
    }
    const activeTarget = active.targets.find(target => target.appId === targetRequest.appId)
    const currentTarget = facts.targets.find(target => target.appId === targetRequest.appId)
    if (!activeTarget?.windowIds.includes(targetRequest.windowId)
      || !currentTarget?.windowIds.includes(targetRequest.windowId)) {
      fail('TARGET_CLOSED', 'native target is no longer authorized')
    }
  }
}
