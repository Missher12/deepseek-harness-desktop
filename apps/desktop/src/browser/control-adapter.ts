import type {
  BridgeRequest,
  ControlLeaseAcquireRequest,
  ControlLeaseCapability,
  ControlLeaseSurfaceKind,
  DecodedDesktopControlEnvelope,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type { DesktopControlDispatchContext } from '../control/bridge-server.ts'
import type { ActiveControlLease } from '../control/control-lease.ts'
import type {
  DesktopControlSurfaceAdapter,
  ControlAdapterCallContext,
  PreparedLeaseInstall,
  SurfaceAcquireFacts,
  SurfaceOperationFacts,
} from '../control/control-coordinator.ts'
import { adapterPolicyFacts } from '../control/policy.ts'
import type { AgentBrowserAction, AgentBrowserSnapshotEnvelope } from './contracts.ts'
import { AgentBrowserError, toAgentBrowserRef } from './contracts.ts'
import type {
  BrowserFailedMountCleanupRequest,
  BrowserSurfaceManager,
  BrowserSurfaceMount,
} from './surface-manager.ts'

const BROWSER_CAPABILITIES = Object.freeze([
  'observe', 'pointer', 'keyboard',
] as const satisfies readonly ControlLeaseCapability[])

/** Narrow semantic adapter face retained by the Desktop coordinator adapter. */
export interface BrowserSemanticControl {
  start(signal?: AbortSignal): Promise<void>
  snapshot(
    request: { readonly includeImage: boolean },
    signal?: AbortSignal,
  ): Promise<AgentBrowserSnapshotEnvelope>
  act(action: AgentBrowserAction, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>
  stop(): Promise<void>
  currentSnapshotRevision(): number
}

/** One generation's semantic adapter plus its independently owned hostname tunnel. */
export interface ActivatedBrowserControl {
  readonly semantic: BrowserSemanticControl
  readonly disposeTransport: () => Promise<void>
}

export interface BrowserDesktopControlAdapterOptions {
  readonly surfaceManager: Pick<
    BrowserSurfaceManager,
    'acquire' | 'stop' | 'release' | 'failedMountCleanupFor' | 'retryFailedMountCleanup'
  >
  readonly activate: (mount: BrowserSurfaceMount) => Promise<ActivatedBrowserControl>
}

interface ActiveBrowserControl extends ActivatedBrowserControl {
  readonly mount: BrowserSurfaceMount
  readonly cleanup: BrowserCleanupLedger
}

interface PendingActivation {
  readonly sessionId: string
  readonly promise: Promise<ActiveBrowserControl>
}

interface BrowserCleanupStep {
  readonly run: () => Promise<void>
  readonly release?: true
}

interface BrowserCleanupLedger {
  readonly sessionId: string
  readonly surfaceKind?: ControlLeaseSurfaceKind
  steps: readonly BrowserCleanupStep[]
  started: boolean
  pending?: Promise<void>
}

function surfaceKind(mount: BrowserSurfaceMount): ControlLeaseSurfaceKind {
  return mount.kind === 'ephemeral' ? 'browser-ephemeral' : 'browser-human-persistent'
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AgentBrowserError('CANCELLED', 'browser operation was cancelled')
}

function browserAction(request: BridgeRequest): AgentBrowserAction {
  switch (request.requestKind) {
    case 'browser.navigate': return { kind: 'navigate', url: request.url }
    case 'browser.click': return { kind: 'click', ref: toAgentBrowserRef(request.ref) }
    case 'browser.type': return { kind: 'type', ref: toAgentBrowserRef(request.ref), text: request.text }
    case 'browser.key': return { kind: 'key', key: request.key, modifiers: request.modifiers }
    case 'browser.select': return { kind: 'select', ref: toAgentBrowserRef(request.ref), value: request.value }
    case 'browser.scroll': return request.ref === undefined
      ? { kind: 'scroll', deltaX: request.deltaX, deltaY: request.deltaY }
      : { kind: 'scroll', ref: toAgentBrowserRef(request.ref), deltaX: request.deltaX, deltaY: request.deltaY }
    case 'browser.wait': return request.mode === 'duration'
      ? { kind: 'wait', mode: 'duration', durationMs: request.durationMs }
      : { kind: 'wait', mode: request.mode }
    case 'browser.back': return { kind: 'back' }
    case 'browser.forward': return { kind: 'forward' }
    case 'browser.reload': return { kind: 'reload' }
    default: throw new AgentBrowserError('POLICY_DENIED', 'browser action is not allowed')
  }
}

function okEnvelope(
  request: BridgeRequest,
  result: Readonly<Record<string, unknown>>,
  png?: Uint8Array,
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
    ...(png === undefined ? {} : { png: new Uint8Array(png) }),
  }) as unknown as DecodedDesktopControlEnvelope
}

/** Electron-main adapter that binds one manager generation to the coordinator's browser surface seam. */
export class BrowserDesktopControlAdapter implements DesktopControlSurfaceAdapter {
  readonly kind = 'browser' as const
  private readonly surfaceManager: BrowserDesktopControlAdapterOptions['surfaceManager']
  private readonly activate: BrowserDesktopControlAdapterOptions['activate']
  private active: ActiveBrowserControl | undefined
  private pending: PendingActivation | undefined
  private cleanupLedger: BrowserCleanupLedger | undefined
  private closed = false

  constructor(options: BrowserDesktopControlAdapterOptions) {
    this.surfaceManager = options.surfaceManager
    this.activate = options.activate
  }

  supported(): boolean { return !this.closed }

  async acquireFacts(
    request: ControlLeaseAcquireRequest,
    signal: AbortSignal,
  ): Promise<SurfaceAcquireFacts> {
    const active = await this.acquire(request.sessionId, signal)
    return Object.freeze({
      surfaceKind: surfaceKind(active.mount),
      targets: Object.freeze([]),
      capabilities: BROWSER_CAPABILITIES,
      policyAllowed: true,
    })
  }

  async operationFacts(request: BridgeRequest, signal: AbortSignal): Promise<SurfaceOperationFacts> {
    const active = this.assertOwner(request.sessionId)
    throwIfAborted(signal)
    await this.surfaceManager.acquire({
      sessionId: request.sessionId,
      expectedGeneration: active.mount.generation,
      signal,
    })
    throwIfAborted(signal)
    const readOnly = request.requestKind === 'browser.snapshot' || request.requestKind === 'browser.wait'
    return Object.freeze({
      surfaceKind: surfaceKind(active.mount),
      targets: Object.freeze([]),
      capabilities: BROWSER_CAPABILITIES,
      policy: adapterPolicyFacts('ordinary', readOnly ? 'read-only' : 'local-interaction'),
      browserAction: Object.freeze({
        surfaceId: active.mount.surfaceId,
        navigationRevision: active.semantic.currentSnapshotRevision(),
      }),
    })
  }

  async dispatch(
    request: BridgeRequest,
    context: DesktopControlDispatchContext,
  ): Promise<DecodedDesktopControlEnvelope> {
    const active = this.assertOwner(request.sessionId)
    throwIfAborted(context.signal)
    if (request.requestKind === 'browser.snapshot') {
      const envelope = await active.semantic.snapshot({ includeImage: request.includeImage }, context.signal)
      return okEnvelope(request, envelope.result as unknown as Readonly<Record<string, unknown>>, envelope.png)
    }
    const result = await active.semantic.act(browserAction(request), context.signal)
    return okEnvelope(request, result)
  }

  async rollbackLeaseInstall(
    snapshot: PreparedLeaseInstall,
    context: ControlAdapterCallContext,
  ): Promise<void> {
    throwIfAborted(context.signal)
    const cleanup = this.cleanupLedger
    if (cleanup === undefined) return
    if (cleanup.surfaceKind !== undefined && cleanup.surfaceKind !== snapshot.surfaceKind) {
      throw new AgentBrowserError('STALE_REF', 'browser rollback surface no longer matches')
    }
    await this.cleanup(cleanup)
  }

  async retryPendingCleanup(sessionId: string, signal: AbortSignal): Promise<boolean> {
    throwIfAborted(signal)
    const cleanup = this.cleanupLedger
    if (cleanup === undefined) return true
    if (cleanup.sessionId !== sessionId) {
      throw new AgentBrowserError('BUSY', 'another session owns browser cleanup')
    }
    await this.cleanup(cleanup)
    return this.cleanupLedger !== cleanup
  }

  clearQueue(_snapshot: ActiveControlLease, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    return Promise.resolve()
  }

  async stopLease(snapshot: ActiveControlLease, _reason: string, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const cleanup = this.cleanupLedger
    if (cleanup === undefined || cleanup.sessionId !== snapshot.sessionId) return
    if (cleanup.surfaceKind !== undefined && cleanup.surfaceKind !== snapshot.surfaceKind) {
      throw new AgentBrowserError('STALE_REF', 'browser lease surface no longer matches')
    }
    await this.cleanup(cleanup)
  }

  async shutdown(signal: AbortSignal): Promise<void> {
    this.closed = true
    throwIfAborted(signal)
    const cleanup = this.cleanupLedger
    if (cleanup !== undefined) await this.cleanup(cleanup)
  }

  private async acquire(sessionId: string, signal: AbortSignal): Promise<ActiveBrowserControl> {
    if (this.closed) throw new AgentBrowserError('TARGET_CLOSED', 'browser control is closed')
    const current = this.active
    if (current !== undefined) {
      if (current.mount.sessionId !== sessionId) {
        throw new AgentBrowserError('BUSY', 'another session owns the Agent browser surface')
      }
      if (current.cleanup.started) throw new AgentBrowserError('BUSY', 'browser cleanup is in progress')
      await this.surfaceManager.acquire({
        sessionId,
        expectedGeneration: current.mount.generation,
        signal,
      })
      throwIfAborted(signal)
      return current
    }
    const pending = this.pending
    if (pending !== undefined) {
      if (pending.sessionId !== sessionId) {
        throw new AgentBrowserError('BUSY', 'another session is opening the Agent browser surface')
      }
      return await pending.promise
    }
    if (this.cleanupLedger !== undefined) {
      throw new AgentBrowserError('BUSY', 'browser cleanup is in progress')
    }
    const promise = this.activateSurface(sessionId, signal)
    this.pending = { sessionId, promise }
    try {
      return await promise
    } finally {
      if (this.pending.promise === promise) this.pending = undefined
    }
  }

  private async activateSurface(sessionId: string, signal: AbortSignal): Promise<ActiveBrowserControl> {
    let mount: BrowserSurfaceMount
    try {
      mount = await this.surfaceManager.acquire({ sessionId, signal })
    } catch (error) {
      const failed = this.surfaceManager.failedMountCleanupFor(sessionId)
      if (failed !== undefined) {
        this.cleanupLedger ??= this.createFailedMountCleanupLedger(failed)
      }
      throw error
    }
    let activated: ActivatedBrowserControl | undefined
    let cleanup: BrowserCleanupLedger | undefined
    try {
      throwIfAborted(signal)
      activated = await this.activate(mount)
      cleanup = this.createCleanupLedger(mount, activated)
      this.cleanupLedger = cleanup
      await activated.semantic.start(signal)
      throwIfAborted(signal)
      const active: ActiveBrowserControl = { mount, ...activated, cleanup }
      this.active = active
      return active
    } catch (error) {
      cleanup ??= this.createCleanupLedger(mount, activated)
      this.cleanupLedger ??= cleanup
      try { await this.cleanup(cleanup) } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'browser activation cleanup failed')
      }
      throw error
    }
  }

  private assertOwner(sessionId: string): ActiveBrowserControl {
    const active = this.active
    if (active === undefined) throw new AgentBrowserError('TARGET_CLOSED', 'browser surface is unavailable')
    if (active.mount.sessionId !== sessionId) {
      throw new AgentBrowserError('BUSY', 'another session owns the Agent browser surface')
    }
    if (active.cleanup.started) throw new AgentBrowserError('BUSY', 'browser cleanup is in progress')
    return active
  }

  private createCleanupLedger(
    mount: BrowserSurfaceMount,
    activated: ActivatedBrowserControl | undefined,
  ): BrowserCleanupLedger {
    return {
      sessionId: mount.sessionId,
      surfaceKind: surfaceKind(mount),
      started: false,
      steps: [
        ...activated === undefined ? [] : [
          { run: () => activated.semantic.stop() },
          { run: activated.disposeTransport },
        ],
        { run: () => this.surfaceManager.stop(mount) },
        { release: true, run: () => this.surfaceManager.release(mount) },
      ],
    }
  }

  private createFailedMountCleanupLedger(
    failed: BrowserFailedMountCleanupRequest,
  ): BrowserCleanupLedger {
    return {
      sessionId: failed.sessionId,
      started: false,
      steps: [{ run: () => this.surfaceManager.retryFailedMountCleanup(failed) }],
    }
  }

  private async cleanup(cleanup: BrowserCleanupLedger): Promise<void> {
    cleanup.started = true
    const pending = cleanup.pending
    if (pending !== undefined) {
      await pending
      return
    }
    const operation = this.runCleanup(cleanup)
    cleanup.pending = operation
    try { await operation } finally { if (cleanup.pending === operation) delete cleanup.pending }
  }

  private async runCleanup(cleanup: BrowserCleanupLedger): Promise<void> {
    const remaining: BrowserCleanupStep[] = []
    const failures: unknown[] = []
    for (const step of cleanup.steps) {
      if (step.release === true && failures.length > 0) {
        remaining.push(step)
        continue
      }
      try { await step.run() } catch (error) { failures.push(error); remaining.push(step) }
    }
    cleanup.steps = remaining
    if (failures.length > 0) throw new AggregateError(failures, 'browser control cleanup failed')
    if (cleanup.steps.length > 0) throw new AgentBrowserError('INTERNAL', 'browser release was deferred')
    if (this.active?.cleanup === cleanup) this.active = undefined
    if (this.cleanupLedger === cleanup) this.cleanupLedger = undefined
  }
}
