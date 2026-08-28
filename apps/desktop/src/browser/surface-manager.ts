import { randomUUID } from 'node:crypto'
import {
  AGENT_BROWSER_PARTITION_PREFIX,
  AgentBrowserError,
  WORKBENCH_BROWSER_PARTITION,
} from './contracts.ts'

/** Generation-owned browser resource created or transferred by Electron main. */
export interface BrowserSurfaceResource {
  readonly surfaceId: string
  readonly partition: string
  readonly kind: 'ephemeral' | 'human-persistent'
  installSecurityHandlers(generation: number): { dispose(): void }
  mount(mountToken: string): Promise<void>
  commitTransfer(): Promise<void>
  hide(mountToken: string): Promise<void>
  detachDebugger(): Promise<void>
  teardownView(): Promise<void>
  clearStorage(): Promise<void>
  releaseTransfer(): Promise<void>
}

/** Trusted coordinator seam; renderer state never enters this interface. */
export interface BrowserSurfaceCoordinator {
  consumeVerifiedPersistentGiveIntent(sessionId: string): Promise<BrowserSurfaceResource | undefined>
  revoke(sessionId: string, generation: number): Promise<boolean>
  release(sessionId: string, generation: number): Promise<void>
}

/** Exact request used to create one non-persistent session-owned surface. */
export interface CreateEphemeralBrowserSurfaceRequest {
  readonly sessionId: string
  readonly generation: number
  readonly partition: string
}

/** Trusted provider owner tuple; a generation is mandatory for reuse. */
export interface BrowserSurfaceAcquireRequest {
  readonly sessionId: string
  readonly expectedGeneration?: number
}

/** Exact generation and mount token required by hide and Stop. */
export interface BrowserSurfaceToken {
  readonly sessionId: string
  readonly generation: number
  readonly mountToken: string
}

/** Trusted lifecycle identity for retrying only a failed, never-published mount generation. */
export interface BrowserFailedMountCleanupRequest {
  readonly sessionId: string
  readonly generation: number
}

/** Visible surface descriptor returned only after the mount completes. */
export interface BrowserSurfaceMount extends BrowserSurfaceToken {
  readonly surfaceId: string
  readonly partition: string
  readonly kind: BrowserSurfaceResource['kind']
  readonly visible: true
}

/** BrowserSurfaceManager construction dependencies. */
export interface BrowserSurfaceManagerOptions {
  readonly coordinator: BrowserSurfaceCoordinator
  readonly createEphemeral: (request: CreateEphemeralBrowserSurfaceRequest) => Promise<BrowserSurfaceResource>
  readonly createNonce?: () => string
  readonly createMountToken?: (generation: number) => string
}

interface ActiveSurface {
  readonly mount: BrowserSurfaceMount
  readonly resource: BrowserSurfaceResource
  readonly handlers: { dispose(): void }
  cleanup?: SurfaceCleanupLedger
}

interface PendingSurface {
  readonly sessionId: string
  readonly generation: number
  readonly promise: Promise<BrowserSurfaceMount>
}

interface CleanupOperation {
  run(): Promise<void>
  readonly phase: 'stop' | 'release'
}

interface SurfaceCleanupLedger {
  readonly sessionId: string
  readonly generation: number
  operations: readonly CleanupOperation[]
  pending?: Promise<void>
}

function nonEmpty(value: string, label: string): void {
  if (value.length === 0 || new TextEncoder().encode(value).byteLength > 256) {
    throw new AgentBrowserError('INTERNAL', `${label} is invalid`)
  }
}

/** Process-wide owner of the single visible Agent browser surface. */
export class BrowserSurfaceManager {
  private readonly coordinator: BrowserSurfaceCoordinator
  private readonly createEphemeral: BrowserSurfaceManagerOptions['createEphemeral']
  private readonly createNonce: () => string
  private readonly createMountToken: (generation: number) => string
  private nextGeneration = 1
  private active: ActiveSurface | undefined
  private pending: PendingSurface | undefined
  private failedMountCleanup: SurfaceCleanupLedger | undefined

  constructor(options: BrowserSurfaceManagerOptions) {
    this.coordinator = options.coordinator
    this.createEphemeral = options.createEphemeral
    this.createNonce = options.createNonce ?? randomUUID
    this.createMountToken = options.createMountToken ?? (() => randomUUID())
  }

  /** Atomically reserve, create or transfer, secure, and visibly mount the official session's surface. */
  async acquire(request: BrowserSurfaceAcquireRequest): Promise<BrowserSurfaceMount> {
    nonEmpty(request.sessionId, 'browser owner session')
    if (this.failedMountCleanup !== undefined) {
      throw new AgentBrowserError('BUSY', 'a failed browser surface generation still owns cleanup')
    }
    const active = this.active
    if (active !== undefined) {
      if (active.mount.sessionId !== request.sessionId) {
        throw new AgentBrowserError('BUSY', 'another session owns the Agent browser surface')
      }
      if (active.cleanup !== undefined) throw new AgentBrowserError('BUSY', 'browser surface cleanup is in progress')
      if (request.expectedGeneration !== active.mount.generation) {
        throw new AgentBrowserError('STALE_REF', 'browser surface generation does not match')
      }
      return active.mount
    }
    const pending = this.pending
    if (pending !== undefined) {
      if (pending.sessionId !== request.sessionId) {
        throw new AgentBrowserError('BUSY', 'another session is opening the Agent browser surface')
      }
      if (request.expectedGeneration !== undefined && request.expectedGeneration !== pending.generation) {
        throw new AgentBrowserError('STALE_REF', 'browser surface generation does not match')
      }
      return await pending.promise
    }
    if (request.expectedGeneration !== undefined) {
      throw new AgentBrowserError('STALE_REF', 'browser surface no longer exists')
    }
    const generation = this.takeGeneration()
    const promise = this.createAndMount(request.sessionId, generation)
    this.pending = { sessionId: request.sessionId, generation, promise }
    void promise.finally(() => {
      if (this.pending?.promise === promise) this.pending = undefined
    }).catch(() => {
      // The original acquire promise carries the creation failure to every waiter.
    })
    return await promise
  }

  /** Hide only the exact current owner token; stale callbacks are harmless. */
  async hide(token: BrowserSurfaceToken): Promise<boolean> {
    const active = this.active
    if (active === undefined || active.mount.generation !== token.generation
      || active.mount.mountToken !== token.mountToken) return false
    if (active.mount.sessionId !== token.sessionId) {
      throw new AgentBrowserError('BUSY', 'another session owns the Agent browser surface')
    }
    if (active.cleanup !== undefined) return false
    await active.resource.hide(token.mountToken)
    return true
  }

  /** Run retryable non-release cleanup for the exact owner while retaining the slot. */
  async stop(token: BrowserSurfaceToken): Promise<void> {
    const active = this.active
    if (active === undefined || active.mount.generation !== token.generation
      || active.mount.mountToken !== token.mountToken) return
    if (active.mount.sessionId !== token.sessionId) {
      throw new AgentBrowserError('BUSY', 'another session owns the Agent browser surface')
    }
    active.cleanup ??= this.createCleanupLedger(active)
    await this.runCleanupLedger(active.cleanup, false)
  }

  /** Release only an exactly stopped owner after every preceding cleanup step succeeded. */
  async release(token: BrowserSurfaceToken): Promise<void> {
    const active = this.active
    if (active === undefined || active.mount.generation !== token.generation
      || active.mount.mountToken !== token.mountToken) return
    if (active.mount.sessionId !== token.sessionId) {
      throw new AgentBrowserError('BUSY', 'another session owns the Agent browser surface')
    }
    const cleanup = active.cleanup
    if (cleanup === undefined || cleanup.operations.some(operation => operation.phase === 'stop')) {
      throw new AgentBrowserError('BUSY', 'browser surface has not reached release')
    }
    await this.runCleanupLedger(cleanup, true)
    if (cleanup.operations.length !== 0) {
      throw new AgentBrowserError('INTERNAL', 'browser surface release did not reach quiescence')
    }
    if (this.active === active) this.active = undefined
  }

  /** Retry only the failed cleanup steps for an exact unpublished owner generation. */
  async retryFailedMountCleanup(request: BrowserFailedMountCleanupRequest): Promise<void> {
    nonEmpty(request.sessionId, 'browser cleanup owner session')
    const failed = this.failedMountCleanup
    if (failed === undefined) return
    if (failed.sessionId !== request.sessionId) {
      throw new AgentBrowserError('BUSY', 'another session owns the failed browser surface cleanup')
    }
    if (failed.generation !== request.generation) {
      throw new AgentBrowserError('STALE_REF', 'browser cleanup generation does not match')
    }
    await this.runCleanupLedger(failed, true)
    if (this.failedMountCleanup === failed) this.failedMountCleanup = undefined
  }

  /** Return only the exact unpublished cleanup identity owned by this trusted session. */
  failedMountCleanupFor(sessionId: string): BrowserFailedMountCleanupRequest | undefined {
    const failed = this.failedMountCleanup
    if (failed === undefined || failed.sessionId !== sessionId) return undefined
    return Object.freeze({ sessionId: failed.sessionId, generation: failed.generation })
  }

  private async createAndMount(sessionId: string, generation: number): Promise<BrowserSurfaceMount> {
    let resource: BrowserSurfaceResource | undefined
    let handlers: { dispose(): void } | undefined
    try {
      resource = await this.coordinator.consumeVerifiedPersistentGiveIntent(sessionId)
      if (resource === undefined) {
        const nonce = this.createNonce()
        if (!/^[A-Za-z\d._-]{1,64}$/u.test(nonce)) {
          throw new AgentBrowserError('INTERNAL', 'browser partition nonce is invalid')
        }
        const partition = `${AGENT_BROWSER_PARTITION_PREFIX}${generation}-${nonce}`
        resource = await this.createEphemeral({ sessionId, generation, partition })
        if (resource.kind !== 'ephemeral' || resource.partition !== partition || resource.partition.startsWith('persist:')) {
          throw new AgentBrowserError('INTERNAL', 'ephemeral browser surface is invalid')
        }
      } else if (resource.kind !== 'human-persistent' || resource.partition !== WORKBENCH_BROWSER_PARTITION) {
        throw new AgentBrowserError('INTERNAL', 'persistent Give intent surface is invalid')
      }
      nonEmpty(resource.surfaceId, 'browser surface id')
      const mountToken = this.createMountToken(generation)
      nonEmpty(mountToken, 'browser mount token')
      handlers = resource.installSecurityHandlers(generation)
      await resource.mount(mountToken)
      await resource.commitTransfer()
      const mount = Object.freeze({
        sessionId,
        surfaceId: resource.surfaceId,
        generation,
        mountToken,
        partition: resource.partition,
        kind: resource.kind,
        visible: true as const,
      })
      this.active = { mount, resource, handlers }
      return mount
    } catch (error) {
      const cleanup = this.createFailedMountCleanup(resource, handlers, sessionId, generation)
      try { await this.runCleanupLedger(cleanup, true) } catch { /* retained below */ }
      if (cleanup.operations.length > 0) {
        this.failedMountCleanup = cleanup
        throw new AgentBrowserError('INTERNAL', 'browser surface mount cleanup did not reach quiescence')
      }
      if (error instanceof AgentBrowserError) throw error
      throw new AgentBrowserError('INTERNAL', 'browser surface could not be mounted')
    }
  }

  private createCleanupLedger(active: ActiveSurface): SurfaceCleanupLedger {
    let ownerRevoked = false
    return {
      sessionId: active.mount.sessionId,
      generation: active.mount.generation,
      operations: [
        { phase: 'stop', run: () => Promise.resolve().then(() => { active.handlers.dispose() }) },
        { phase: 'stop', run: () => active.resource.detachDebugger() },
        { phase: 'stop', run: () => active.resource.teardownView() },
        ...active.resource.kind === 'ephemeral'
          ? [{ phase: 'stop' as const, run: () => active.resource.clearStorage() }]
          : [],
        {
          phase: 'stop',
          run: async () => {
            ownerRevoked = await this.coordinator.revoke(active.mount.sessionId, active.mount.generation)
          },
        },
        { phase: 'release', run: () => active.resource.releaseTransfer() },
        {
          phase: 'release',
          run: async () => {
            if (ownerRevoked) {
              await this.coordinator.release(active.mount.sessionId, active.mount.generation)
            }
          },
        },
      ],
    }
  }

  private createFailedMountCleanup(
    resource: BrowserSurfaceResource | undefined,
    handlers: { dispose(): void } | undefined,
    sessionId: string,
    generation: number,
  ): SurfaceCleanupLedger {
    let ownerRevoked = false
    return { sessionId, generation, operations: [
      ...handlers === undefined ? [] : [{
        phase: 'stop' as const,
        run: () => Promise.resolve().then(() => { handlers.dispose() }),
      }],
      ...resource === undefined ? [] : [
        { phase: 'stop' as const, run: () => resource.detachDebugger() },
        { phase: 'stop' as const, run: () => resource.teardownView() },
        ...resource.kind === 'ephemeral'
          ? [{ phase: 'stop' as const, run: () => resource.clearStorage() }]
          : [],
      ],
      { phase: 'stop', run: async () => {
        ownerRevoked = await this.coordinator.revoke(sessionId, generation)
      } },
      ...resource === undefined ? [] : [{
        phase: 'release' as const,
        run: () => resource.releaseTransfer(),
      }],
      { phase: 'release', run: async () => {
        if (ownerRevoked) await this.coordinator.release(sessionId, generation)
      } },
    ] }
  }

  private async runCleanupLedger(ledger: SurfaceCleanupLedger, allowRelease: boolean): Promise<void> {
    const pending = ledger.pending
    if (pending !== undefined) {
      await pending
      if (allowRelease && ledger.operations.length > 0) await this.runCleanupLedger(ledger, true)
      return
    }
    const operation = this.runCleanupOperations(ledger, allowRelease)
    ledger.pending = operation
    try { await operation } finally { if (ledger.pending === operation) delete ledger.pending }
  }

  private async runCleanupOperations(ledger: SurfaceCleanupLedger, allowRelease: boolean): Promise<void> {
    const failed: CleanupOperation[] = []
    let priorFailure = false
    for (const operation of ledger.operations) {
      if (operation.phase === 'release' && (!allowRelease || priorFailure)) {
        failed.push(operation)
        continue
      }
      try {
        await operation.run()
      } catch {
        failed.push(operation)
        priorFailure = true
      }
    }
    ledger.operations = failed
    if (priorFailure) {
      throw new AgentBrowserError('INTERNAL', 'browser surface cleanup did not reach quiescence')
    }
  }

  private takeGeneration(): number {
    const generation = this.nextGeneration
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new AgentBrowserError('INTERNAL', 'browser surface generation is exhausted')
    }
    this.nextGeneration += 1
    return generation
  }
}
