import { describe, expect, it } from 'vitest'
import { aggregateUsageRows } from '../src/aggregate.ts'
import type { SessionUsageRow } from '../src/types.ts'

const row = (overrides: Partial<SessionUsageRow> = {}): SessionUsageRow => ({
  sessionId: 'row-1',
  createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
  timeZone: 'Asia/Shanghai',
  lastSeq: 10,
  tokens: { uncachedInput: 100, output: 200, cacheRead: 300, cacheWrite: 400 },
  totalTokens: 1_000,
  validUsageSamples: 1,
  incompleteUsageSamples: 0,
  completedTurnDurationMs: 5_000,
  completedTurnCount: 1,
  daily: [],
  models: {},
  reasoningEfforts: {},
  skills: {},
  tools: {},
  ...overrides,
})

describe('aggregateUsageRows', () => {
  it('aggregates all-time metrics, calendar streaks, insights, and top features', () => {
    const snapshot = aggregateUsageRows([
      row({
        daily: [
          { date: '2026-08-14', humanMessages: 1, tokens: 100, toolCalls: 1 },
          { date: '2026-08-16', humanMessages: 1, tokens: 200, toolCalls: 2 },
          { date: '2026-08-17', humanMessages: 1, tokens: 300, toolCalls: 1 },
        ],
        models: { 'deepseek/deepseek-v4-flash': 3 },
        reasoningEfforts: { max: 3 },
        skills: { preview: 3, playwright: 2 },
        tools: { bash: 4, skill: 2 },
      }),
      row({
        sessionId: 'row-2',
        tokens: { uncachedInput: 50, output: 50, cacheRead: 100, cacheWrite: 0 },
        totalTokens: 200,
        completedTurnDurationMs: 12_000,
        daily: [
          { date: '2026-08-17', humanMessages: 1, tokens: 50, toolCalls: 1 },
        ],
        models: { 'deepseek/deepseek-chat': 1 },
        reasoningEfforts: { high: 1 },
        skills: { preview: 1 },
        tools: { read_file: 1 },
      }),
    ], {
      now: Date.parse('2026-08-18T04:00:00.000Z'),
      timeZone: 'Asia/Shanghai',
      omittedSessions: 2,
    })

    expect(snapshot.summary).toEqual({
      totalTokens: 1_200,
      peakDailyTokens: 350,
      longestSessionMs: 12_000,
      currentStreakDays: 2,
      longestStreakDays: 2,
    })
    expect(snapshot.insights).toEqual({
      cacheHitRate: 400 / 950,
      mostUsedModel: 'deepseek/deepseek-v4-flash',
      mostUsedReasoningEffort: 'max',
      uniqueSkills: 2,
      totalToolCalls: 7,
      chatDays: 3,
    })
    expect(snapshot.features.slice(0, 4)).toEqual([
      { kind: 'skill', name: 'preview', count: 4 },
      { kind: 'tool', name: 'bash', count: 4 },
      { kind: 'skill', name: 'playwright', count: 2 },
      { kind: 'tool', name: 'skill', count: 2 },
    ])
    expect(snapshot.sessionCount).toBe(2)
    expect(snapshot.omittedSessions).toBe(2)
    expect(snapshot.incompleteUsageSamples).toBe(0)
  })

  it('returns an exact 53-by-7 visible range and stable token intensity', () => {
    const snapshot = aggregateUsageRows([row({
      daily: [
        { date: '2025-08-17', humanMessages: 1, tokens: 99, toolCalls: 0 },
        { date: '2025-08-14', humanMessages: 1, tokens: 1, toolCalls: 0 },
        { date: '2026-08-18', humanMessages: 1, tokens: 100, toolCalls: 0 },
      ],
    })], {
      now: Date.parse('2026-08-18T04:00:00.000Z'),
      timeZone: 'Asia/Shanghai',
    })

    expect(snapshot.activity).toHaveLength(371)
    expect(snapshot.activity[0]?.date).toBe('2025-08-17')
    expect(snapshot.activity.at(-1)?.date).toBe('2026-08-22')
    expect(snapshot.activity.find(day => day.date === '2025-08-17')?.level).toBeGreaterThan(0)
    expect(snapshot.activity.find(day => day.date === '2026-08-18')?.level).toBe(4)
    expect(snapshot.activity.filter(day => day.level === 0)).toHaveLength(369)
  })

  it('keeps token and duration metrics unavailable when no authoritative sample exists', () => {
    const snapshot = aggregateUsageRows([row({
      tokens: { uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      totalTokens: 0,
      validUsageSamples: 0,
      incompleteUsageSamples: 2,
      completedTurnDurationMs: 0,
      completedTurnCount: 0,
    })], {
      now: Date.parse('2026-08-18T04:00:00.000Z'),
      timeZone: 'Asia/Shanghai',
    })

    expect(snapshot.summary.totalTokens).toBeNull()
    expect(snapshot.summary.peakDailyTokens).toBeNull()
    expect(snapshot.summary.longestSessionMs).toBeNull()
    expect(snapshot.insights.cacheHitRate).toBeNull()
    expect(snapshot.incompleteUsageSamples).toBe(2)
  })

  it('uses deterministic tie breaks, activity-only intensity, and option defaults', () => {
    const snapshot = aggregateUsageRows([row({
      daily: [
        { date: '2026-08-17', humanMessages: 0, tokens: 0, toolCalls: 0 },
        { date: '2026-08-18', humanMessages: 0, tokens: 0, toolCalls: 1 },
      ],
      models: { zeta: 2, alpha: 2 },
      reasoningEfforts: { low: 1, high: 1 },
      skills: { same: 1 },
      tools: { same: 1, zeta: 1, alpha: 1 },
    })], {
      now: Date.parse('2026-08-18T04:00:00.000Z'),
      timeZone: 'Asia/Shanghai',
    })

    expect(snapshot.omittedSessions).toBe(0)
    expect(snapshot.insights.mostUsedModel).toBe('alpha')
    expect(snapshot.insights.mostUsedReasoningEffort).toBe('high')
    expect(snapshot.activity.find(day => day.date === '2026-08-18')?.level).toBe(4)
    expect(snapshot.features.slice(0, 4)).toEqual([
      { kind: 'skill', name: 'same', count: 1 },
      { kind: 'tool', name: 'alpha', count: 1 },
      { kind: 'tool', name: 'same', count: 1 },
      { kind: 'tool', name: 'zeta', count: 1 },
    ])
  })
})
