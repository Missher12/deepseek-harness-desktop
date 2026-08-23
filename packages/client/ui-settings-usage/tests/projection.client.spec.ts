import { describe, expect, it } from 'vitest'
import type { UsageActivityDay } from '@deepseek-ai/dsh-api-remotes/client'
import { buildDailyGrid, buildParticleGrid } from '../src/client/charts.ts'
import { formatCompactNumber, formatDuration } from '../src/client/format.ts'

const activity = (length = 371): UsageActivityDay[] => Array.from({ length }, (_, index) => ({
  date: new Date(Date.UTC(2025, 7, 17 + index)).toISOString().slice(0, 10),
  humanMessages: index % 13 === 0 ? 1 : 0,
  tokens: index + 1,
  toolCalls: index % 7,
  level: Math.min(4, (index % 5)) as UsageActivityDay['level'],
}))

describe('usage chart projections', () => {
  it('projects the Host range into exactly 53 chronological weeks', () => {
    const grid = buildDailyGrid(activity())

    expect(grid).toHaveLength(53)
    expect(grid.every(week => week.length === 7)).toBe(true)
    expect(grid.flat()[0]?.date).toBe('2025-08-17')
    expect(grid.flat().at(-1)?.date).toBe('2026-08-22')
  })

  it('keeps all 371 particles while changing weekly and cumulative token scope', () => {
    const source = activity()
    const weekly = buildParticleGrid(source, 'weekly')
    const cumulative = buildParticleGrid(source, 'cumulative')

    expect(weekly).toHaveLength(53)
    expect(weekly.every(week => week.length === 7)).toBe(true)
    expect(weekly[0]?.every(particle => particle.tokens === 28)).toBe(true)
    expect(weekly[0]?.every(particle => particle.periodStart === '2025-08-17')).toBe(true)
    expect(weekly[0]?.every(particle => particle.periodEnd === '2025-08-23')).toBe(true)
    expect(weekly[0]?.filter(particle => particle.level > 0).length).toBeGreaterThan(0)
    expect(weekly[0]?.filter(particle => particle.level > 0).length).toBeLessThan(7)
    expect(weekly.at(-1)?.every(particle => particle.level === 4)).toBe(true)

    expect(cumulative).toHaveLength(53)
    expect(cumulative.flat()).toHaveLength(371)
    expect(cumulative[0]?.every(particle => particle.tokens === 28)).toBe(true)
    expect(cumulative.flat().at(-1)?.tokens).toBe(source.reduce((sum, day) => sum + day.tokens, 0))
    expect(cumulative.flat().at(-1)?.periodStart).toBe('2025-08-17')
    expect(cumulative.flat().at(-1)?.periodEnd).toBe('2026-08-22')
    expect(cumulative[0]?.slice(0, 6).every(particle => particle.level === 0)).toBe(true)
    expect(cumulative[0]?.at(-1)?.level).toBe(2)
    expect(cumulative.at(-1)?.every(particle => particle.level === 4)).toBe(true)

    const withPriorHistory = buildParticleGrid(source, 'cumulative', 10_000)
    expect(withPriorHistory[0]?.every(particle => particle.tokens === 10_028)).toBe(true)
    expect(withPriorHistory.flat().at(-1)?.tokens).toBe(10_000 + source.reduce((sum, day) => sum + day.tokens, 0))
  })

  it('keeps empty and zero-only projections empty or idle', () => {
    expect(buildDailyGrid([])).toEqual([])
    expect(buildParticleGrid([], 'daily')).toEqual([])
    expect(buildParticleGrid([], 'weekly')).toEqual([])
    expect(buildParticleGrid([], 'cumulative', -10)).toEqual([])

    const zero = activity(7).map(day => ({ ...day, tokens: 0, level: 0 as const }))
    expect(buildParticleGrid(zero, 'weekly').flat().every(day => day.level === 0)).toBe(true)
    expect(buildParticleGrid(zero, 'cumulative').flat().every(day => day.level === 0)).toBe(true)
  })
})

describe('usage formatters', () => {
  it('formats compact counts and completed durations by locale', () => {
    expect(formatCompactNumber(96_500, 'en')).toMatch(/96\.5K/i)
    expect(formatCompactNumber(96_500, 'zh-CN')).toContain('万')
    expect(formatDuration(6 * 3_600_000 + 22 * 60_000, 'zh-CN')).toBe('6 小时 22 分')
    expect(formatDuration(6 * 3_600_000 + 22 * 60_000, 'en')).toBe('6h 22m')
    expect(formatDuration(26 * 3_600_000, 'zh-CN')).toBe('1 天 2 小时')
    expect(formatDuration(22 * 60_000, 'zh-CN')).toBe('22 分')
    expect(formatDuration(26 * 3_600_000, 'en')).toBe('1d 2h')
    expect(formatDuration(-1, 'en')).toBe('0m')
  })
})
