import {
  ControlLeaseId as parseControlLeaseId,
  PROTOCOL_LIMITS,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type {
  ControlLeaseCapability,
  ControlLeaseId,
  ControlLeaseSurfaceKind,
  ControlLeaseTarget,
  SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'
export interface NativeApprovalOwnerWindow {
  isVisible(): boolean
  isDestroyed(): boolean
  on(event: 'hide' | 'closed', listener: () => void): void
  removeListener(event: 'hide' | 'closed', listener: () => void): void
}

export interface NativeApprovalDialogOptions {
  readonly type: 'warning'
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly buttons: readonly ['Cancel', 'Allow']
  readonly cancelId: 0
  readonly defaultId: 0
  readonly noLink: true
}

export interface NativeApprovalDialog {
  showMessageBox(
    window: NativeApprovalOwnerWindow,
    options: NativeApprovalDialogOptions,
  ): Promise<{ readonly response: number }>
}

export interface NativeApprovalScope {
  readonly purpose: 'lease' | 'browser-action'
  readonly sessionId: SessionId
  readonly leaseId: ControlLeaseId
  readonly leaseRevision: number
  readonly surfaceKind: ControlLeaseSurfaceKind
  readonly targets: readonly ControlLeaseTarget[]
  readonly capabilities: readonly ControlLeaseCapability[]
  readonly allowlistRevision: number
  /** Main-process-only exact persistent-browser action fingerprint. */
  readonly actionDigest?: string
}

declare const NATIVE_APPROVAL_TICKET: unique symbol
/** Opaque Electron-main authority; object identity is the only credential. */
export interface NativeApprovalTicket {
  readonly [NATIVE_APPROVAL_TICKET]: true
}

export type NativeApprovalResult = NativeApprovalTicket | 'DENIED' | 'BUSY'

export const NATIVE_APPROVAL_TICKET_LIFETIME_MS = 30_000

export interface NativeApprovalDependencies {
  readonly dialog: NativeApprovalDialog
  readonly getOwnerWindow: () => NativeApprovalOwnerWindow | undefined
  readonly revalidate: (scope: NativeApprovalScope) => boolean | Promise<boolean>
  readonly now?: () => number
}

interface PendingApproval {
  readonly scope: NativeApprovalScope
  readonly promise: Promise<NativeApprovalResult>
  readonly ownerWindow: NativeApprovalOwnerWindow
  readonly settle: (result: NativeApprovalResult) => void
  readonly invalidate: () => void
  readonly abortCleanups: Array<() => void>
  invalidated: boolean
}

interface ApprovalTicketRecord {
  readonly key: string
  readonly issuedAt: number
}

let processPendingApproval: PendingApproval | undefined

const utf8 = new TextEncoder()
const PURPOSES: ReadonlySet<string> = new Set(['lease', 'browser-action'])
const SURFACES: ReadonlySet<string> = new Set([
  'browser-ephemeral', 'browser-human-persistent', 'native-application',
])
const CAPABILITIES: ReadonlySet<string> = new Set(['observe', 'pointer', 'keyboard'])
const APPROVAL_BUTTONS: readonly ['Cancel', 'Allow'] = Object.freeze(['Cancel', 'Allow'])

function isPlainObject(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertExactKeys(value: object, expected: readonly string[], label: string): void {
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string')
    || keys.length !== expected.length
    || expected.some(key => !keys.includes(key))) {
    throw new TypeError(`${label} has unexpected fields`)
  }
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${key} must be an own data property`)
  }
  return descriptor.value
}

function boundedString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || utf8.encode(value).byteLength > 4_096) {
    throw new TypeError(`${label} must be a bounded string primitive`)
  }
  return value
}

function positiveRevision(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

function canonicalTargets(
  value: unknown,
  surfaceKind: ControlLeaseSurfaceKind,
): readonly ControlLeaseTarget[] {
  if (!Array.isArray(value) || value.length > PROTOCOL_LIMITS.maxGrantableApps) {
    throw new TypeError('targets must be a bounded array')
  }
  if (surfaceKind === 'native-application' ? value.length === 0 : value.length !== 0) {
    throw new TypeError('targets do not match the approval surface')
  }
  const appIds = new Set<string>()
  const allWindowIds = new Set<string>()
  const targets = value.map((candidate, targetIndex) => {
    if (!isPlainObject(candidate)) throw new TypeError('target must be a plain object')
    assertExactKeys(candidate, ['appId', 'windowIds'], 'target')
    const appId = boundedString(ownData(candidate, 'appId'), `targets[${targetIndex}].appId`)
    if (appIds.has(appId)) throw new TypeError('targets must not repeat an application')
    appIds.add(appId)
    const rawWindowIds = ownData(candidate, 'windowIds')
    if (!Array.isArray(rawWindowIds) || rawWindowIds.length === 0
      || rawWindowIds.length > PROTOCOL_LIMITS.maxGrantableWindowsPerApp) {
      throw new TypeError('windowIds must be a non-empty bounded array')
    }
    const seen = new Set<string>()
    const windowIds = rawWindowIds.map((windowId, windowIndex) => {
      const checked = boundedString(windowId, `targets[${targetIndex}].windowIds[${windowIndex}]`)
      if (seen.has(checked) || allWindowIds.has(checked)) {
        throw new TypeError('windowIds must not contain duplicates')
      }
      seen.add(checked)
      allWindowIds.add(checked)
      return checked
    })
    return Object.freeze({ appId, windowIds: Object.freeze(windowIds) })
  })
  return Object.freeze(targets)
}

function canonicalCapabilities(value: unknown): readonly ControlLeaseCapability[] {
  if (!Array.isArray(value) || value.length === 0
    || value.length > PROTOCOL_LIMITS.maxLeaseCapabilities) {
    throw new TypeError('capabilities must be a non-empty bounded array')
  }
  const seen = new Set<string>()
  const capabilities = value.map((candidate) => {
    if (typeof candidate !== 'string' || !CAPABILITIES.has(candidate) || seen.has(candidate)) {
      throw new TypeError('capabilities must be unique closed values')
    }
    seen.add(candidate)
    return candidate as ControlLeaseCapability
  })
  return Object.freeze(capabilities)
}

function canonicalScope(input: NativeApprovalScope): NativeApprovalScope {
  if (!isPlainObject(input)) throw new TypeError('approval scope must be a plain object')
  const purpose = ownData(input, 'purpose')
  if (typeof purpose !== 'string' || !PURPOSES.has(purpose)) {
    throw new TypeError('purpose is not supported')
  }
  assertExactKeys(input, [
    'purpose', 'sessionId', 'leaseId', 'leaseRevision', 'surfaceKind',
    'targets', 'capabilities', 'allowlistRevision',
    ...(purpose === 'browser-action' ? ['actionDigest'] : []),
  ], 'approval scope')
  const surfaceKind = ownData(input, 'surfaceKind')
  if (typeof surfaceKind !== 'string' || !SURFACES.has(surfaceKind)) {
    throw new TypeError('surfaceKind is not supported')
  }
  const sessionId = boundedString(ownData(input, 'sessionId'), 'sessionId') as SessionId
  const leaseId = parseControlLeaseId(boundedString(ownData(input, 'leaseId'), 'leaseId'))
  const leaseRevision = positiveRevision(ownData(input, 'leaseRevision'), 'leaseRevision')
  const allowlistRevision = positiveRevision(ownData(input, 'allowlistRevision'), 'allowlistRevision')
  const typedSurfaceKind = surfaceKind as ControlLeaseSurfaceKind
  if (purpose === 'browser-action' && typedSurfaceKind !== 'browser-human-persistent') {
    throw new TypeError('browser action approval requires the persistent human surface')
  }
  const targets = canonicalTargets(ownData(input, 'targets'), typedSurfaceKind)
  const capabilities = canonicalCapabilities(ownData(input, 'capabilities'))
  const actionDigest = purpose === 'browser-action' ? ownData(input, 'actionDigest') : undefined
  if (purpose === 'browser-action'
    && (typeof actionDigest !== 'string' || !/^[0-9a-f]{64}$/.test(actionDigest))) {
    throw new TypeError('browser action digest is invalid')
  }
  return Object.freeze({
    purpose: purpose as NativeApprovalScope['purpose'],
    sessionId,
    leaseId,
    leaseRevision,
    surfaceKind: typedSurfaceKind,
    targets,
    capabilities,
    allowlistRevision,
    ...(purpose === 'browser-action' ? { actionDigest: actionDigest as string } : {}),
  })
}

function appendKeyPart(parts: string[], value: string | number): void {
  const encoded = String(value)
  parts.push(`${utf8.encode(encoded).byteLength}:${encoded}`)
}

function scopeKey(scope: NativeApprovalScope): string {
  const parts: string[] = []
  appendKeyPart(parts, scope.purpose)
  appendKeyPart(parts, scope.sessionId)
  appendKeyPart(parts, scope.leaseId)
  appendKeyPart(parts, scope.leaseRevision)
  appendKeyPart(parts, scope.surfaceKind)
  appendKeyPart(parts, scope.allowlistRevision)
  if (scope.purpose === 'browser-action') {
    if (scope.actionDigest === undefined) throw new TypeError('browser action digest is missing')
    appendKeyPart(parts, scope.actionDigest)
  }
  appendKeyPart(parts, scope.targets.length)
  for (const target of scope.targets) {
    appendKeyPart(parts, target.appId)
    appendKeyPart(parts, target.windowIds.length)
    for (const windowId of target.windowIds) appendKeyPart(parts, windowId)
  }
  appendKeyPart(parts, scope.capabilities.length)
  for (const capability of scope.capabilities) appendKeyPart(parts, capability)
  return parts.join('')
}

function challengeOptions(scope: NativeApprovalScope): NativeApprovalDialogOptions {
  const noun = scope.purpose === 'lease' ? 'control session' : 'browser action'
  let fingerprint = ''
  if (scope.purpose === 'browser-action') {
    if (scope.actionDigest === undefined) throw new TypeError('browser action digest is missing')
    fingerprint = ` Action: ${scope.actionDigest.slice(0, 12)}.`
  }
  return Object.freeze({
    type: 'warning',
    title: 'Allow Desktop control?',
    message: `Allow this ${noun}?`,
    detail: `Surface: ${scope.surfaceKind}. Targets: ${scope.targets.length}. Capabilities: ${scope.capabilities.length}.${fingerprint}`,
    buttons: APPROVAL_BUTTONS,
    cancelId: 0,
    defaultId: 0,
    noLink: true,
  })
}

function pendingWindowIsValid(pending: PendingApproval): boolean {
  return !pending.invalidated
    && !pending.ownerWindow.isDestroyed()
    && pending.ownerWindow.isVisible()
}

export class NativeApprovalCoordinator {
  readonly #tickets = new Map<NativeApprovalTicket, ApprovalTicketRecord>()

  constructor(private readonly dependencies: NativeApprovalDependencies) {}

  get ticketCount(): number {
    return this.#tickets.size
  }

  consumeBeforeDispatch(
    ticket: NativeApprovalResult,
    input: NativeApprovalScope,
    revalidate: () => boolean,
  ): boolean {
    if (typeof ticket === 'string') return false
    const record = this.#tickets.get(ticket)
    if (record === undefined) return false
    this.#tickets.delete(ticket)

    let candidate: NativeApprovalScope
    let now: number
    try {
      candidate = canonicalScope(input)
      now = this.#now()
    } catch {
      return false
    }
    if (now < record.issuedAt
      || now - record.issuedAt >= NATIVE_APPROVAL_TICKET_LIFETIME_MS
      || scopeKey(candidate) !== record.key) return false
    try {
      const current: unknown = revalidate()
      return current === true
    } catch {
      return false
    }
  }

  revokeTicket(ticket: NativeApprovalTicket): boolean {
    return this.#tickets.delete(ticket)
  }

  request(input: NativeApprovalScope, signal?: AbortSignal): Promise<NativeApprovalResult> {
    let scope: NativeApprovalScope
    let key: string
    try {
      scope = canonicalScope(input)
      key = scopeKey(scope)
    } catch {
      return Promise.resolve('DENIED')
    }
    if (processPendingApproval !== undefined) return Promise.resolve('BUSY')
    if (signal?.aborted) return Promise.resolve('DENIED')

    let ownerWindow: NativeApprovalOwnerWindow | undefined
    try {
      ownerWindow = this.dependencies.getOwnerWindow()
      if (!ownerWindow || ownerWindow.isDestroyed() || !ownerWindow.isVisible()) {
        return Promise.resolve('DENIED')
      }
    } catch {
      return Promise.resolve('DENIED')
    }

    let settled = false
    let resolveResult!: (result: NativeApprovalResult) => void
    const promise = new Promise<NativeApprovalResult>((resolve) => {
      resolveResult = resolve
    })
    const settle = (result: NativeApprovalResult): void => {
      if (settled) return
      settled = true
      resolveResult(result)
    }
    let cleanup = (): void => undefined
    const pending: PendingApproval = {
      scope,
      promise,
      ownerWindow,
      settle,
      invalidate: () => {
        pending.invalidated = true
        cleanup()
        pending.settle('DENIED')
      },
      abortCleanups: [],
      invalidated: false,
    }
    const invalidate = pending.invalidate
    processPendingApproval = pending

    cleanup = (): void => {
      try {
        ownerWindow.removeListener('hide', invalidate)
        ownerWindow.removeListener('closed', invalidate)
      } catch {
        // The approval is already terminal; listener cleanup must not revive it.
      }
      for (const removeAbortListener of pending.abortCleanups.splice(0)) removeAbortListener()
      if (processPendingApproval === pending) processPendingApproval = undefined
    }
    const finish = (result: NativeApprovalResult): void => {
      cleanup()
      pending.settle(result)
    }

    try {
      ownerWindow.on('hide', invalidate)
      ownerWindow.on('closed', invalidate)
      if (signal) {
        const onAbort = (): void => {
          invalidate()
        }
        signal.addEventListener('abort', onAbort, { once: true })
        pending.abortCleanups.push(() => {
          signal.removeEventListener('abort', onAbort)
        })
        if (signal.aborted) invalidate()
      }
      const dialogResult = this.dependencies.dialog.showMessageBox(ownerWindow, challengeOptions(scope))
      void Promise.resolve(dialogResult).then(async (result) => {
        if (result.response !== 1 || !pendingWindowIsValid(pending)) {
          finish('DENIED')
          return
        }
        let current = false
        try {
          const revalidated: unknown = await this.dependencies.revalidate(scope)
          current = revalidated === true
        } catch {
          current = false
        }
        if (!current || !pendingWindowIsValid(pending)) {
          finish('DENIED')
          return
        }
        let issuedAt: number
        try {
          issuedAt = this.#now()
        } catch {
          finish('DENIED')
          return
        }
        const ticket = Object.freeze({}) as NativeApprovalTicket
        this.#tickets.set(ticket, Object.freeze({ key, issuedAt }))
        finish(ticket)
      }).catch(() => {
        finish('DENIED')
      })
    } catch {
      finish('DENIED')
    }
    return promise
  }

  #now(): number {
    const value = this.dependencies.now?.() ?? performance.now()
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
      throw new TypeError('native approval monotonic clock is invalid')
    }
    return value
  }
}
