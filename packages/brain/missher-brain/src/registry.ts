import type { BrainProvider } from './contracts.ts'

/** Live provider table with exact-registration disposal semantics. */
export class BrainProviderRegistry {
  private readonly providers = new Map<string, BrainProvider>()

  /** Register one provider and return its idempotent exact-registration disposer. */
  register(provider: BrainProvider): () => void {
    if (provider.id.trim().length === 0) {
      throw new TypeError('brain provider must have a non-empty id')
    }
    if (provider.protocolVersion !== 1) {
      throw new TypeError('brain provider must use protocol version 1')
    }
    if (!Number.isInteger(provider.byteBudget) || provider.byteBudget < 1 || provider.byteBudget > 6_000) {
      throw new RangeError('brain provider byte budget must be between 1 and 6000')
    }
    if (this.providers.has(provider.id)) {
      throw new Error(`duplicate provider id: ${provider.id}`)
    }

    this.providers.set(provider.id, provider)
    return () => {
      if (this.providers.get(provider.id) === provider) {
        this.providers.delete(provider.id)
      }
    }
  }

  /** Return a stable insertion-ordered snapshot of live providers. */
  list(): readonly BrainProvider[] {
    return [...this.providers.values()]
  }
}
