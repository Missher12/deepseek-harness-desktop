import {
  ERROR_CODES,
  type BridgeRequest,
  type ControlLeaseAcquireRequest,
  type ControlLeaseAcquireResult,
  type ControlLeaseCapability,
  type ControlLeaseQuotaSnapshot,
  type ControlLeaseSurfaceKind,
  type ControlLeaseTarget,
  type DecodedDesktopControlEnvelope,
  type DesktopControlErrorCode,
  type DesktopControlResultMap,
  type SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type {
  DesktopControlAcquisitionCompletion,
  DesktopControlBackend,
  DesktopControlDispatchContext,
} from './bridge-server.ts'
import {
  ActionGrantAuthority,
  type BrowserActionGrantScope,
} from './action-grant.ts'
import type { ControlAuditEvent } from './audit.ts'
import {
  ControlAuthorityError,
  CONTROL_LEASE_HARD_MS,
  ControlLeaseAuthority,
  DEFAULT_CONTROL_LEASE_QUOTAS,
  effectiveHelperTimeoutMs,
  type ActiveControlLease,
  type LeaseAcquisitionFacts,
  type MonotonicClock,
  type OperationAuthorityFacts,
  type PreparedControlLease,
  type ControlLeaseRevokedEvent,
} from './control-lease.ts'
import {
  EmergencyShortcutController,
  type ShortcutRegistrar,
} from './emergency-shortcut.ts'
import {
  NativeApprovalCoordinator,
  type NativeApprovalDependencies,
  type NativeApprovalScope,
} from './native-approval.ts'
import {
  classifyAuthorityRequest,
  controlRequestRule,
  type AdapterPolicyFacts,
} from './policy.ts'
import type { ControlSettings } from './settings-store.ts'
import type { ControlLifecycleReason } from '../application.ts'

const DEFAULT_CLEANUP_TIMEOUT_MS = 2_000
const MAX_RELEASED_LEASES = 32
const PERSISTENT_BROWSER_MUTATIONS = new Set<BridgeRequest['requestKind']>([
  'browser.navigate', 'browser.click', 'browser.type', 'browser.key',
  'browser.select', 'browser.scroll', 'browser.back', 'browser.forward',
  'browser.reload',
])
const CONTROL_ERROR_CODES: ReadonlySet<string> = new Set(ERROR_CODES)

export interface ControlSettingsAuthoritySnapshot {
  readonly settings: ControlSettings
  readonly revision: number
}

export interface SurfaceAcquireFacts {
  readonly surfaceKind: ControlLeaseSurfaceKind
  readonly targets: readonly ControlLeaseTarget[]
  readonly capabilities: readonly ControlLeaseCapability[]
  readonly policyAllowed: boolean
}

export interface SurfaceOperationFacts {
  readonly surfaceKind: ControlLeaseSurfaceKind
  readonly targets: readonly ControlLeaseTarget[]
  readonly capabilities: readonly ControlLeaseCapability[]
  readonly policy: AdapterPolicyFacts
  readonly browserAction?: {
    readonly surfaceId: string
    readonly navigationRevision: number
  }
}

export interface PreparedLeaseInstall extends ControlLeaseAcquireResult {
  readonly sessionId: SessionId
  readonly agentId: string
  readonly quotas: ControlLeaseQuotaSnapshot
}

export interface ControlAdapterCallContext {
  readonly signal: AbortSignal
  readonly timeoutMs: number
}

/** Narrow Electron-main seam implemented by Task 7 browser and Task 8 native adapters. */
export interface DesktopControlSurfaceAdapter {
  readonly kind: 'browser' | 'computer'
  supported(): boolean
  acquireFacts(
    request: ControlLeaseAcquireRequest,
    signal: AbortSignal,
  ): Promise<SurfaceAcquireFacts>
  operationFacts(
    request: BridgeRequest,
    signal: AbortSignal,
  ): Promise<SurfaceOperationFacts>
  dispatch(
    request: BridgeRequest,
    context: DesktopControlDispatchContext,
  ): Promise<DecodedDesktopControlEnvelope>
  installLease?(snapshot: PreparedLeaseInstall, context: ControlAdapterCallContext): Promise<void>
  rollbackLeaseInstall?(snapshot: PreparedLeaseInstall, context: ControlAdapterCallContext): Promise<void>
  retryPendingCleanup?(sessionId: SessionId, signal: AbortSignal): Promise<boolean>
  clearQueue(snapshot: ActiveControlLease, signal: AbortSignal): Promise<void>
  stopLease(snapshot: ActiveControlLease, reason: string, signal: AbortSignal): Promise<void>
  releaseKnownInput?(snapshot: ActiveControlLease, signal: AbortSignal): Promise<void>
  shutdown(signal: AbortSignal): Promise<void>
  recoverAfterCrash?(signal: AbortSignal): Promise<void>
}

export interface ControlAuditSink {
  record(event: ControlAuditEvent): Promise<void>
  flush(): Promise<void>
}

export interface DesktopControlCoordinatorOptions {
  readonly clock: MonotonicClock
  readonly mintLeaseId: () => string
  readonly getOfficialSessionId: () => SessionId | undefined
  readonly claimOfficialSession?: (sessionId: SessionId) => SessionId | undefined
  readonly releaseOfficialSession?: (sessionId: SessionId) => void
  readonly getAgentDisplayName: (sessionId: SessionId) => string
  readonly getSettings: () => ControlSettingsAuthoritySnapshot
  readonly approval: NativeApprovalDependencies
  readonly shortcuts: ShortcutRegistrar
  readonly browser?: DesktopControlSurfaceAdapter
  readonly computer?: DesktopControlSurfaceAdapter
  readonly audit?: ControlAuditSink
  readonly cleanupTimeoutMs?: number
  readonly onLeaseRevoked?: (event: ControlLeaseRevokedEvent) => void
}

/** Path-free state for native Desktop UI; lease/session/ref authority never crosses this seam. */
export interface DesktopControlCoordinatorStatus {
  readonly browserSupported: boolean
  readonly computerSupported: boolean
  readonly active: null | {
    readonly surfaceKind: ControlLeaseSurfaceKind
    readonly agentName: string
    readonly appId: string | null
  }
  readonly action: string | null
  readonly stopping: boolean
}

interface InFlightDispatch {
  readonly generation: number
  readonly controller: AbortController
  readonly detach: () => void
}

function errorEnvelope(
  request: BridgeRequest,
  code: DesktopControlErrorCode,
): DecodedDesktopControlEnvelope {
  return Object.freeze({
    message: Object.freeze({
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'error',
      requestId: request.requestId,
      requestKind: request.requestKind,
      error: Object.freeze({
        code,
        message: 'Desktop control request was not completed.',
        retryable: false,
      }),
    }),
  })
}

function okEnvelope<K extends keyof DesktopControlResultMap>(
  request: Extract<BridgeRequest, { readonly requestKind: K }>,
  result: DesktopControlResultMap[K],
): DecodedDesktopControlEnvelope {
  return Object.freeze({
    message: Object.freeze({
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestId: request.requestId,
      requestKind: request.requestKind,
      result,
    }),
  }) as DecodedDesktopControlEnvelope
}

function adapterErrorCode(error: unknown): DesktopControlErrorCode {
  if (error instanceof ControlAuthorityError) return error.code
  if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code')
    const code: unknown = descriptor?.value
    if (typeof code === 'string' && CONTROL_ERROR_CODES.has(code)) {
      return code as DesktopControlErrorCode
    }
  }
  return 'INTERNAL'
}

function sameValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameTargets(left: readonly ControlLeaseTarget[], right: readonly ControlLeaseTarget[]): boolean {
  return left.length === right.length && left.every((target, index) => {
    const candidate = right[index]
    return candidate !== undefined && target.appId === candidate.appId
      && sameValues(target.windowIds, candidate.windowIds)
  })
}

function targetsContained(
  granted: readonly ControlLeaseTarget[],
  current: readonly ControlLeaseTarget[],
): boolean {
  return granted.every((target) => {
    const candidate = current.find(value => value.appId === target.appId)
    return candidate !== undefined
      && target.windowIds.every(windowId => candidate.windowIds.includes(windowId))
  })
}

function leaseKey(snapshot: Pick<ActiveControlLease, 'sessionId' | 'leaseId' | 'leaseRevision'>): string {
  return `${snapshot.sessionId}\u0000${snapshot.leaseId}\u0000${String(snapshot.leaseRevision)}`
}

function finiteRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1
}

interface PendingControlAcquire {
  readonly sessionId: SessionId
  readonly controller: AbortController
  readonly adapter: DesktopControlSurfaceAdapter
  prepared?: PreparedControlLease
  cleanupFailure?: unknown
  readonly quiescence: Promise<void>
  readonly resolveQuiescence: () => void
}

/** The sole Electron-main owner of lease, approval, dispatch, and cleanup authority. */
export class DesktopControlCoordinator implements DesktopControlBackend {
  readonly #options: DesktopControlCoordinatorOptions
  readonly #approvals: NativeApprovalCoordinator
  readonly #actionGrants: ActionGrantAuthority
  readonly #leases: ControlLeaseAuthority
  readonly #shortcut: EmergencyShortcutController
  readonly #cleanupTimeoutMs: number
  readonly #inFlight = new Set<InFlightDispatch>()
  readonly #cleanupByGeneration = new Map<number, Promise<void>>()
  readonly #released = new Map<string, Promise<void>>()
  readonly #statusListeners = new Set<(snapshot: DesktopControlCoordinatorStatus) => void>()
  #cleanupTail: Promise<void> = Promise.resolve()
  #latestCleanup: Promise<void> = Promise.resolve()
  #shutdownPromise: Promise<void> | undefined
  #pendingAcquire: PendingControlAcquire | undefined
  #admission = true
  #closing = false
  #transportOpen = true
  #cleanupPending = 0
  #cleanupFailed = false
  #resumeRequired = false
  #stoppingLease: ActiveControlLease | null = null
  #currentAction: { readonly generation: number; readonly requestKind: BridgeRequest['requestKind'] } | null = null

  constructor(options: DesktopControlCoordinatorOptions) {
    this.#options = options
    this.#cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS
    if (!Number.isSafeInteger(this.#cleanupTimeoutMs)
      || this.#cleanupTimeoutMs < 1 || this.#cleanupTimeoutMs > 30_000) {
      throw new TypeError('control cleanup timeout is invalid')
    }
    this.#approvals = new NativeApprovalCoordinator(options.approval)
    this.#actionGrants = new ActionGrantAuthority(options.clock, this.#approvals)
    this.#leases = new ControlLeaseAuthority({
      clock: options.clock,
      mintLeaseId: options.mintLeaseId,
      actionGrants: this.#actionGrants,
      onRevoked: (event) => { this.#leaseRevoked(event) },
    })
    this.#shortcut = new EmergencyShortcutController({
      shortcuts: options.shortcuts,
      isLeaseActive: () => this.#leases.activeSnapshot() !== null,
      closeAdmission: () => { this.#admission = false },
      revokeSynchronously: () => { this.#leases.revoke('emergency-stop') },
      stopAll: async () => { await this.#latestCleanup },
    })
  }

  activeLease(): ActiveControlLease | null {
    return this.#leases.activeSnapshot()
  }

  controlStatus(): DesktopControlCoordinatorStatus {
    const active = this.#leases.activeSnapshot() ?? this.#stoppingLease
    return Object.freeze({
      browserSupported: this.#supported(this.#options.browser),
      computerSupported: this.#supported(this.#options.computer),
      active: active === null ? null : Object.freeze({
        surfaceKind: active.surfaceKind,
        agentName: active.agentId,
        appId: active.targets.length === 1 ? active.targets[0]?.appId ?? null : null,
      }),
      action: this.#currentAction?.requestKind ?? null,
      stopping: this.#stoppingLease !== null,
    })
  }

  subscribeStatus(listener: (snapshot: DesktopControlCoordinatorStatus) => void): () => void {
    this.#statusListeners.add(listener)
    listener(this.controlStatus())
    return () => { this.#statusListeners.delete(listener) }
  }

  /** Atomically replace only this feature's active emergency accelerator. */
  rebindEmergencyShortcut(accelerator: string): void {
    if (this.#leases.activeSnapshot() === null) return
    this.#shortcut.rebind(accelerator)
  }

  async dispatch(
    request: BridgeRequest,
    context: DesktopControlDispatchContext,
  ): Promise<DecodedDesktopControlEnvelope> {
    try {
      this.#assertOrClaimOfficialSession(request.sessionId)
      switch (request.requestKind) {
        case 'control.lease.acquire':
          return okEnvelope(request, await this.#acquire(request, context))
        case 'control.lease.release':
          await this.#release(request.sessionId, request.leaseId, request.leaseRevision)
          return okEnvelope(request, Object.freeze({ released: true }))
        case 'desktop.status':
          return okEnvelope(request, Object.freeze({
            browserSupported: this.#supported(this.#options.browser),
            computerSupported: this.#supported(this.#options.computer),
          }))
        case 'browser.stop':
          await this.#stopBrowserSession(request.sessionId, context.signal)
          return okEnvelope(request, Object.freeze({ stopped: true }))
        case 'computer.stop':
          await this.#stopSession(request.sessionId)
          return okEnvelope(request, Object.freeze({ stopped: true }))
        default:
          return await this.#dispatchAdapter(request, context)
      }
    } catch (error) {
      return errorEnvelope(request, adapterErrorCode(error))
    }
  }

  async revokeSession(sessionId: SessionId, signal: AbortSignal): Promise<void> {
    this.#assertOfficialSession(sessionId)
    const pending = this.#abortPendingAcquire('session-revoked', sessionId)
    let pendingFailure: unknown
    try { await this.#awaitPendingCleanup(pending) } catch (error) { pendingFailure = error }
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error('control cleanup aborted', { cause: signal.reason })
    }
    if (pending?.adapter.retryPendingCleanup !== undefined) {
      const cleared = await pending.adapter.retryPendingCleanup(sessionId, signal)
      if (cleared) pendingFailure = undefined
    }
    if (pendingFailure !== undefined) {
      throw pendingFailure instanceof Error
        ? pendingFailure
        : new Error('pending control cleanup failed', { cause: pendingFailure })
    }
    const active = this.#leases.activeSnapshot()
    if (active?.sessionId === sessionId) {
      this.#leases.revokeSession(sessionId, 'session-revoked')
      await this.#awaitReleased(active)
    }
    await this.#options.browser?.retryPendingCleanup?.(sessionId, signal)
    this.#options.releaseOfficialSession?.(sessionId)
  }

  transportAttached(): void {
    this.#transportOpen = true
    if (this.#leases.activeSnapshot() !== null || this.#pendingAcquire !== undefined
      || this.#cleanupPending !== 0) return
    if (this.#resumeRequired || (this.#cleanupFailed && this.#shutdownPromise === undefined)) return
    this.#closing = false
    this.#shutdownPromise = undefined
    this.#cleanupFailed = false
    this.#admission = true
  }

  /** Reopen control only after the main process has actually made the owner window visible. */
  resumeAdmission(): boolean {
    if (!this.#transportOpen || this.#closing || this.#cleanupFailed
      || this.#leases.activeSnapshot() !== null || this.#pendingAcquire !== undefined
      || this.#cleanupPending !== 0) return false
    this.#resumeRequired = false
    this.#admission = true
    return true
  }

  transportClosed(_reason: string): void {
    this.#transportOpen = false
    this.#admission = false
    this.#abortPendingAcquire('transport-closed')
    const active = this.#leases.activeSnapshot()
    this.#leases.revoke('transport-closed')
    const official = active?.sessionId ?? this.#options.getOfficialSessionId()
    if (official !== undefined) this.#options.releaseOfficialSession?.(official)
  }

  async helperCrashed(): Promise<void> {
    const active = this.#leases.activeSnapshot()
    if (active === null) {
      await this.#bounded(async (signal) => {
        await this.#options.computer?.recoverAfterCrash?.(signal)
      })
      return
    }
    this.#leases.revoke('helper-crash')
    await this.#awaitReleased(active)
  }

  beforeControlShutdown(signal: AbortSignal): Promise<void> {
    this.#shutdownPromise ??= this.#shutdown(signal)
    return this.#shutdownPromise
  }

  async cleanup(reason: ControlLifecycleReason): Promise<void> {
    if (reason === 'retry' || reason === 'quit' || reason === 'startup-failure') {
      await this.beforeControlShutdown(new AbortController().signal)
      return
    }
    this.#admission = false
    if (reason === 'close-to-tray') this.#resumeRequired = true
    const pending = this.#abortPendingAcquire(reason)
    const active = this.#leases.activeSnapshot()
    if (active !== null) this.#leases.revoke(reason)
    try {
      await this.#awaitPendingCleanup(pending)
      await this.#latestCleanup
    } catch {
      this.#cleanupFailed = true
      throw new ControlAuthorityError('INTERNAL', 'control cleanup failed')
    }
  }

  async drainCleanup(): Promise<void> {
    await this.#latestCleanup
  }

  async #acquire(
    request: ControlLeaseAcquireRequest,
    context: DesktopControlDispatchContext,
  ): Promise<ControlLeaseAcquireResult> {
    if (!this.#admission || this.#closing || this.#pendingAcquire !== undefined) {
      throw new ControlAuthorityError('BUSY', 'control admission is closed')
    }
    const adapter = this.#adapterForSurface(request.surfaceKind)
    if (!this.#supported(adapter)) throw new ControlAuthorityError('NOT_SUPPORTED', 'surface unavailable')
    const settings = this.#settings()
    this.#assertSurfaceEnabled(request.surfaceKind, settings.settings)
    const controller = new AbortController()
    const detach = this.#forwardAbort(context.signal, controller)
    let resolveQuiescence!: () => void
    const pendingAcquire: PendingControlAcquire = {
      sessionId: request.sessionId,
      controller,
      adapter,
      quiescence: new Promise<void>((resolve) => { resolveQuiescence = resolve }),
      resolveQuiescence: () => { resolveQuiescence() },
    }
    this.#pendingAcquire = pendingAcquire
    let prepared: PreparedControlLease | undefined
    let install: PreparedLeaseInstall | undefined
    let installAttempted = false
    let activated: ActiveControlLease | null = null
    let activationTransferred = false
    let activationIdentity: ControlLeaseAcquireResult | undefined
    let acquisitionCompletion: DesktopControlAcquisitionCompletion | undefined
    try {
      const initial = await adapter.acquireFacts(request, controller.signal)
      this.#throwIfAborted(controller.signal)
      const effectiveRequest = this.#effectiveAcquireRequest(request, initial)
      const facts = this.#leaseFacts(effectiveRequest, initial, settings)
      const agentId = this.#options.getAgentDisplayName(request.sessionId)
      prepared = this.#leases.prepareAcquire(effectiveRequest, facts, agentId)
      pendingAcquire.prepared = prepared
      const descriptor = this.#leases.preparedDescriptor(prepared)
      install = Object.freeze({
        ...descriptor,
        sessionId: request.sessionId,
        agentId,
        quotas: Object.freeze({ ...DEFAULT_CONTROL_LEASE_QUOTAS }),
      })
      const approvalScope = this.#leaseApprovalScope(request.sessionId, descriptor, settings.revision)
      const approval = await this.#approvals.request(approvalScope, controller.signal)
      this.#throwIfAborted(controller.signal)
      if (approval === 'BUSY') throw new ControlAuthorityError('BUSY', 'another approval is pending')
      if (approval === 'DENIED') {
        const code = effectiveRequest.surfaceKind === 'native-application'
          ? 'APPROVAL_DENIED'
          : 'POLICY_DENIED'
        throw new ControlAuthorityError(code, 'native approval denied')
      }

      const currentSettings = this.#settings()
      const current = await adapter.acquireFacts(request, controller.signal)
      this.#throwIfAborted(controller.signal)
      const currentFacts = this.#leaseFacts(effectiveRequest, current, currentSettings)
      if (!this.#approvals.consumeBeforeDispatch(
        approval,
        approvalScope,
        () => this.#leaseApprovalCurrent(approvalScope, currentFacts, currentSettings),
      )) throw new ControlAuthorityError('POLICY_DENIED', 'native approval became stale')

      if (effectiveRequest.surfaceKind === 'native-application') {
        if (adapter.installLease === undefined) {
          throw new ControlAuthorityError('NOT_SUPPORTED', 'native helper is unavailable')
        }
        installAttempted = true
        await adapter.installLease(install, {
          signal: controller.signal,
          timeoutMs: effectiveHelperTimeoutMs(context.timeoutMs, CONTROL_LEASE_HARD_MS),
        })
        this.#throwIfAborted(controller.signal)
      }

      const activationSettings = this.#settings()
      const latest = await adapter.acquireFacts(request, controller.signal)
      this.#throwIfAborted(controller.signal)
      const activationFacts = this.#leaseFacts(effectiveRequest, latest, activationSettings)
      if (activationSettings.revision !== approvalScope.allowlistRevision) {
        throw new ControlAuthorityError('POLICY_DENIED', 'allowlist changed before activation')
      }
      this.#throwIfAborted(controller.signal)
      activationTransferred = true
      activationIdentity = descriptor
      const result = this.#leases.activatePrepared(prepared, effectiveRequest, activationFacts)
      prepared = undefined
      delete pendingAcquire.prepared
      activated = this.#leases.activeSnapshot()
      if (activated === null) throw new ControlAuthorityError('INTERNAL', 'activated lease is unavailable')
      acquisitionCompletion = this.#bindActivatedAcquisition(activated, context.signal)
      if (!context.registerAcquisition(acquisitionCompletion)) {
        await acquisitionCompletion.cancel()
        throw new ControlAuthorityError('CANCELLED', 'acquisition response is no longer pending')
      }
      this.#throwIfAborted(controller.signal)
      try {
        this.#shortcut.activate(activationSettings.settings.emergencyAccelerator)
      } catch {
        await this.#awaitReleased(activated)
        throw new ControlAuthorityError('INTERNAL', 'emergency shortcut registration failed')
      }
      void this.#bounded(async () => { await this.#audit({
        sessionId: request.sessionId,
        appId: result.targets.length === 1 ? result.targets[0]?.appId ?? null : null,
        action: 'lease-granted',
        outcome: 'granted',
      }) }).catch(() => undefined)
      this.#throwIfAborted(controller.signal)
      this.#publishStatus()
      return result
    } catch (error) {
      if (acquisitionCompletion !== undefined) {
        try { await acquisitionCompletion.cancel() } catch (cleanupError) {
          pendingAcquire.cleanupFailure ??= cleanupError
        }
      }
      if (prepared !== undefined && pendingAcquire.prepared === prepared) {
        this.#leases.cancelPrepared(prepared)
        delete pendingAcquire.prepared
      }
      const transferredCleanup = activationTransferred && activationIdentity !== undefined
        ? this.#released.get(leaseKey({
          sessionId: request.sessionId,
          leaseId: activationIdentity.leaseId,
          leaseRevision: activationIdentity.leaseRevision,
        }))
        : undefined
      if (transferredCleanup !== undefined) {
        try { await transferredCleanup } catch (cleanupError) {
          pendingAcquire.cleanupFailure ??= cleanupError
        }
      } else if (install !== undefined && (installAttempted || adapter.kind === 'browser')) {
        const attemptedInstall = install
        try {
          await this.#bounded(async (signal) => {
            await adapter.rollbackLeaseInstall?.(attemptedInstall, {
              signal,
              timeoutMs: this.#cleanupTimeoutMs,
            })
          })
        } catch (cleanupError) { pendingAcquire.cleanupFailure ??= cleanupError }
      }
      throw error
    } finally {
      if (this.#pendingAcquire === pendingAcquire) this.#pendingAcquire = undefined
      detach()
      pendingAcquire.resolveQuiescence()
    }
  }

  async #dispatchAdapter(
    request: BridgeRequest,
    context: DesktopControlDispatchContext,
  ): Promise<DecodedDesktopControlEnvelope> {
    const adapter = request.requestKind.startsWith('browser.')
      ? this.#options.browser
      : this.#options.computer
    if (adapter === undefined || !this.#supported(adapter)) {
      throw new ControlAuthorityError('NOT_SUPPORTED', 'adapter unavailable')
    }
    if (!this.#admission && !request.requestKind.endsWith('.stop')) {
      throw new ControlAuthorityError('DISCONNECTED', 'control admission is closed')
    }
    const controller = new AbortController()
    const detach = this.#forwardAbort(context.signal, controller)
    let inFlight: InFlightDispatch | undefined
    try {
      let facts = await adapter.operationFacts(request, controller.signal)
      let operationFacts = this.#operationFacts(request, facts)
      const active = this.#leases.activeSnapshot()
      let authorization: Parameters<ControlLeaseAuthority['prepareDispatch']>[2]
      if (classifyAuthorityRequest(request, facts.surfaceKind, facts.policy) === 'APPROVAL_REQUIRED'
        && PERSISTENT_BROWSER_MUTATIONS.has(request.requestKind)) {
        if (active === null || facts.browserAction === undefined) {
          throw new ControlAuthorityError('POLICY_DENIED', 'action approval scope is unavailable')
        }
        const grantScope: BrowserActionGrantScope = {
          request: request as BrowserActionGrantScope['request'],
          surfaceId: facts.browserAction.surfaceId,
          navigationRevision: facts.browserAction.navigationRevision,
        }
        const settings = this.#settings()
        const approvalScope = this.#actionGrants.approvalScope(grantScope, {
          sessionId: active.sessionId,
          leaseId: active.leaseId,
          leaseRevision: active.leaseRevision,
          surfaceKind: active.surfaceKind,
          targets: active.targets,
          capabilities: active.capabilities,
          allowlistRevision: settings.revision,
        })
        const approved = await this.#approvals.request(approvalScope, controller.signal)
        if (approved === 'BUSY') throw new ControlAuthorityError('BUSY', 'another approval is pending')
        if (approved === 'DENIED') throw new ControlAuthorityError('POLICY_DENIED', 'action approval denied')
        facts = await adapter.operationFacts(request, controller.signal)
        operationFacts = this.#operationFacts(request, facts)
        const current = (): boolean => this.#actionApprovalCurrent(approvalScope, facts, grantScope)
        const grant = this.#actionGrants.issueFromApproval(
          grantScope,
          approvalScope,
          approved,
          current,
        )
        authorization = { grant, scope: grantScope, revalidate: current }
      }
      this.#leases.prepareDispatch(request, operationFacts, authorization)
      const generation = this.#leases.activeSnapshot()?.generation ?? 0
      inFlight = { generation, controller, detach }
      this.#inFlight.add(inFlight)
      this.#currentAction = { generation, requestKind: request.requestKind }
      this.#publishStatus()
      return await adapter.dispatch(request, { ...context, signal: controller.signal })
    } finally {
      if (inFlight !== undefined) {
        this.#inFlight.delete(inFlight)
        if (this.#currentAction?.generation === inFlight.generation) {
          this.#currentAction = null
          this.#publishStatus()
        }
      }
      detach()
    }
  }

  async #release(sessionId: SessionId, leaseId: ActiveControlLease['leaseId'], revision: number): Promise<void> {
    const key = leaseKey({ sessionId, leaseId, leaseRevision: revision })
    const prior = this.#released.get(key)
    if (prior !== undefined) {
      await prior
      return
    }
    const active = this.#leases.activeSnapshot()
    if (active === null || active.sessionId !== sessionId
      || active.leaseId !== leaseId || active.leaseRevision !== revision) {
      throw new ControlAuthorityError('LEASE_REVOKED', 'lease is no longer active')
    }
    this.#leases.revokeExact(sessionId, leaseId, revision, 'released')
    await this.#awaitReleased(active)
  }

  #leaseRevoked(event: ControlLeaseRevokedEvent): void {
    this.#admission = false
    this.#stoppingLease = event.snapshot
    this.#currentAction = null
    this.#publishStatus()
    try { this.#shortcut.deactivate() } catch { this.#cleanupFailed = true }
    this.#actionGrants.revokeLease(
      event.snapshot.sessionId,
      event.snapshot.leaseId,
      event.snapshot.leaseRevision,
    )
    for (const dispatch of this.#inFlight) {
      if (dispatch.generation === event.generation) dispatch.controller.abort(new Error('LEASE_REVOKED'))
    }
    try { this.#options.onLeaseRevoked?.(event) } catch { /* authority remains revoked */ }
    this.#cleanupPending += 1
    const cleanup = this.#cleanupTail.then(async () => {
      await this.#cleanupLease(event)
    })
    this.#cleanupByGeneration.set(event.generation, cleanup)
    const key = leaseKey(event.snapshot)
    this.#released.set(key, cleanup)
    while (this.#released.size > MAX_RELEASED_LEASES) {
      const oldest = this.#released.keys().next().value
      if (oldest === undefined) break
      this.#released.delete(oldest)
    }
    this.#latestCleanup = cleanup
    this.#cleanupTail = cleanup.catch(() => undefined)
    void cleanup.catch(() => { this.#cleanupFailed = true })
    void cleanup.finally(() => {
      this.#cleanupPending -= 1
      this.#cleanupByGeneration.delete(event.generation)
      if (this.#stoppingLease?.generation === event.generation) {
        this.#stoppingLease = null
        this.#publishStatus()
      }
      if (this.#transportOpen && !this.#closing && !this.#cleanupFailed
        && !this.#resumeRequired
        && this.#cleanupPending === 0
        && this.#leases.activeSnapshot() === null
        && this.#pendingAcquire === undefined) this.#admission = true
    }).catch(() => undefined)
  }

  #publishStatus(): void {
    const snapshot = this.controlStatus()
    for (const listener of this.#statusListeners) {
      try { listener(snapshot) } catch { /* renderer status cannot affect authority */ }
    }
  }

  async #cleanupLease(event: ControlLeaseRevokedEvent): Promise<void> {
    const adapter = event.snapshot.surfaceKind === 'native-application'
      ? this.#options.computer
      : this.#options.browser
    if (adapter === undefined) return
    await this.#bounded(async (signal) => {
      let firstError: unknown
      const step = async (operation: () => Promise<void>): Promise<void> => {
        try { await operation() } catch (error) { firstError ??= error }
      }
      await step(async () => { await adapter.clearQueue(event.snapshot, signal) })
      await step(async () => { await adapter.stopLease(event.snapshot, event.reason, signal) })
      if (event.reason === 'helper-crash') {
        await step(async () => { await adapter.recoverAfterCrash?.(signal) })
      }
      if (event.snapshot.surfaceKind === 'native-application') {
        await step(async () => { await adapter.releaseKnownInput?.(event.snapshot, signal) })
      }
      await step(async () => {
        await this.#audit({
          sessionId: event.snapshot.sessionId,
          appId: event.snapshot.targets.length === 1
            ? event.snapshot.targets[0]?.appId ?? null
            : null,
          action: event.reason === 'emergency-stop' ? 'emergency-stop' : 'lease-revoked',
          outcome: 'stopped',
        })
      })
      if (firstError !== undefined) {
        throw firstError instanceof Error
          ? firstError
          : new Error('control cleanup failed', { cause: firstError })
      }
    })
  }

  async #shutdown(signal: AbortSignal): Promise<void> {
    this.#closing = true
    this.#admission = false
    const pending = this.#abortPendingAcquire('shutdown')
    const active = this.#leases.activeSnapshot()
    if (active !== null) this.#leases.revoke('shutdown')
    await this.#awaitPendingCleanup(pending).catch(() => undefined)
    await this.#latestCleanup.catch(() => undefined)
    await this.#bounded(async (boundedSignal) => {
      if (signal.aborted) throw signal.reason
      await this.#options.browser?.shutdown(boundedSignal)
      await this.#options.computer?.shutdown(boundedSignal)
      await this.#options.audit?.flush()
    }).catch(() => undefined)
  }

  async #awaitReleased(active: ActiveControlLease | null): Promise<void> {
    if (active === null) return
    const cleanup = this.#cleanupByGeneration.get(active.generation)
      ?? this.#released.get(leaseKey(active))
    if (cleanup === undefined) throw new ControlAuthorityError('INTERNAL', 'lease cleanup was not queued')
    try { await cleanup } catch { throw new ControlAuthorityError('INTERNAL', 'lease cleanup failed') }
  }

  #abortPendingAcquire(
    reason: string,
    sessionId?: SessionId,
  ): PendingControlAcquire | undefined {
    const pending = this.#pendingAcquire
    if (pending === undefined || sessionId !== undefined && pending.sessionId !== sessionId) return undefined
    pending.controller.abort(new Error(reason))
    const prepared = pending.prepared
    if (prepared !== undefined) {
      this.#leases.cancelPrepared(prepared)
      delete pending.prepared
    }
    return pending
  }

  async #awaitPendingCleanup(pending: PendingControlAcquire | undefined): Promise<void> {
    if (pending === undefined) return
    await pending.quiescence
    if (pending.cleanupFailure !== undefined) {
      throw new ControlAuthorityError('INTERNAL', 'pending control rollback failed')
    }
  }

  #bindActivatedAcquisition(
    active: ActiveControlLease,
    signal: AbortSignal,
  ): DesktopControlAcquisitionCompletion {
    let state: 'pending' | 'accepted' | 'cancelled' = 'pending'
    let cancellation: Promise<void> | undefined
    const onAbort = (): void => { void cancel().catch(() => undefined) }
    const cancel = (): Promise<void> => {
      if (state === 'accepted') return Promise.resolve()
      if (cancellation !== undefined) return cancellation
      state = 'cancelled'
      signal.removeEventListener('abort', onAbort)
      this.#leases.revokeExact(
        active.sessionId,
        active.leaseId,
        active.leaseRevision,
        'request-aborted',
      )
      cancellation = this.#awaitReleased(active)
      return cancellation
    }
    const completion: DesktopControlAcquisitionCompletion = Object.freeze({
      accept: () => {
        if (state !== 'pending') return
        state = 'accepted'
        signal.removeEventListener('abort', onAbort)
      },
      cancel,
    })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    return completion
  }

  #throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new ControlAuthorityError('CANCELLED', 'control request was cancelled')
  }

  #settings(): ControlSettingsAuthoritySnapshot {
    const snapshot = this.#options.getSettings()
    if (!finiteRevision(snapshot.revision)) {
      throw new ControlAuthorityError('INTERNAL', 'settings revision is invalid')
    }
    return snapshot
  }

  #leaseFacts(
    request: ControlLeaseAcquireRequest,
    facts: SurfaceAcquireFacts,
    settings: ControlSettingsAuthoritySnapshot,
  ): LeaseAcquisitionFacts {
    if (facts.surfaceKind !== request.surfaceKind) {
      throw new ControlAuthorityError('POLICY_DENIED', 'surface authority facts are stale')
    }
    this.#assertSurfaceEnabled(facts.surfaceKind, settings.settings)
    const authorizedRequests = request.surfaceKind === 'native-application'
      ? request.targets.filter(target => settings.settings.ordinaryAppIds.includes(target.appId))
      : request.targets
    if (request.surfaceKind === 'native-application'
      && request.targets.length > 0
      && authorizedRequests.length === 0) {
      throw new ControlAuthorityError('TARGET_NOT_AUTHORIZED', 'no requested application is authorized')
    }
    const targets = request.surfaceKind === 'native-application'
      ? facts.targets.filter(target => settings.settings.ordinaryAppIds.includes(target.appId))
      : facts.targets
    if (request.surfaceKind === 'native-application' && request.targets.length > 0 && targets.length === 0) {
      throw new ControlAuthorityError('TARGET_CLOSED', 'no requested application target is current')
    }
    return Object.freeze({
      officialSessionId: this.#officialSession(),
      surfaceKind: facts.surfaceKind,
      targets,
      capabilities: facts.capabilities,
      policyAllowed: facts.policyAllowed,
    })
  }

  #effectiveAcquireRequest(
    request: ControlLeaseAcquireRequest,
    facts: SurfaceAcquireFacts,
  ): ControlLeaseAcquireRequest {
    if (facts.surfaceKind === request.surfaceKind) return request
    if (request.surfaceKind === 'browser-ephemeral'
      && facts.surfaceKind === 'browser-human-persistent'
      && facts.policyAllowed) {
      return Object.freeze({ ...request, surfaceKind: facts.surfaceKind })
    }
    throw new ControlAuthorityError('POLICY_DENIED', 'surface authority facts are stale')
  }

  #operationFacts(request: BridgeRequest, facts: SurfaceOperationFacts): OperationAuthorityFacts {
    const rule = controlRequestRule(request)
    const active = this.#leases.activeSnapshot()
    let targets = facts.targets
    if (rule.leaseScoped) {
      const settings = this.#settings()
      this.#assertSurfaceEnabled(facts.surfaceKind, settings.settings)
      targets = facts.surfaceKind === 'native-application'
        ? facts.targets.filter(target => settings.settings.ordinaryAppIds.includes(target.appId))
        : facts.targets
    }
    if (rule.leaseScoped && active !== null && active.surfaceKind !== facts.surfaceKind) {
      throw new ControlAuthorityError('POLICY_DENIED', 'operation authority facts are stale')
    }
    return Object.freeze({
      officialSessionId: this.#officialSession(),
      surfaceKind: facts.surfaceKind,
      targets,
      capabilities: facts.capabilities,
      policy: facts.policy,
    })
  }

  #leaseApprovalScope(
    sessionId: SessionId,
    descriptor: ControlLeaseAcquireResult,
    allowlistRevision: number,
  ): NativeApprovalScope {
    return Object.freeze({
      purpose: 'lease',
      sessionId,
      leaseId: descriptor.leaseId,
      leaseRevision: descriptor.leaseRevision,
      surfaceKind: descriptor.surfaceKind,
      targets: descriptor.targets,
      capabilities: descriptor.capabilities,
      allowlistRevision,
    })
  }

  #leaseApprovalCurrent(
    scope: NativeApprovalScope,
    facts: LeaseAcquisitionFacts,
    settings: ControlSettingsAuthoritySnapshot,
  ): boolean {
    return scope.purpose === 'lease'
      && scope.sessionId === this.#options.getOfficialSessionId()
      && scope.surfaceKind === facts.surfaceKind
      && scope.allowlistRevision === settings.revision
      && targetsContained(scope.targets, facts.targets)
      && scope.capabilities.every(capability => facts.capabilities.includes(capability))
      && facts.policyAllowed
  }

  #actionApprovalCurrent(
    scope: NativeApprovalScope,
    facts: SurfaceOperationFacts,
    grantScope: BrowserActionGrantScope,
  ): boolean {
    const active = this.#leases.activeSnapshot()
    const settings = this.#settings()
    return scope.purpose === 'browser-action'
      && active !== null
      && scope.sessionId === active.sessionId
      && scope.sessionId === this.#options.getOfficialSessionId()
      && scope.leaseId === active.leaseId
      && scope.leaseRevision === active.leaseRevision
      && scope.allowlistRevision === settings.revision
      && scope.surfaceKind === facts.surfaceKind
      && sameTargets(scope.targets, active.targets)
      && sameValues(scope.capabilities, active.capabilities)
      && facts.browserAction?.surfaceId === grantScope.surfaceId
      && facts.browserAction.navigationRevision === grantScope.navigationRevision
  }

  #adapterForSurface(surface: ControlLeaseSurfaceKind): DesktopControlSurfaceAdapter {
    const adapter = surface === 'native-application'
      ? this.#options.computer
      : this.#options.browser
    if (adapter === undefined) throw new ControlAuthorityError('NOT_SUPPORTED', 'surface unavailable')
    if ((surface === 'native-application') !== (adapter.kind === 'computer')) {
      throw new ControlAuthorityError('INTERNAL', 'adapter surface mismatch')
    }
    return adapter
  }

  #assertSurfaceEnabled(surface: ControlLeaseSurfaceKind, settings: ControlSettings): void {
    const enabled = surface === 'native-application'
      ? settings.computerEnabled
      : settings.browserEnabled
    if (!enabled) {
      const code = surface === 'native-application' ? 'CONTROL_DISABLED' : 'POLICY_DENIED'
      throw new ControlAuthorityError(code, 'control surface is disabled')
    }
  }

  #supported(adapter: DesktopControlSurfaceAdapter | undefined): boolean {
    if (adapter === undefined) return false
    try { return adapter.supported() } catch { return false }
  }

  #officialSession(): SessionId {
    const sessionId = this.#options.getOfficialSessionId()
    if (sessionId === undefined) throw new ControlAuthorityError('UNAUTHORIZED', 'no official session')
    return sessionId
  }

  #assertOfficialSession(sessionId: SessionId): void {
    if (sessionId !== this.#options.getOfficialSessionId()) {
      throw new ControlAuthorityError('UNAUTHORIZED', 'foreign session')
    }
  }

  #assertOrClaimOfficialSession(sessionId: SessionId): void {
    const current = this.#options.getOfficialSessionId()
    const official = current ?? this.#options.claimOfficialSession?.(sessionId)
    if (official !== sessionId) {
      throw new ControlAuthorityError('UNAUTHORIZED', 'foreign session')
    }
  }

  async #stopSession(sessionId: SessionId): Promise<void> {
    const active = this.#leases.activeSnapshot()
    if (active?.sessionId !== sessionId) return
    this.#leases.revokeSession(sessionId, 'user-stop')
    await this.#awaitReleased(active)
  }

  async #stopBrowserSession(sessionId: SessionId, signal: AbortSignal): Promise<void> {
    const active = this.#leases.activeSnapshot()
    if (active?.sessionId === sessionId) {
      this.#leases.revokeSession(sessionId, 'user-stop')
      await this.#awaitReleased(active)
      return
    }
    const adapter = this.#options.browser
    if (adapter?.retryPendingCleanup === undefined) return
    const cleared = await adapter.retryPendingCleanup(sessionId, signal)
    if (!cleared) {
      throw new ControlAuthorityError('BUSY', 'browser cleanup still owns the session')
    }
  }

  #forwardAbort(source: AbortSignal, target: AbortController): () => void {
    const abort = (): void => { target.abort(source.reason) }
    if (source.aborted) abort()
    else source.addEventListener('abort', abort, { once: true })
    return () => { source.removeEventListener('abort', abort) }
  }

  async #bounded(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error('Desktop control cleanup timed out.')
        controller.abort(error)
        reject(error)
      }, this.#cleanupTimeoutMs)
      timer.unref()
    })
    try {
      await Promise.race([operation(controller.signal), timeout])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  async #audit(event: ControlAuditEvent): Promise<void> {
    try { await this.#options.audit?.record(event) } catch { /* audit failure cannot expand authority */ }
  }
}
