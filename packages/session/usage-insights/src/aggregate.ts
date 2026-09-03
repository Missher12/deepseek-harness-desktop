/** Pure aggregation across privacy-minimal per-session rows. */

import type {
  SessionUsageRow,
  UsageActivityDay,
  UsageFeature,
  UsageInsightsSnapshot,
} from './types.ts'
import { usageDateKey } from './calendar.ts'

/** Inputs that date one immutable aggregate cut. */
export interface AggregateUsageOptions {
  now: number
  timeZone: string
  omittedSessions?: number
}

interface DayTotals {
  humanMessages: number
  tokens: number
  toolCalls: number
}

/** Parse a canonical date key onto the UTC calendar arithmetic plane. */
function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

/** Format a UTC calendar day number as a canonical date key. */
function dateFromDayNumber(value: number): string {
  return new Date(value * 86_400_000).toISOString().slice(0, 10)
}

/** Add one named count map into the aggregate. */
function mergeCounts(target: Map<string, number>, values: Record<string, number>): void {
  for (const [name, count] of Object.entries(values)) {
    target.set(name, (target.get(name) ?? 0) + count)
  }
}

/** Resolve a deterministic most-used key. */
function mostUsed(values: Map<string, number>): string | null {
  return [...values]
    .sort(([leftName, leftCount], [rightName, rightCount]) =>
      rightCount - leftCount || leftName.localeCompare(rightName))[0]?.[0] ?? null
}

/** Longest consecutive run across canonical local date keys. */
function longestStreak(active: ReadonlySet<string>): number {
  const days = [...active].map(dayNumber).sort((left, right) => left - right)
  let longest = 0
  let current = 0
  let previous: number | undefined
  for (const day of days) {
    current = previous !== undefined && day === previous + 1 ? current + 1 : 1
    longest = Math.max(longest, current)
    previous = day
  }
  return longest
}

/** Current consecutive run ending today, or yesterday when today is quiet. */
function currentStreak(active: ReadonlySet<string>, today: string): number {
  const todayNumber = dayNumber(today)
  let cursor = active.has(today) ? todayNumber : todayNumber - 1
  if (!active.has(dateFromDayNumber(cursor))) return 0
  let count = 0
  while (active.has(dateFromDayNumber(cursor))) {
    count += 1
    cursor -= 1
  }
  return count
}

/** Stable logarithmic level that preserves equal-value equality. */
function intensity(value: number, maximum: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || maximum <= 0) return 0
  const level = Math.ceil(4 * Math.log1p(value) / Math.log1p(maximum))
  return Math.max(1, Math.min(4, level)) as 1 | 2 | 3 | 4
}

/**
 * Aggregate all durable session rows into one bounded Settings snapshot.
 * @param rows - Privacy-minimal rows derived from durable sessions.
 * @param options - Time-zone, clock, and omission facts for this immutable cut.
 * @returns One bounded all-history usage snapshot for the Settings UI.
 */
export function aggregateUsageRows(
  rows: readonly SessionUsageRow[],
  options: AggregateUsageOptions,
): UsageInsightsSnapshot {
  // Validate once even when there are no rows.
  const today = usageDateKey(options.now, options.timeZone)
  const days = new Map<string, DayTotals>()
  const models = new Map<string, number>()
  const efforts = new Map<string, number>()
  const skills = new Map<string, number>()
  const tools = new Map<string, number>()
  let uncachedInput = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let validUsageSamples = 0
  let incompleteUsageSamples = 0
  let completedTurnCount = 0
  let longestSessionMs = 0

  for (const row of rows) {
    uncachedInput += row.tokens.uncachedInput
    output += row.tokens.output
    cacheRead += row.tokens.cacheRead
    cacheWrite += row.tokens.cacheWrite
    validUsageSamples += row.validUsageSamples
    incompleteUsageSamples += row.incompleteUsageSamples
    completedTurnCount += row.completedTurnCount
    longestSessionMs = Math.max(longestSessionMs, row.completedTurnDurationMs)
    mergeCounts(models, row.models)
    mergeCounts(efforts, row.reasoningEfforts)
    mergeCounts(skills, row.skills)
    mergeCounts(tools, row.tools)
    for (const day of row.daily) {
      const total = days.get(day.date) ?? { humanMessages: 0, tokens: 0, toolCalls: 0 }
      total.humanMessages += day.humanMessages
      total.tokens += day.tokens
      total.toolCalls += day.toolCalls
      days.set(day.date, total)
    }
  }

  const humanDays = new Set([...days].filter(([, day]) => day.humanMessages > 0).map(([date]) => date))
  const tokenDays = [...days.values()].map(day => day.tokens)
  const peakDailyTokens = validUsageSamples === 0 ? null : Math.max(0, ...tokenDays)
  const totalTokens = validUsageSamples === 0
    ? null
    : uncachedInput + output + cacheRead + cacheWrite
  const promptTokens = uncachedInput + cacheRead + cacheWrite
  const cacheHitRate = validUsageSamples === 0 || promptTokens === 0 ? null : cacheRead / promptTokens

  const todayNumber = dayNumber(today)
  const sundayOffset = new Date(todayNumber * 86_400_000).getUTCDay()
  const start = todayNumber - sundayOffset - 52 * 7
  const visibleValues: number[] = []
  for (let offset = 0; offset < 371; offset += 1) {
    const value = days.get(dateFromDayNumber(start + offset))
    visibleValues.push(value === undefined ? 0 : Math.max(value.tokens, value.humanMessages + value.toolCalls > 0 ? 1 : 0))
  }
  const maximum = Math.max(0, ...visibleValues)
  const activity: UsageActivityDay[] = visibleValues.map((value, offset) => {
    const date = dateFromDayNumber(start + offset)
    const day = days.get(date) ?? { humanMessages: 0, tokens: 0, toolCalls: 0 }
    return { date, ...day, level: intensity(value, maximum) }
  })

  const features: UsageFeature[] = [
    ...[...skills].map(([name, count]) => ({ kind: 'skill' as const, name, count })),
    ...[...tools].map(([name, count]) => ({ kind: 'tool' as const, name, count })),
  ].sort((left, right) =>
    right.count - left.count
    || left.kind.localeCompare(right.kind)
    || left.name.localeCompare(right.name))
    .slice(0, 5)

  return {
    generatedAt: options.now,
    timeZone: options.timeZone,
    sessionCount: rows.length,
    omittedSessions: options.omittedSessions ?? 0,
    incompleteUsageSamples,
    summary: {
      totalTokens,
      peakDailyTokens,
      longestSessionMs: completedTurnCount === 0 ? null : longestSessionMs,
      currentStreakDays: currentStreak(humanDays, today),
      longestStreakDays: longestStreak(humanDays),
    },
    insights: {
      cacheHitRate,
      mostUsedModel: mostUsed(models),
      mostUsedReasoningEffort: mostUsed(efforts),
      uniqueSkills: skills.size,
      totalToolCalls: [...tools.values()].reduce((sum, count) => sum + count, 0),
      chatDays: humanDays.size,
    },
    activity,
    features,
  }
}
