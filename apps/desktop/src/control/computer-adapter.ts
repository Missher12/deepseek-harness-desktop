import { join } from 'node:path'
import {
  ERROR_CODES,
  PROTOCOL_LIMITS,
  type BridgeRequest,
  type ComputerListResult,
  type ControlLeaseAcquireRequest,
  type ControlLeaseCapability,
  type ControlLeaseTarget,
  type DecodedDesktopControlEnvelope,
  type DesktopControlControl,
  type DesktopControlErrorCode,
  type HelperRequest,
  type PointerButton,
  type RequestId,
  type SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type { DesktopControlDispatchContext } from './bridge-server.ts'
import type { ActiveControlLease } from './control-lease.ts'
import type {
  ControlAdapterCallContext,
  DesktopControlSurfaceAdapter,
  PreparedLeaseInstall,
  SurfaceAcquireFacts,
  SurfaceOperationFacts,
} from './control-coordinator.ts'
import { adapterPolicyFacts } from './policy.ts'

const DEFAULT_FACTS_TIMEOUT_MS = 5_000
const DEFAULT_CLEANUP_TIMEOUT_MS = 2_000
const OBSERVE_ONLY = Object.freeze(['observe'] as const)
const NO_TARGETS = Object.freeze([] as readonly ControlLeaseTarget[])
const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES)

/** Minimal native-helper process surface retained by the production adapter. */
export interface ComputerHelperClient {
  readonly running: boolean
  request(request: HelperRequest, signal?: AbortSignal): Promise<DecodedDesktopControlEnvelope>
  sendControl(control: DesktopControlControl): void
  shutdown(): Promise<void>
}

/** Metadata sufficient to reject directories and symbolic links at launch selection time. */
export interface ComputerHelperPathMetadata {
  isFile(): boolean
  isSymbolicLink(): boolean
}

export interface ComputerHelperPathOptions {
  readonly platform: string
  readonly arch: string
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly desktopDirectory: string
  readonly lstat: (path: string) => ComputerHelperPathMetadata
}

/**
 * Task 11 boundary: implementations may return held input only after verifying
 * the exact helper binary hash and platform signing identity for this recovery.
 */
export interface VerifiedComputerInputRecovery {
  verifiedHeldInput(
    snapshot: ActiveControlLease,
    signal: AbortSignal,
  ): Promise<{
    readonly sessionId: SessionId
    readonly keys: readonly string[]
    readonly buttons: readonly PointerButton[]
  } | undefined>
  markReleased(): void
  /** Reverify exact binary bytes/signing identity, use a fresh helper, await release ack, then shut it down. */
  releaseWithFreshVerifiedHelper(signal: AbortSignal): Promise<void>
}

export interface ComputerDesktopControlAdapterOptions {
  readonly helper?: ComputerHelperClient | undefined
  readonly recovery?: VerifiedComputerInputRecovery | undefined
  readonly available?: boolean | undefined
  readonly capabilities?: readonly ControlLeaseCapability[] | undefined
  readonly factsTimeoutMs?: number | undefined
  readonly cleanupTimeoutMs?: number | undefined
  readonly mintRequestId: () => RequestId
}

/** Closed adapter failure shape consumed by the coordinator without exposing provider detail. */
export class ComputerDesktopControlAdapterError extends Error {
  override readonly name = 'ComputerDesktopControlAdapterError'

  constructor(readonly code: DesktopControlErrorCode) {
    super('Native Computer Use request was not completed.')
  }
}

/** Select one exact staged/package helper path and reject missing or indirect filesystem entries. */
export function resolveComputerHelperBinaryPath(options: ComputerHelperPathOptions): string | undefined {
  if (options.arch !== 'x64' || (options.platform !== 'darwin' && options.platform !== 'win32')) {
    return undefined
  }
  const filename = options.platform === 'win32'
    ? 'computer-use-helper.exe'
    : 'computer-use-helper'
  const candidate = options.isPackaged
    ? join(options.resourcesPath, 'native', filename)
    : join(options.desktopDirectory, 'native-bin', `${options.platform}-${options.arch}`, filename)
  try {
    const metadata = options.lstat(candidate)
    return metadata.isFile() && !metadata.isSymbolicLink() ? candidate : undefined
  } catch {
    return undefined
  }
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  const timeout = value ?? fallback
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > PROTOCOL_LIMITS.maxHelperTimeoutMs) {
    throw new TypeError('native helper timeout is invalid')
  }
  return timeout
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ComputerDesktopControlAdapterError('CANCELLED')
}

function freezeTargets(targets: readonly ControlLeaseTarget[]): readonly ControlLeaseTarget[] {
  return Object.freeze(targets.map(target => Object.freeze({
    appId: target.appId,
    windowIds: Object.freeze([...target.windowIds]),
  })))
}

function capabilityFor(request: BridgeRequest): ControlLeaseCapability {
  switch (request.requestKind) {
    case 'computer.type': case 'computer.key': return 'keyboard'
    case 'computer.focus': case 'computer.click': case 'computer.double-click':
    case 'computer.drag': case 'computer.scroll': return 'pointer'
    default: return 'observe'
  }
}

function helperRequest(request: BridgeRequest, timeoutMs: number): HelperRequest {
  const base = {
    protocolVersion: 1 as const,
    messageKind: 'request' as const,
    requestId: request.requestId,
    sessionId: request.sessionId,
    timeoutMs,
  }
  switch (request.requestKind) {
    case 'computer.status': return { ...base, requestKind: 'status' }
    case 'computer.list': return { ...base, requestKind: 'list' }
    case 'computer.snapshot': return {
      ...base, requestKind: 'snapshot', leaseId: request.leaseId,
      leaseRevision: request.leaseRevision, appId: request.appId, windowId: request.windowId,
      snapshotRevision: request.snapshotRevision, includeImage: request.includeImage,
    }
    case 'computer.focus': return {
      ...base, requestKind: 'focus', leaseId: request.leaseId,
      leaseRevision: request.leaseRevision, appId: request.appId, windowId: request.windowId,
      snapshotRevision: request.snapshotRevision,
    }
    case 'computer.click': case 'computer.double-click': {
      const action = request.requestKind === 'computer.click' ? 'click' : 'double-click'
      const target = {
        ...base, requestKind: action, leaseId: request.leaseId,
        leaseRevision: request.leaseRevision, appId: request.appId, windowId: request.windowId,
        snapshotRevision: request.snapshotRevision, button: request.button,
      } as const
      return request.ref === undefined
        ? { ...target, x: request.x, y: request.y }
        : { ...target, ref: request.ref }
    }
    case 'computer.drag': return {
      ...base, requestKind: 'drag', leaseId: request.leaseId,
      leaseRevision: request.leaseRevision, appId: request.appId, windowId: request.windowId,
      snapshotRevision: request.snapshotRevision, fromX: request.fromX, fromY: request.fromY,
      toX: request.toX, toY: request.toY, button: request.button,
    }
    case 'computer.type': return {
      ...base, requestKind: 'type', leaseId: request.leaseId,
      leaseRevision: request.leaseRevision, appId: request.appId, windowId: request.windowId,
      snapshotRevision: request.snapshotRevision, ref: request.ref, text: request.text,
    }
    case 'computer.key': return {
      ...base, requestKind: 'key', leaseId: request.leaseId,
      leaseRevision: request.leaseRevision, appId: request.appId, windowId: request.windowId,
      snapshotRevision: request.snapshotRevision, key: request.key, modifiers: request.modifiers,
    }
    case 'computer.scroll': {
      const target = {
        ...base, requestKind: 'scroll' as const, leaseId: request.leaseId,
        leaseRevision: request.leaseRevision, appId: request.appId, windowId: request.windowId,
        snapshotRevision: request.snapshotRevision, deltaX: request.deltaX, deltaY: request.deltaY,
      }
      return request.ref === undefined
        ? { ...target, x: request.x, y: request.y }
        : { ...target, ref: request.ref }
    }
    case 'computer.wait': return {
      ...base, requestKind: 'wait', leaseId: request.leaseId,
      leaseRevision: request.leaseRevision, appId: request.appId, windowId: request.windowId,
      snapshotRevision: request.snapshotRevision, durationMs: request.durationMs,
    }
    default: throw new ComputerDesktopControlAdapterError('NOT_SUPPORTED')
  }
}

/** Production Electron-main adapter for the closed native-helper roster. */
export class ComputerDesktopControlAdapter implements DesktopControlSurfaceAdapter {
  readonly kind = 'computer' as const
  readonly #helper: ComputerHelperClient | undefined
  readonly #recovery: VerifiedComputerInputRecovery | undefined
  readonly #available: boolean
  readonly #capabilities: readonly ControlLeaseCapability[]
  readonly #factsTimeoutMs: number
  readonly #cleanupTimeoutMs: number
  readonly #mintRequestId: () => RequestId
  #closed = false

  constructor(options: ComputerDesktopControlAdapterOptions) {
    this.#helper = options.helper
    this.#recovery = options.recovery
    this.#available = options.available ?? options.helper !== undefined
    this.#capabilities = Object.freeze([...(options.capabilities ?? OBSERVE_ONLY)])
    this.#factsTimeoutMs = boundedTimeout(options.factsTimeoutMs, DEFAULT_FACTS_TIMEOUT_MS)
    this.#cleanupTimeoutMs = boundedTimeout(options.cleanupTimeoutMs, DEFAULT_CLEANUP_TIMEOUT_MS)
    this.#mintRequestId = options.mintRequestId
  }

  supported(): boolean {
    return !this.#closed && this.#available && this.#helper !== undefined
  }

  async acquireFacts(
    request: ControlLeaseAcquireRequest,
    signal: AbortSignal,
  ): Promise<SurfaceAcquireFacts> {
    const result = await this.#requestOk({
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'list',
      requestId: this.#mintRequestId(),
      sessionId: request.sessionId,
      timeoutMs: this.#factsTimeoutMs,
    }, signal) as unknown as ComputerListResult
    const grantable = new Map(result.apps.map(application => [
      application.appId,
      new Set(application.windows.map(window => window.windowId)),
    ]))
    const targets = request.targets.flatMap((target) => {
      const windows = grantable.get(target.appId)
      if (windows === undefined) return []
      const windowIds = target.windowIds.filter(windowId => windows.has(windowId))
      return windowIds.length === 0 ? [] : [{ appId: target.appId, windowIds }]
    })
    const capabilities = request.capabilities.filter(capability => this.#capabilities.includes(capability))
    return Object.freeze({
      surfaceKind: 'native-application',
      targets: freezeTargets(targets),
      capabilities: Object.freeze(capabilities),
      policyAllowed: true,
    })
  }

  operationFacts(request: BridgeRequest, signal: AbortSignal): Promise<SurfaceOperationFacts> {
    throwIfAborted(signal)
    const capability = capabilityFor(request)
    const target = 'appId' in request && 'windowId' in request
      ? freezeTargets([{ appId: request.appId, windowIds: [request.windowId] }])
      : NO_TARGETS
    const readOnly = request.requestKind === 'computer.status'
      || request.requestKind === 'computer.list'
      || request.requestKind === 'computer.snapshot'
      || request.requestKind === 'computer.wait'
    return Promise.resolve(Object.freeze({
      surfaceKind: 'native-application',
      targets: target,
      capabilities: this.#capabilities.includes(capability)
        ? Object.freeze([capability])
        : Object.freeze([]),
      policy: adapterPolicyFacts('ordinary', readOnly ? 'read-only' : 'local-interaction'),
    }))
  }

  async dispatch(
    request: BridgeRequest,
    context: DesktopControlDispatchContext,
  ): Promise<DecodedDesktopControlEnvelope> {
    throwIfAborted(context.signal)
    const outbound = helperRequest(request, boundedTimeout(context.timeoutMs, context.timeoutMs))
    const envelope = await this.#requireHelper().request(outbound, context.signal)
    const response = envelope.message
    if (response.messageKind !== 'response' || response.requestId !== outbound.requestId
      || response.requestKind !== outbound.requestKind) {
      throw new ComputerDesktopControlAdapterError('DISCONNECTED')
    }
    return Object.freeze({
      message: Object.freeze({ ...response, requestKind: request.requestKind }),
      ...(envelope.png === undefined ? {} : { png: envelope.png }),
    }) as DecodedDesktopControlEnvelope
  }

  async installLease(snapshot: PreparedLeaseInstall, context: ControlAdapterCallContext): Promise<void> {
    const result = await this.#requestOk({
      protocolVersion: 1, messageKind: 'request', requestKind: 'lease.install',
      requestId: this.#mintRequestId(), sessionId: snapshot.sessionId,
      timeoutMs: boundedTimeout(context.timeoutMs, context.timeoutMs),
      leaseId: snapshot.leaseId, leaseRevision: snapshot.leaseRevision,
      agentId: snapshot.agentId, targets: snapshot.targets, capabilities: snapshot.capabilities,
      quotas: snapshot.quotas, idleExpiresAfterMs: snapshot.idleExpiresAfterMs,
      hardExpiresAfterMs: snapshot.hardExpiresAfterMs,
    }, context.signal) as { readonly installed?: unknown; readonly leaseRevision?: unknown }
    if (result.installed !== true || result.leaseRevision !== snapshot.leaseRevision) {
      throw new ComputerDesktopControlAdapterError('DISCONNECTED')
    }
  }

  async rollbackLeaseInstall(snapshot: PreparedLeaseInstall, context: ControlAdapterCallContext): Promise<void> {
    this.#revoke(snapshot)
    if (!this.#requireHelper().running) return
    await this.#stop(snapshot, snapshot.sessionId, context.timeoutMs, context.signal)
  }

  clearQueue(snapshot: ActiveControlLease, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    this.#revoke(snapshot)
    return Promise.resolve()
  }

  async stopLease(snapshot: ActiveControlLease, _reason: string, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const helper = this.#requireHelper()
    if (!helper.running) return
    await this.#stop(snapshot, snapshot.sessionId, this.#cleanupTimeoutMs, signal)
  }

  async releaseKnownInput(snapshot: ActiveControlLease, signal: AbortSignal): Promise<void> {
    await this.#releaseVerifiedInput(snapshot, signal)
  }

  async recoverAfterCrash(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    await this.#recovery?.releaseWithFreshVerifiedHelper(signal)
  }

  async shutdown(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    this.#closed = true
    await this.#helper?.shutdown()
  }

  async #stop(
    snapshot: Pick<PreparedLeaseInstall, 'leaseId' | 'leaseRevision'>,
    sessionId: SessionId,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    const result = await this.#requestOk({
      protocolVersion: 1, messageKind: 'request', requestKind: 'stop',
      requestId: this.#mintRequestId(), sessionId,
      timeoutMs: boundedTimeout(timeoutMs, timeoutMs),
      leaseId: snapshot.leaseId, leaseRevision: snapshot.leaseRevision,
    }, signal) as { readonly stopped?: unknown }
    if (result.stopped !== true) throw new ComputerDesktopControlAdapterError('DISCONNECTED')
  }

  #revoke(snapshot: Pick<ActiveControlLease, 'sessionId' | 'leaseId' | 'leaseRevision'>): void {
    this.#helper?.sendControl({
      protocolVersion: 1, messageKind: 'control', controlKind: 'lease.revoke',
      sessionId: snapshot.sessionId, leaseId: snapshot.leaseId,
      leaseRevision: snapshot.leaseRevision,
    })
  }

  async #releaseVerifiedInput(
    snapshot: ActiveControlLease,
    signal: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal)
    const recovery = this.#recovery
    if (recovery === undefined) return
    const held = await recovery.verifiedHeldInput(snapshot, signal)
    if (held === undefined) return
    if (held.sessionId !== snapshot.sessionId) {
      throw new ComputerDesktopControlAdapterError('BINARY_MISMATCH')
    }
    const result = await this.#requestOk({
      protocolVersion: 1, messageKind: 'request', requestKind: 'input.release',
      requestId: this.#mintRequestId(), sessionId: held.sessionId,
      timeoutMs: this.#cleanupTimeoutMs, keys: held.keys, buttons: held.buttons,
    }, signal) as { readonly released?: unknown }
    if (result.released !== true) throw new ComputerDesktopControlAdapterError('DISCONNECTED')
    recovery.markReleased()
  }

  async #requestOk(request: HelperRequest, signal: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    throwIfAborted(signal)
    const envelope = await this.#requireHelper().request(request, signal)
    const response = envelope.message
    if (response.messageKind !== 'response' || response.requestId !== request.requestId
      || response.requestKind !== request.requestKind) {
      throw new ComputerDesktopControlAdapterError('DISCONNECTED')
    }
    if (response.responseKind === 'error') {
      const code = ERROR_CODE_SET.has(response.error.code) ? response.error.code : 'INTERNAL'
      throw new ComputerDesktopControlAdapterError(code)
    }
    return response.result as unknown as Readonly<Record<string, unknown>>
  }

  #requireHelper(): ComputerHelperClient {
    if (!this.supported() || this.#helper === undefined) {
      throw new ComputerDesktopControlAdapterError('NOT_SUPPORTED')
    }
    return this.#helper
  }
}
