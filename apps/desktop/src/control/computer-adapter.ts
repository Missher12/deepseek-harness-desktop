import { join } from 'node:path'
import {
  ERROR_CODES,
  PROTOCOL_LIMITS,
  type BridgeRequest,
  type ComputerListResult,
  type ComputerStatusResult,
  type ControlLeaseAcquireRequest,
  type ControlLeaseCapability,
  type ControlLeaseTarget,
  type DecodedDesktopControlEnvelope,
  type DesktopControlControl,
  type DesktopControlErrorCode,
  type HelperRequest,
  type HelperInputReleaseRequest,
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
  stopWhenIdle(): Promise<void>
  recoverInput(
    request: HelperInputReleaseRequest,
    signal?: AbortSignal,
  ): Promise<DecodedDesktopControlEnvelope>
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

export interface ComputerDesktopControlAdapterOptions {
  readonly helper?: ComputerHelperClient | undefined
  readonly available?: boolean | undefined
  readonly capabilities?: readonly ControlLeaseCapability[] | undefined
  readonly factsTimeoutMs?: number | undefined
  readonly cleanupTimeoutMs?: number | undefined
  readonly mintRequestId: () => RequestId
}

interface HeldInputSnapshot {
  readonly sessionId: SessionId
  readonly keys: readonly string[]
  readonly buttons: readonly PointerButton[]
}

const MAX_POSSIBLY_HELD_INPUTS = 64

class ConservativeInputJournal {
  readonly #entries = new Map<string, HeldInputSnapshot>()
  #frozen: HeldInputSnapshot | undefined

  register(request: BridgeRequest): boolean {
    const entry = possibleHeldInput(request)
    if (entry === undefined) return false
    if (this.#frozen !== undefined) throw new ComputerDesktopControlAdapterError('DISCONNECTED')
    this.#entries.set(String(request.requestId), entry)
    const combined = this.combine()
    if (combined.keys.length + combined.buttons.length > MAX_POSSIBLY_HELD_INPUTS) {
      this.#entries.delete(String(request.requestId))
      throw new ComputerDesktopControlAdapterError('TOO_MANY_PENDING')
    }
    return true
  }

  settle(requestId: RequestId): void {
    if (this.#frozen === undefined) this.#entries.delete(String(requestId))
  }

  freeze(): void {
    if (this.#frozen !== undefined || this.#entries.size === 0) return
    this.#frozen = this.combine()
  }

  current(sessionId: SessionId): HeldInputSnapshot | undefined {
    const snapshot = this.#frozen ?? (this.#entries.size === 0 ? undefined : this.combine())
    if (snapshot === undefined || snapshot.sessionId !== sessionId) return undefined
    return snapshot
  }

  frozen(): HeldInputSnapshot | undefined {
    return this.#frozen
  }

  clear(): void {
    this.#entries.clear()
    this.#frozen = undefined
  }

  private combine(): HeldInputSnapshot {
    const entries = [...this.#entries.values()]
    const sessionId = entries[0]?.sessionId
    if (sessionId === undefined || entries.some(entry => entry.sessionId !== sessionId)) {
      throw new ComputerDesktopControlAdapterError('BINARY_MISMATCH')
    }
    return Object.freeze({
      sessionId,
      keys: Object.freeze([...new Set(entries.flatMap(entry => entry.keys))]),
      buttons: Object.freeze([...new Set(entries.flatMap(entry => entry.buttons))]),
    })
  }
}

function possibleHeldInput(request: BridgeRequest): HeldInputSnapshot | undefined {
  switch (request.requestKind) {
    case 'computer.key': return Object.freeze({
      sessionId: request.sessionId,
      keys: Object.freeze([...new Set([request.key, ...request.modifiers])]),
      buttons: Object.freeze([]),
    })
    case 'computer.click': case 'computer.double-click': case 'computer.drag': return Object.freeze({
      sessionId: request.sessionId,
      keys: Object.freeze([]),
      buttons: Object.freeze([request.button]),
    })
    default: return undefined
  }
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
  readonly #available: boolean
  readonly #capabilities: readonly ControlLeaseCapability[]
  readonly #factsTimeoutMs: number
  readonly #cleanupTimeoutMs: number
  readonly #mintRequestId: () => RequestId
  readonly #journal = new ConservativeInputJournal()
  #closed = false
  #leaseActive = false
  #recoveryFailed = false
  #recoveryPromise: Promise<void> | undefined

  constructor(options: ComputerDesktopControlAdapterOptions) {
    this.#helper = options.helper
    this.#available = options.available ?? options.helper !== undefined
    this.#capabilities = Object.freeze([...(options.capabilities ?? OBSERVE_ONLY)])
    this.#factsTimeoutMs = boundedTimeout(options.factsTimeoutMs, DEFAULT_FACTS_TIMEOUT_MS)
    this.#cleanupTimeoutMs = boundedTimeout(options.cleanupTimeoutMs, DEFAULT_CLEANUP_TIMEOUT_MS)
    this.#mintRequestId = options.mintRequestId
  }

  supported(): boolean {
    return !this.#closed && !this.#recoveryFailed && this.#available && this.#helper !== undefined
  }

  async acquireFacts(
    request: ControlLeaseAcquireRequest,
    signal: AbortSignal,
  ): Promise<SurfaceAcquireFacts> {
    const result = await this.list(request.sessionId, signal)
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
    const targetless = request.requestKind === 'computer.status'
      || request.requestKind === 'computer.list'
    return Promise.resolve(Object.freeze({
      surfaceKind: 'native-application',
      targets: target,
      capabilities: this.#capabilities.includes(capability)
        ? Object.freeze([capability])
        : Object.freeze([]),
      policy: adapterPolicyFacts(
        targetless ? 'not-applicable' : 'ordinary',
        readOnly ? 'read-only' : 'local-interaction',
      ),
    }))
  }

  async dispatch(
    request: BridgeRequest,
    context: DesktopControlDispatchContext,
  ): Promise<DecodedDesktopControlEnvelope> {
    throwIfAborted(context.signal)
    const outbound = helperRequest(request, boundedTimeout(context.timeoutMs, context.timeoutMs))
    const journaled = this.#journal.register(request)
    try {
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
    } finally {
      if (journaled) this.#journal.settle(request.requestId)
      if (request.requestKind === 'computer.status' || request.requestKind === 'computer.list') {
        await this.#stopHelperWhenIdle()
      }
    }
  }

  async status(sessionId: SessionId, signal = new AbortController().signal): Promise<ComputerStatusResult> {
    if (this.#journal.frozen() !== undefined) {
      throw new ComputerDesktopControlAdapterError('DISCONNECTED')
    }
    try {
      return await this.#requestOk({
        protocolVersion: 1, messageKind: 'request', requestKind: 'status',
        requestId: this.#mintRequestId(), sessionId, timeoutMs: this.#factsTimeoutMs,
      }, signal) as unknown as ComputerStatusResult
    } finally {
      await this.#stopHelperWhenIdle()
    }
  }

  async list(sessionId: SessionId, signal: AbortSignal): Promise<ComputerListResult> {
    if (this.#journal.frozen() !== undefined) {
      throw new ComputerDesktopControlAdapterError('DISCONNECTED')
    }
    try {
      return await this.#requestOk({
        protocolVersion: 1, messageKind: 'request', requestKind: 'list',
        requestId: this.#mintRequestId(), sessionId, timeoutMs: this.#factsTimeoutMs,
      }, signal) as unknown as ComputerListResult
    } finally {
      await this.#stopHelperWhenIdle()
    }
  }

  /** Freeze the conservative journal synchronously before crash cleanup starts. */
  unexpectedHelperExit(): void {
    this.#journal.freeze()
    this.#leaseActive = false
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
    this.#leaseActive = true
  }

  async rollbackLeaseInstall(snapshot: PreparedLeaseInstall, context: ControlAdapterCallContext): Promise<void> {
    try {
      this.#revoke(snapshot)
      if (this.#requireHelper().running) {
        await this.#stop(snapshot, snapshot.sessionId, context.timeoutMs, context.signal)
      }
    } finally {
      this.#leaseActive = false
      await this.#stopHelperWhenIdle()
    }
  }

  clearQueue(snapshot: ActiveControlLease, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    this.#revoke(snapshot)
    return Promise.resolve()
  }

  async stopLease(snapshot: ActiveControlLease, _reason: string, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const helper = this.#requireHelper()
    try {
      if (helper.running) await this.#stop(snapshot, snapshot.sessionId, this.#cleanupTimeoutMs, signal)
    } finally {
      this.#leaseActive = false
    }
  }

  async releaseKnownInput(snapshot: ActiveControlLease, signal: AbortSignal): Promise<void> {
    try {
      if (this.#journal.frozen() !== undefined) return
      const held = this.#journal.current(snapshot.sessionId)
      if (held === undefined) return
      await this.#releaseWithOwnedHelper(held, signal)
      this.#journal.clear()
    } finally {
      await this.#stopHelperWhenIdle()
    }
  }

  async recoverAfterCrash(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const held = this.#journal.frozen()
    if (held === undefined) return
    if (this.#recoveryPromise === undefined) {
      this.#recoveryPromise = this.#recoverFrozenInput(held, signal)
    }
    const recovery = this.#recoveryPromise
    try {
      await recovery
      this.#recoveryFailed = false
    } catch (error) {
      this.#recoveryFailed = true
      throw error
    } finally {
      if (this.#recoveryPromise === recovery) this.#recoveryPromise = undefined
    }
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

  async #releaseWithOwnedHelper(
    held: HeldInputSnapshot,
    signal: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal)
    const result = await this.#requestOk({
      protocolVersion: 1, messageKind: 'request', requestKind: 'input.release',
      requestId: this.#mintRequestId(), sessionId: held.sessionId,
      timeoutMs: this.#cleanupTimeoutMs, keys: held.keys, buttons: held.buttons,
    }, signal) as { readonly released?: unknown }
    if (result.released !== true) throw new ComputerDesktopControlAdapterError('DISCONNECTED')
  }

  async #recoverFrozenInput(held: HeldInputSnapshot, signal: AbortSignal): Promise<void> {
    const request: HelperInputReleaseRequest = {
      protocolVersion: 1, messageKind: 'request', requestKind: 'input.release',
      requestId: this.#mintRequestId(), sessionId: held.sessionId,
      timeoutMs: this.#cleanupTimeoutMs, keys: held.keys, buttons: held.buttons,
    }
    const helper = this.#helper
    if (helper === undefined) throw new ComputerDesktopControlAdapterError('NOT_SUPPORTED')
    const envelope = await helper.recoverInput(request, signal)
    const response = envelope.message
    if (response.messageKind !== 'response' || response.responseKind !== 'ok'
      || response.requestKind !== 'input.release' || response.requestId !== request.requestId) {
      throw new ComputerDesktopControlAdapterError('DISCONNECTED')
    }
    this.#journal.clear()
  }

  async #stopHelperWhenIdle(): Promise<void> {
    if (!this.#leaseActive) await this.#helper?.stopWhenIdle()
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
