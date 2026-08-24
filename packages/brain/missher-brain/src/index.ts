import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { augmentPreStepDecision } from './injection.ts'
import type { BrainProvider } from './contracts.ts'
import { BrainProviderRegistry } from './registry.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    missherBrain: BrainHub
  }
}

/** Stable pathless project identity shared by local providers. */
export function brainProjectKey(cwd: string): string {
  return createHash('sha256').update(resolve(cwd)).digest('hex')
}

/** One local service and one pre-step injection path for all brain providers. */
export default class BrainHub extends Service {
  private readonly registry = new BrainProviderRegistry()

  constructor(ctx: Context) {
    super(ctx, 'missherBrain')
    ctx.on('agent/pre-step', async ({ agent, step, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      const { cwd, origin, delegationDepth } = agent.session.header
      if (cwd === undefined) return decision
      return augmentPreStepDecision({
        decision,
        providers: this.registry.list(),
        projectKey: brainProjectKey(cwd),
        topLevel: origin !== 'subagent' && (delegationDepth ?? 0) === 0,
        step,
        signal,
        timeoutMs: 150,
        maxItems: 6,
        maxBytes: 4_000,
      })
    }, { prepend: true })
  }

  /** Register one factual-memory or procedural-learning provider. */
  register(provider: BrainProvider): () => void {
    return this.registry.register(provider)
  }

  /** Snapshot the providers currently participating in recall. */
  listProviders(): readonly BrainProvider[] {
    return this.registry.list()
  }
}

export * from './arbiter.ts'
export * from './contracts.ts'
export * from './injection.ts'
export * from './registry.ts'
