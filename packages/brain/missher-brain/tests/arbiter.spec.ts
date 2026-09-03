import { describe, expect, it } from 'vitest'
import { arbitrate, renderBrainContext } from '../src/arbiter.js'
import type { BrainContribution, BrainContributionKind } from '../src/contracts.js'

function contribution(
  handle: string,
  text: string,
  kind: BrainContributionKind,
  overrides: Partial<BrainContribution> = {},
): BrainContribution {
  return {
    handle,
    providerId: kind === 'learned-rule' ? 'evolution' : 'memory',
    kind,
    text,
    reference: `ref:${handle}`,
    recordedAt: '2026-08-24T00:00:00.000Z',
    score: 0,
    pinned: false,
    ...overrides,
  }
}

describe('brain arbitration', () => {
  it('keeps reviewed memory ahead of a legacy duplicate and retains an independent learned rule', () => {
    const selected = arbitrate([
      contribution('legacy', ' Use pnpm test. ', 'legacy-memory'),
      contribution('rule', 'Run focused tests before the full suite.', 'learned-rule'),
      contribution('reviewed', 'use  pnpm   test.', 'reviewed-memory'),
    ], { maxItems: 6, maxBytes: 4_000 })

    expect(selected.map(item => item.handle)).toEqual(['reviewed', 'rule'])
  })

  it('counts the complete UTF-8 rendered context against the byte budget', () => {
    const item = contribution('large', '鲸'.repeat(100), 'reviewed-memory')
    const exact = Buffer.byteLength(renderBrainContext([item]), 'utf8')

    expect(arbitrate([item], { maxItems: 1, maxBytes: exact - 1 })).toEqual([])
    expect(arbitrate([item], { maxItems: 1, maxBytes: exact })).toEqual([item])
  })

  it('orders equal candidates deterministically instead of trusting provider completion order', () => {
    const a = contribution('a', 'alpha', 'reviewed-memory', { providerId: 'z-provider' })
    const b = contribution('b', 'beta', 'reviewed-memory', { providerId: 'a-provider' })

    expect(arbitrate([a, b], { maxItems: 2, maxBytes: 4_000 }).map(item => item.handle)).toEqual(['b', 'a'])
    expect(arbitrate([b, a], { maxItems: 2, maxBytes: 4_000 }).map(item => item.handle)).toEqual(['b', 'a'])
  })

  it('uses pin, score, time, and handle tie-breakers and stops at the item cap', () => {
    const base = contribution('base', 'base', 'reviewed-memory')
    const pinned = contribution('pinned', 'pinned', 'reviewed-memory', { pinned: true })
    expect(arbitrate([base, pinned], { maxItems: 1, maxBytes: 4_000 })).toEqual([pinned])

    const low = contribution('low', 'low', 'reviewed-memory', { score: 1 })
    const high = contribution('high', 'high', 'reviewed-memory', { score: 2 })
    expect(arbitrate([low, high], { maxItems: 2, maxBytes: 4_000 }).map(item => item.handle)).toEqual(['high', 'low'])

    const old = contribution('old', 'old', 'reviewed-memory', { score: Number.NaN, recordedAt: '2026-01-01T00:00:00.000Z' })
    const recent = contribution('recent', 'recent', 'reviewed-memory', { score: Number.NaN, recordedAt: '2026-08-24T00:00:00.000Z' })
    expect(arbitrate([old, recent], { maxItems: 2, maxBytes: 4_000 }).map(item => item.handle)).toEqual(['recent', 'old'])

    const handleA = contribution('a', 'same-provider-a', 'reviewed-memory')
    const handleB = contribution('b', 'same-provider-b', 'reviewed-memory')
    expect(arbitrate([handleB, handleA], { maxItems: 2, maxBytes: 4_000 }).map(item => item.handle)).toEqual(['a', 'b'])
  })

  it('skips empty and duplicate text and validates both public limits', () => {
    const kept = contribution('kept', 'content', 'reviewed-memory')
    expect(arbitrate([
      contribution('empty', '   ', 'reviewed-memory'),
      contribution('duplicate', ' CONTENT ', 'legacy-memory'),
      kept,
    ], { maxItems: 6, maxBytes: 4_000 })).toEqual([kept])

    expect(() => arbitrate([], { maxItems: 0, maxBytes: 4_000 })).toThrow(/maxItems/)
    expect(() => arbitrate([], { maxItems: 1, maxBytes: Number.NaN })).toThrow(/maxBytes/)
  })
})
