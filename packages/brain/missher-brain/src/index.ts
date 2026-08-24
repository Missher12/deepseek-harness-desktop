import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { augmentPreStepDecision } from './injection.ts'
import type { BrainHubSnapshot, BrainProvider, BrainProviderStatus } from './contracts.ts'
import { BrainProviderRegistry } from './registry.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    missherBrain: BrainHub
  }
}

/**
 * Create the stable pathless project identity shared by local providers.
 * @param cwd Canonical session working directory, retained only for this calculation.
 * @returns SHA-256 project identity without the source path.
 */
export function brainProjectKey(cwd: string): string {
  return createHash('sha256').update(resolve(cwd)).digest('hex')
}

/** One local service and one pre-step injection path for all brain providers. */
const RECALL_LIMITS = { maxItems: 6, maxBytes: 4_000, timeoutMs: 150 } as const
const STATUS_TIMEOUT_MS = 300

/** Single error-redacting provider status read for the settings snapshot. */
async function providerStatus(provider: BrainProvider): Promise<BrainProviderStatus> {
  try {
    return await Promise.race([
      provider.status(),
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('brain provider status timeout')) }, STATUS_TIMEOUT_MS)
        timer.unref()
      }),
    ])
  } catch {
    return { state: 'unavailable', count: 0 }
  }
}

/** Coordinates bounded local-knowledge providers and exposes pathless status. */
export default class BrainHub extends TypertRemoteService {
  private readonly registry = new BrainProviderRegistry()

  constructor(ctx: Context) {
    super(ctx, 'missherBrain')
    ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      const { cwd, origin, delegationDepth } = agent.session.header
      if (cwd === undefined) return decision
      return augmentPreStepDecision({
        decision,
        providers: this.registry.list(),
        projectKey: brainProjectKey(cwd),
        sessionId: agent.session.id,
        turn,
        topLevel: origin !== 'subagent' && (delegationDepth ?? 0) === 0,
        step,
        signal,
        timeoutMs: RECALL_LIMITS.timeoutMs,
        maxItems: RECALL_LIMITS.maxItems,
        maxBytes: RECALL_LIMITS.maxBytes,
      })
    }, { prepend: true })
  }

  /**
   * Register one factual-memory or procedural-learning provider.
   * @param provider Provider whose prepared contributions enter shared arbitration.
   * @returns Disposer for this exact registration.
   */
  register(provider: BrainProvider): () => void {
    return this.registry.register(provider)
  }

  /**
   * Snapshot the providers currently participating in recall.
   * @returns Providers in deterministic registration order.
   */
  listProviders(): readonly BrainProvider[] {
    return this.registry.list()
  }

  /**
   * Read only pathless facts; provider failures become unavailable rows.
   * @returns Current provider availability and fixed arbitration limits.
   */
  @Remote('snapshot')
  async snapshot(): Promise<BrainHubSnapshot> {
    const providers = this.registry.list()
    const providerStatuses = await Promise.all(providers.map(async provider => ({
      provider,
      status: await providerStatus(provider),
    })))
    return {
      generatedAt: Date.now(),
      limits: { ...RECALL_LIMITS },
      providers: providerStatuses.map(({ provider, status }) => ({
        id: provider.id,
        byteBudget: provider.byteBudget,
        ...status,
      })),
    }
  }
}

export * from './arbiter.ts'
export * from './contracts.ts'
export * from './injection.ts'
export * from './registry.ts'
