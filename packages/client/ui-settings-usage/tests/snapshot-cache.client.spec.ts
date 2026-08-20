// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { UsageInsightsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  readUsageSnapshot, resetUsageSnapshotForTest, writeUsageSnapshot,
} from '../src/client/snapshot-cache.ts'

afterEach(resetUsageSnapshotForTest)

const STORAGE_KEY = 'dsh.usage-insights.snapshot.v1'
const snapshot = {
  generatedAt: 1,
  timeZone: 'Asia/Shanghai',
  sessionCount: 1,
  omittedSessions: 0,
  incompleteUsageSamples: 0,
  summary: {
    totalTokens: 10,
    peakDailyTokens: 10,
    longestSessionMs: 100,
    currentStreakDays: 1,
    longestStreakDays: 1,
  },
  insights: {
    cacheHitRate: 0.5,
    mostUsedModel: 'deepseek/deepseek-v4-flash',
    mostUsedReasoningEffort: 'max',
    uniqueSkills: 1,
    totalToolCalls: 2,
    chatDays: 1,
  },
  activity: [{ date: '2026-08-20', humanMessages: 1, tokens: 10, toolCalls: 2, level: 4 }],
  features: [{ kind: 'skill', name: 'preview', count: 1 }],
} satisfies UsageInsightsSnapshot

describe('usage snapshot stale-while-refresh cache', () => {
  it('holds only the latest successful immutable snapshot for the current process', () => {
    expect(readUsageSnapshot()).toBeUndefined()
    writeUsageSnapshot(snapshot)
    expect(readUsageSnapshot()).toBe(snapshot)
  })

  it('restores the latest aggregate snapshot after renderer memory is cleared', () => {
    writeUsageSnapshot(snapshot)
    resetUsageSnapshotForTest({ preserveStorage: true })

    expect(readUsageSnapshot()).toEqual(snapshot)
  })

  it('ignores and removes malformed durable data', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, snapshot: { generatedAt: 1 } }))
    resetUsageSnapshotForTest({ preserveStorage: true })

    expect(readUsageSnapshot()).toBeUndefined()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
