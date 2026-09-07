import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as Stores from '@deepseek-ai/dsh-client-store'
import * as Client from '../src/client/index.ts'
import * as Host from '../src/index.ts'

describe('Desktop compatibility facade', () => {
  it('retains the official store identities when both compatibility entries mount', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(Host)
      await ctx.plugin(Client)
      expect(Client.createSnapshotStore).toBe(Stores.createSnapshotStore)
      expect(Client.defineStore).toBe(Stores.defineStore)
      expect(Client.shallowEqual).toBe(Stores.shallowEqual)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
