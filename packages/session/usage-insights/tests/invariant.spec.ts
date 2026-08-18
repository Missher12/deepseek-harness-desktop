import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as UsageInsightsInvariant from '../src/invariant.ts'

describe('usage-insights invariant companion', () => {
  it('releases its package reservation when disposed', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      const fiber = await ctx.plugin(UsageInsightsInvariant)
      expect(() => {
        ctx.invariants.register('@deepseek-ai/dsh-usage-insights', () => {})
      }).toThrow(/already registered/u)
      await fiber.dispose()
      await expect(ctx.plugin(UsageInsightsInvariant).await()).resolves.toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
