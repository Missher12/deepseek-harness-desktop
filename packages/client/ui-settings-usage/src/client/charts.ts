/** Client-only particle projections over the Host's fixed recent activity range. */

import type { UsageActivityDay } from '@deepseek-ai/dsh-api-remotes/client'

/** The three aggregation scopes rendered by the same 53 x 7 particle field. */
export type ParticleChartMode = 'daily' | 'weekly' | 'cumulative'

/** One particle after applying the selected display scope. */
export interface UsageParticle {
  /** The physical day represented by this stable particle position. */
  date: string
  /** Tokens shown on hover for the selected scope. */
  tokens: number
  /** Four-step intensity for the selected scope; zero remains an idle particle. */
  level: UsageActivityDay['level']
  /** Inclusive start of the hover scope. */
  periodStart: string
  /** Inclusive end of the hover scope. */
  periodEnd: string
  /** Calendar date named by the scope-specific hover copy. */
  labelDate: string
}

/** One seven-day chronological column. */
export type UsageWeek<T> = readonly [T, ...T[]]

/** Map a proven non-empty week while preserving that fact in its result type. */
function mapWeek<T, R>(week: UsageWeek<T>, visit: (value: T, index: number) => R): UsageWeek<R> {
  return week.map(visit) as [R, ...R[]]
}

/**
 * Split the fixed 371-day range into 53 chronological seven-day columns.
 * @param activity - Chronological daily values in the fixed activity range.
 * @returns Chronological seven-day columns without reordering any value.
 */
export function buildDailyGrid<T>(activity: readonly T[]): UsageWeek<T>[] {
  const weeks: UsageWeek<T>[] = []
  for (let index = 0; index < activity.length; index += 7) {
    // The loop guard proves every slice has at least its first item.
    weeks.push(activity.slice(index, index + 7) as [T, ...T[]])
  }
  return weeks
}

/** Map a positive aggregate onto one to seven filled particles. */
function logarithmicRows(tokens: number, maximum: number): number {
  if (tokens <= 0 || maximum <= 0) return 0
  const ratio = Math.log1p(tokens) / Math.log1p(maximum)
  return Math.min(7, Math.max(1, Math.ceil(ratio * 7)))
}

/** Map a positive aggregate onto the same four relative color levels as a day. */
function logarithmicLevel(tokens: number, maximum: number): UsageActivityDay['level'] {
  if (tokens <= 0 || maximum <= 0) return 0
  const level = Math.ceil(4 * Math.log1p(tokens) / Math.log1p(maximum))
  return Math.min(4, Math.max(1, level)) as 1 | 2 | 3 | 4
}

/** Preserve a readable bottom-up progression for an already cumulative series. */
function cumulativeRows(tokens: number, maximum: number): number {
  if (tokens <= 0 || maximum <= 0) return 0
  return Math.min(7, Math.max(1, Math.ceil(tokens / maximum * 7)))
}

/** Fill a seven-particle column from bottom to top at one aggregate intensity. */
function stackLevel(
  row: number,
  filledRows: number,
  level: UsageActivityDay['level'],
): UsageActivityDay['level'] {
  return row >= 7 - filledRows ? level : 0
}

/**
 * Keep every physical day particle while changing only its aggregate token
 * value, hover period, and intensity. Weekly mode repeats one weekly total
 * across that week's seven particles; cumulative mode advances the running
 * all-range total one day at a time.
 * @param activity - Chronological fixed-range daily activity from the Host.
 * @param mode - Aggregate scope projected over the stable particle positions.
 * @param baselineTokens - Tokens preceding the visible range for cumulative mode.
 * @returns Stable seven-day columns with scope-specific hover and intensity data.
 */
export function buildParticleGrid(
  activity: readonly UsageActivityDay[],
  mode: ParticleChartMode,
  baselineTokens = 0,
): UsageWeek<UsageParticle>[] {
  if (mode === 'daily') {
    return buildDailyGrid(activity.map(day => ({
      date: day.date,
      tokens: day.tokens,
      level: day.level,
      periodStart: day.date,
      periodEnd: day.date,
      labelDate: day.date,
    })))
  }

  if (mode === 'weekly') {
    const sourceWeeks = buildDailyGrid(activity)
    const totals = sourceWeeks.map(week => ({
      tokens: week.reduce((sum, day) => sum + day.tokens, 0),
      week,
    }))
    const maximum = Math.max(0, ...totals.map(item => item.tokens))
    return totals.map(({ tokens, week }) => {
      const periodStart = week[0].date
      const periodEnd = (week[week.length - 1] as UsageActivityDay).date
      const filledRows = logarithmicRows(tokens, maximum)
      const level = logarithmicLevel(tokens, maximum)
      return mapWeek(week, (day, row) => ({
        date: day.date,
        tokens,
        level: stackLevel(row, filledRows, level),
        periodStart,
        periodEnd,
        labelDate: periodStart,
      }))
    })
  }

  const sourceWeeks = buildDailyGrid(activity)
  if (sourceWeeks.length === 0) return []
  const cumulative: Array<{ tokens: number; week: UsageWeek<UsageActivityDay> }> = []
  let running = Math.max(0, baselineTokens)
  for (const week of sourceWeeks) {
    running += week.reduce((sum, day) => sum + day.tokens, 0)
    cumulative.push({ tokens: running, week })
  }
  const maximum = running
  const rangeStart = (activity[0] as UsageActivityDay).date
  return cumulative.map(({ tokens, week }) => {
    const labelDate = week[0].date
    const periodEnd = (week[week.length - 1] as UsageActivityDay).date
    const filledRows = cumulativeRows(tokens, maximum)
    const level = logarithmicLevel(tokens, maximum)
    return mapWeek(week, (day, row) => ({
      date: day.date,
      tokens,
      level: stackLevel(row, filledRows, level),
      periodStart: rangeStart,
      periodEnd,
      labelDate,
    }))
  })
}
