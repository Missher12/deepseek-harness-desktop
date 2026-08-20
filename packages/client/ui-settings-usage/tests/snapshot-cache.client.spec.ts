// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UsageInsightsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  readUsageSnapshot, resetUsageSnapshotForTest, writeUsageSnapshot,
} from '../src/client/snapshot-cache.ts'

afterEach(() => {
  resetUsageSnapshotForTest()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

  it('rejects every malformed aggregate field before persisting it', () => {
    const malformed = (path: readonly PropertyKey[], value: unknown): unknown => {
      const draft: unknown = structuredClone(snapshot)
      let target = draft
      for (const key of path.slice(0, -1)) {
        if ((typeof target !== 'object' && typeof target !== 'function') || target === null) {
          throw new Error('malformed fixture path')
        }
        target = Reflect.get(target, key)
      }
      const key = path.at(-1)
      if (key === undefined || ((typeof target !== 'object' && typeof target !== 'function') || target === null)) {
        throw new Error('malformed fixture target')
      }
      Reflect.set(target, key, value)
      return draft
    }
    const invalid = [
      null, [], 'snapshot',
      malformed(['summary'], null),
      malformed(['insights'], []),
      malformed(['generatedAt'], 'now'),
      malformed(['generatedAt'], Number.NaN),
      malformed(['generatedAt'], -1),
      malformed(['timeZone'], 1),
      malformed(['timeZone'], 'x'.repeat(129)),
      malformed(['sessionCount'], -1),
      malformed(['omittedSessions'], '0'),
      malformed(['incompleteUsageSamples'], Number.POSITIVE_INFINITY),
      malformed(['summary', 'totalTokens'], '10'),
      malformed(['summary', 'peakDailyTokens'], -1),
      malformed(['summary', 'longestSessionMs'], Number.NaN),
      malformed(['summary', 'currentStreakDays'], -1),
      malformed(['summary', 'longestStreakDays'], '1'),
      malformed(['insights', 'cacheHitRate'], 'half'),
      malformed(['insights', 'cacheHitRate'], 1.1),
      malformed(['insights', 'mostUsedModel'], 1),
      malformed(['insights', 'mostUsedModel'], 'x'.repeat(257)),
      malformed(['insights', 'mostUsedReasoningEffort'], {}),
      malformed(['insights', 'uniqueSkills'], -1),
      malformed(['insights', 'totalToolCalls'], Number.NaN),
      malformed(['insights', 'chatDays'], '1'),
      malformed(['activity'], {}),
      malformed(['activity'], Array.from({ length: 372 }, () => snapshot.activity[0])),
      malformed(['activity'], [null]),
      malformed(['activity', 0, 'date'], 1),
      malformed(['activity', 0, 'date'], '20-08-2026'),
      malformed(['activity', 0, 'humanMessages'], -1),
      malformed(['activity', 0, 'tokens'], '10'),
      malformed(['activity', 0, 'toolCalls'], Number.NaN),
      malformed(['activity', 0, 'level'], '4'),
      malformed(['activity', 0, 'level'], 1.5),
      malformed(['activity', 0, 'level'], -1),
      malformed(['activity', 0, 'level'], 5),
      malformed(['features'], {}),
      malformed(['features'], Array.from({ length: 51 }, () => snapshot.features[0])),
      malformed(['features'], [null]),
      malformed(['features', 0, 'kind'], 'other'),
      malformed(['features', 0, 'name'], 1),
      malformed(['features', 0, 'name'], ''),
      malformed(['features', 0, 'name'], 'x'.repeat(257)),
      malformed(['features', 0, 'count'], -1),
    ]

    for (const value of invalid) {
      localStorage.removeItem(STORAGE_KEY)
      writeUsageSnapshot(value as UsageInsightsSnapshot)
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
      resetUsageSnapshotForTest()
    }
  })

  it('accepts nullable summary and insight fields plus tool features', () => {
    const nullable: UsageInsightsSnapshot = {
      ...snapshot,
      summary: { ...snapshot.summary, totalTokens: null, peakDailyTokens: null, longestSessionMs: null },
      insights: {
        ...snapshot.insights,
        cacheHitRate: null,
        mostUsedModel: null,
        mostUsedReasoningEffort: null,
      },
      features: [{ kind: 'tool', name: 'bash', count: 1 }],
    }
    writeUsageSnapshot(nullable)
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
  })

  it('handles absent, throwing, empty, and corrupt browser storage without leaking failures', () => {
    vi.stubGlobal('localStorage', undefined)
    resetUsageSnapshotForTest({ preserveStorage: true })
    expect(readUsageSnapshot()).toBeUndefined()
    writeUsageSnapshot(snapshot)
    resetUsageSnapshotForTest()
    vi.unstubAllGlobals()

    const get = vi.spyOn(Storage.prototype, 'getItem')
    get.mockReturnValueOnce(null)
    expect(readUsageSnapshot()).toBeUndefined()
    get.mockRestore()

    localStorage.setItem(STORAGE_KEY, '{bad json')
    resetUsageSnapshotForTest({ preserveStorage: true })
    expect(readUsageSnapshot()).toBeUndefined()

    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    localStorage.setItem(STORAGE_KEY, '{bad json')
    resetUsageSnapshotForTest({ preserveStorage: true })
    expect(readUsageSnapshot()).toBeUndefined()
    expect(() => { resetUsageSnapshotForTest() }).not.toThrow()
    remove.mockRestore()

    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => { writeUsageSnapshot(snapshot) }).not.toThrow()
    set.mockRestore()
  })

  it('contains a browser policy that throws while resolving localStorage itself', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('policy blocked') },
    })
    try {
      resetUsageSnapshotForTest({ preserveStorage: true })
      expect(readUsageSnapshot()).toBeUndefined()
      expect(() => { writeUsageSnapshot(snapshot) }).not.toThrow()
      expect(() => { resetUsageSnapshotForTest() }).not.toThrow()
    } finally {
      if (descriptor === undefined) delete (globalThis as { localStorage?: Storage }).localStorage
      else Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  })
})
