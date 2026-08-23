import { describe, expect, it } from 'vitest'
import type { UsageActivityDay } from '@deepseek-ai/dsh-api-remotes/client'
import { buildParticleGrid } from '../src/client/charts.ts'

function day(index: number, tokens: number): UsageActivityDay {
  return {
    date: new Date(Date.UTC(2026, 0, 4 + index)).toISOString().slice(0, 10),
    humanMessages: tokens > 0 ? 1 : 0,
    tokens,
    toolCalls: 0,
    level: tokens > 0 ? 1 : 0,
  }
}

describe('aggregate particle intensity', () => {
  const activity = [
    ...Array.from({ length: 7 }, (_, index) => day(index, index === 0 ? 10 : 0)),
    ...Array.from({ length: 7 }, (_, index) => day(index + 7, index === 0 ? 990 : 0)),
  ]

  it('uses lighter filled particles for lower-volume weeks', () => {
    const weeks = buildParticleGrid(activity, 'weekly')
    expect(new Set(weeks[0]?.map(item => item.level).filter(level => level > 0))).toEqual(new Set([2]))
    expect(new Set(weeks[1]?.map(item => item.level).filter(level => level > 0))).toEqual(new Set([4]))
  })

  it('grades cumulative filled particles as the running total grows', () => {
    const weeks = buildParticleGrid(activity, 'cumulative')
    expect(new Set(weeks[0]?.map(item => item.level).filter(level => level > 0))).toEqual(new Set([2]))
    expect(new Set(weeks[1]?.map(item => item.level).filter(level => level > 0))).toEqual(new Set([4]))
  })
})
