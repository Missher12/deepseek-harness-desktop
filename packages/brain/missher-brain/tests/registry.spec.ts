import { describe, expect, it, vi } from 'vitest'
import { BrainProviderRegistry } from '../src/registry.js'
import type { BrainProvider, PreparedBrainBatch } from '../src/contracts.js'

function provider(id: string, overrides: Partial<BrainProvider> = {}): BrainProvider {
  return {
    protocolVersion: 1,
    id,
    byteBudget: 3_000,
    async prepare(): Promise<PreparedBrainBatch> {
      return {
        items: [],
        accept: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
      }
    },
    async status() {
      return { state: 'ready', count: 0 }
    },
    ...overrides,
  }
}

describe('BrainProviderRegistry', () => {
  it('rejects a duplicate live provider id and removes only the exact registration', () => {
    const registry = new BrainProviderRegistry()
    const first = provider('memory')
    const dispose = registry.register(first)

    expect(() => registry.register(provider('memory'))).toThrow(/duplicate provider id: memory/)
    expect(registry.list()).toEqual([first])

    dispose()
    const second = provider('memory')
    registry.register(second)
    dispose()
    expect(registry.list()).toEqual([second])
  })

  it.each([
    [provider(''), /non-empty id/],
    [provider('future', { protocolVersion: 2 as 1 }), /protocol version 1/],
    [provider('empty-budget', { byteBudget: 0 }), /between 1 and 6000/],
    [provider('large-budget', { byteBudget: 6_001 }), /between 1 and 6000/],
  ])('rejects an invalid provider contract', (candidate, message) => {
    expect(() => new BrainProviderRegistry().register(candidate)).toThrow(message)
  })
})
