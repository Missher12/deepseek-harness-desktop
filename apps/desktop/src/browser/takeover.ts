import { AgentBrowserError, WORKBENCH_BROWSER_PARTITION } from './contracts.ts'
import type {
  BrowserSurfaceCoordinator,
  BrowserSurfaceResource,
} from './surface-manager.ts'
import type { BrowserTakeoverStatus } from '../preload-api.ts'

/** Opaque main-owned identity for the exact currently visible human browser instance. */
export interface BrowserPersistentGiveIntent {
  readonly instanceId: string
  readonly generation: number
}

/** Human browser seam; neither method accepts renderer-controlled identity. */
export interface BrowserPersistentTakeoverSource {
  captureVisiblePersistentIntent(): BrowserPersistentGiveIntent | undefined
  consumeVisiblePersistentIntent(intent: BrowserPersistentGiveIntent): Promise<BrowserSurfaceResource>
}

export interface BrowserTakeoverAuthorityOptions {
  readonly source: BrowserPersistentTakeoverSource
  readonly stopActiveSession: (sessionId: string) => Promise<void>
  readonly emit?: (status: BrowserTakeoverStatus) => void
}

/** Sole main-process owner of the one-shot Give intent and awaited Stop state. */
export class BrowserTakeoverAuthority implements BrowserSurfaceCoordinator {
  private readonly source: BrowserPersistentTakeoverSource
  private readonly stopActiveSession: BrowserTakeoverAuthorityOptions['stopActiveSession']
  private readonly emit: NonNullable<BrowserTakeoverAuthorityOptions['emit']>
  private intent: BrowserPersistentGiveIntent | undefined
  private ownerSession: string | undefined
  private consumingSession: string | undefined
  private revoking: { readonly sessionId: string; readonly generation: number } | undefined
  private phase: BrowserTakeoverStatus['phase'] = 'human'
  private stopping: Promise<BrowserTakeoverStatus> | undefined

  constructor(options: BrowserTakeoverAuthorityOptions) {
    this.source = options.source
    this.stopActiveSession = options.stopActiveSession
    this.emit = options.emit ?? (() => undefined)
  }

  /** Record only an opaque identity captured from the current visible persistent human view. */
  give(): Promise<BrowserTakeoverStatus> {
    if (this.ownerSession !== undefined || this.consumingSession !== undefined
      || this.revoking !== undefined || this.stopping !== undefined) {
      throw new AgentBrowserError('BUSY', 'the browser is already assigned to an Agent')
    }
    const intent = this.source.captureVisiblePersistentIntent()
    if (intent === undefined || intent.instanceId.length === 0
      || !Number.isSafeInteger(intent.generation) || intent.generation < 1) {
      throw new AgentBrowserError('POLICY_DENIED', 'a visible persistent human browser is required')
    }
    this.intent = Object.freeze({ instanceId: intent.instanceId, generation: intent.generation })
    return Promise.resolve(this.publish('given'))
  }

  /** Return only the closed renderer-visible state; no session, token, surface, or partition is exposed. */
  status(): BrowserTakeoverStatus {
    return Object.freeze({ phase: this.phase, signedInWarning: true })
  }

  /** Mark a manager-created ephemeral surface as Agent-owned without consuming human state. */
  claimEphemeralOwner(sessionId: string): void {
    if (this.intent !== undefined || this.ownerSession !== undefined || this.consumingSession !== undefined
      || this.revoking !== undefined) {
      throw new AgentBrowserError('BUSY', 'another browser takeover state is active')
    }
    this.ownerSession = sessionId
    this.publish('agent')
  }

  /** Consume the main-owned intent once, deriving the owner only from the trusted provider request. */
  async consumeVerifiedPersistentGiveIntent(sessionId: string): Promise<BrowserSurfaceResource | undefined> {
    if (this.ownerSession !== undefined) {
      if (this.ownerSession !== sessionId) {
        throw new AgentBrowserError('BUSY', 'another session owns the persistent browser')
      }
      return undefined
    }
    if (this.consumingSession !== undefined) {
      throw new AgentBrowserError('BUSY', 'a persistent browser transfer is already in progress')
    }
    const intent = this.intent
    if (intent === undefined) return undefined
    this.intent = undefined
    this.consumingSession = sessionId
    try {
      const resource = await this.source.consumeVisiblePersistentIntent(intent)
      if (resource.kind !== 'human-persistent' || resource.partition !== WORKBENCH_BROWSER_PARTITION) {
        throw new AgentBrowserError('POLICY_DENIED', 'persistent browser transfer is invalid')
      }
      this.ownerSession = sessionId
      if (this.stopping === undefined) this.publish('agent')
      return resource
    } catch (error) {
      if (this.stopping === undefined) this.publish('human')
      throw error
    } finally {
      if (this.consumingSession === sessionId) this.consumingSession = undefined
    }
  }

  /** Await coordinator revocation and every generation-owned cleanup step. */
  stop(): Promise<BrowserTakeoverStatus> {
    if (this.stopping !== undefined) return this.stopping
    const owner = this.ownerSession ?? this.consumingSession
    if (owner === undefined) {
      this.intent = undefined
      return Promise.resolve(this.publish('human'))
    }
    this.publish('stopping')
    const operation = this.stopOwner(owner)
    this.stopping = operation
    void operation.finally(() => {
      if (this.stopping === operation) this.stopping = undefined
    }).catch(() => undefined)
    return operation
  }

  /** Manager cleanup notification for the exact trusted owner session. */
  revoke(sessionId: string, generation: number): Promise<boolean> {
    if (this.ownerSession !== sessionId) return Promise.resolve(false)
    const revoking = this.revoking
    if (revoking !== undefined
      && (revoking.sessionId !== sessionId || revoking.generation !== generation)) {
      throw new AgentBrowserError('STALE_REF', 'browser revocation generation is stale')
    }
    this.revoking ??= Object.freeze({ sessionId, generation })
    if (this.stopping === undefined) this.publish('stopping')
    return Promise.resolve(true)
  }

  /** Clear the main-owned owner only after exact surface release reaches quiescence. */
  release(sessionId: string, generation: number): Promise<void> {
    const revoking = this.revoking
    if (revoking === undefined || revoking.sessionId !== sessionId || revoking.generation !== generation) {
      throw new AgentBrowserError('STALE_REF', 'browser release generation is stale')
    }
    this.revoking = undefined
    if (this.ownerSession === sessionId) this.ownerSession = undefined
    if (this.stopping === undefined) this.publish('human')
    return Promise.resolve()
  }

  private async stopOwner(sessionId: string): Promise<BrowserTakeoverStatus> {
    try {
      await this.stopActiveSession(sessionId)
      if (this.ownerSession === sessionId) this.ownerSession = undefined
      if (this.revoking?.sessionId === sessionId) this.revoking = undefined
      return this.publish('human')
    } catch (error) {
      this.publish('agent')
      throw error
    }
  }

  private publish(phase: BrowserTakeoverStatus['phase']): BrowserTakeoverStatus {
    this.phase = phase
    const status = this.status()
    this.emit(status)
    return status
  }
}

export interface BrowserTakeoverIpcRegistry {
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>): void
  removeHandler(channel: string): void
}

export interface BrowserTakeoverIpcOptions {
  readonly registry: BrowserTakeoverIpcRegistry
  readonly authority: Pick<BrowserTakeoverAuthority, 'give' | 'stop' | 'status'>
  readonly isTrustedMainFrame: (event: unknown) => boolean
  /** Revoke-only notification; renderer never supplies a session or authority identity. */
  readonly visibleSessionChanged: () => void | Promise<void>
}

const TAKEOVER_CHANNELS = Object.freeze({
  give: 'desktop:browser-takeover-give',
  stop: 'desktop:browser-takeover-stop',
  status: 'desktop:browser-takeover-status',
  visibleSessionChanged: 'desktop:visible-session-changed',
})

/** Register strict zero-argument takeover methods for one trusted renderer main frame. */
export function installBrowserTakeoverIpc(options: BrowserTakeoverIpcOptions): () => void {
  const install = (
    channel: string,
    operation: () => unknown | Promise<unknown>,
  ): void => {
    options.registry.handle(channel, async (event, ...args) => {
      if (!options.isTrustedMainFrame(event)) throw new Error('Untrusted browser takeover sender.')
      if (args.length !== 0) throw new TypeError('Browser takeover methods accept no arguments.')
      return await operation()
    })
  }
  install(TAKEOVER_CHANNELS.give, async () => await options.authority.give())
  install(TAKEOVER_CHANNELS.stop, async () => await options.authority.stop())
  install(TAKEOVER_CHANNELS.status, () => options.authority.status())
  install(TAKEOVER_CHANNELS.visibleSessionChanged, async () => {
    await options.visibleSessionChanged()
  })
  return () => {
    options.registry.removeHandler(TAKEOVER_CHANNELS.give)
    options.registry.removeHandler(TAKEOVER_CHANNELS.stop)
    options.registry.removeHandler(TAKEOVER_CHANNELS.status)
    options.registry.removeHandler(TAKEOVER_CHANNELS.visibleSessionChanged)
  }
}
