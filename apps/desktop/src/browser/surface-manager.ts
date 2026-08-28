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
  hide(mountToken: string): Promise<void>
  detachDebugger(): Promise<void>
  teardownView(): Promise<void>
  clearStorage(): Promise<void>
}

/** Trusted coordinator seam; renderer state never enters this interface. */
export interface BrowserSurfaceCoordinator {
  consumeVerifiedPersistentGiveIntent(sessionId: string): Promise<BrowserSurfaceResource | undefined>
  revoke(sessionId: string, generation: number): Promise<void>
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
  cleanup?: Promise<void>
}

interface PendingSurface {
  readonly sessionId: string
  readonly generation: number
  readonly promise: Promise<BrowserSurfaceMount>
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

  constructor(options: BrowserSurfaceManagerOptions) {
    this.coordinator = options.coordinator
    this.createEphemeral = options.createEphemeral
    this.createNonce = options.createNonce ?? randomUUID
    this.createMountToken = options.createMountToken ?? (() => randomUUID())
  }

  /** Atomically reserve, create or transfer, secure, and visibly mount the official session's surface. */
  async acquire(request: BrowserSurfaceAcquireRequest): Promise<BrowserSurfaceMount> {
    nonEmpty(request.sessionId, 'browser owner session')
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

  /** Revoke exact ownership and await handlers, debugger, view, storage, and coordinator cleanup. */
  async stop(token: BrowserSurfaceToken): Promise<void> {
    const active = this.active
    if (active === undefined || active.mount.generation !== token.generation
      || active.mount.mountToken !== token.mountToken) return
    if (active.mount.sessionId !== token.sessionId) {
      throw new AgentBrowserError('BUSY', 'another session owns the Agent browser surface')
    }
    if (active.cleanup === undefined) active.cleanup = this.cleanup(active)
    await active.cleanup
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
      await this.cleanupFailedMount(resource, handlers, sessionId, generation)
      if (error instanceof AgentBrowserError) throw error
      throw new AgentBrowserError('INTERNAL', 'browser surface could not be mounted')
    }
  }

  private async cleanup(active: ActiveSurface): Promise<void> {
    let failure: unknown
    const attempt = async (operation: () => void | Promise<void>): Promise<void> => {
      try {
        await operation()
      } catch (error) {
        failure ??= error
      }
    }
    await attempt(() => { active.handlers.dispose() })
    await attempt(() => active.resource.detachDebugger())
    await attempt(() => active.resource.teardownView())
    if (active.resource.kind === 'ephemeral') await attempt(() => active.resource.clearStorage())
    await attempt(() => this.coordinator.revoke(active.mount.sessionId, active.mount.generation))
    if (failure !== undefined) throw new AgentBrowserError('INTERNAL', 'browser surface cleanup did not reach quiescence')
    if (this.active === active) this.active = undefined
  }

  private async cleanupFailedMount(
    resource: BrowserSurfaceResource | undefined,
    handlers: { dispose(): void } | undefined,
    sessionId: string,
    generation: number,
  ): Promise<void> {
    const operations: (() => Promise<void>)[] = [
      ...handlers === undefined ? [] : [() => Promise.resolve().then(() => { handlers.dispose() })],
      ...resource === undefined ? [] : [
        () => resource.detachDebugger(),
        () => resource.teardownView(),
        ...resource.kind === 'ephemeral' ? [() => resource.clearStorage()] : [],
      ],
      () => this.coordinator.revoke(sessionId, generation),
    ]
    for (const operation of operations) {
      try {
        await operation()
      } catch {
        // Every remaining cleanup operation must still run after one failure.
      }
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
