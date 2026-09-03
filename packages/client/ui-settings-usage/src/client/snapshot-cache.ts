import type { UsageInsightsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'

const STORAGE_KEY = 'dsh.usage-insights.snapshot.v1'
const STORAGE_VERSION = 1
const MAX_ACTIVITY_DAYS = 371
const MAX_FEATURES = 50

let latestSnapshot: UsageInsightsSnapshot | undefined

type RecordValue = Record<string, unknown>

/** Narrow an unknown JSON value without trusting persisted renderer data. */
function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNullableCount(value: unknown): value is number | null {
  return value === null || isFiniteCount(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 256)
}

/** Validate the bounded, aggregate-only snapshot persisted in localStorage. */
function isUsageSnapshot(value: unknown): value is UsageInsightsSnapshot {
  if (!isRecord(value) || !isRecord(value.summary) || !isRecord(value.insights)) return false
  if (!isFiniteCount(value.generatedAt) || typeof value.timeZone !== 'string' || value.timeZone.length > 128) return false
  if (!isFiniteCount(value.sessionCount) || !isFiniteCount(value.omittedSessions)
    || !isFiniteCount(value.incompleteUsageSamples)) return false
  const summary = value.summary
  if (!isNullableCount(summary.totalTokens) || !isNullableCount(summary.peakDailyTokens)
    || !isNullableCount(summary.longestSessionMs) || !isFiniteCount(summary.currentStreakDays)
    || !isFiniteCount(summary.longestStreakDays)) return false
  const insights = value.insights
  if (!isNullableCount(insights.cacheHitRate)
    || (typeof insights.cacheHitRate === 'number' && insights.cacheHitRate > 1)
    || !isNullableString(insights.mostUsedModel) || !isNullableString(insights.mostUsedReasoningEffort)
    || !isFiniteCount(insights.uniqueSkills) || !isFiniteCount(insights.totalToolCalls)
    || !isFiniteCount(insights.chatDays)) return false
  if (!Array.isArray(value.activity) || value.activity.length > MAX_ACTIVITY_DAYS) return false
  if (!value.activity.every((day) => {
    if (!isRecord(day)) return false
    return typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date)
      && isFiniteCount(day.humanMessages) && isFiniteCount(day.tokens) && isFiniteCount(day.toolCalls)
      && typeof day.level === 'number' && Number.isInteger(day.level) && day.level >= 0 && day.level <= 4
  })) return false
  if (!Array.isArray(value.features) || value.features.length > MAX_FEATURES) return false
  return value.features.every((feature) => {
    if (!isRecord(feature)) return false
    return (feature.kind === 'skill' || feature.kind === 'tool')
      && typeof feature.name === 'string' && feature.name.length > 0 && feature.name.length <= 256
      && isFiniteCount(feature.count)
  })
}

/** Access browser storage without letting privacy/quota policy break Settings. */
function durableStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/**
 * Read the last successful aggregate snapshot from memory or durable renderer storage.
 * @returns the retained snapshot, or undefined before the first successful read.
 */
export function readUsageSnapshot(): UsageInsightsSnapshot | undefined {
  if (latestSnapshot !== undefined) return latestSnapshot
  const storage = durableStorage()
  if (storage === undefined) return undefined
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return undefined
    const envelope: unknown = JSON.parse(raw)
    if (!isRecord(envelope) || envelope.version !== STORAGE_VERSION || !isUsageSnapshot(envelope.snapshot)) {
      storage.removeItem(STORAGE_KEY)
      return undefined
    }
    latestSnapshot = envelope.snapshot
  } catch {
    try { storage.removeItem(STORAGE_KEY) } catch { /* storage can be policy-disabled */ }
  }
  return latestSnapshot
}

/**
 * Replace the memory and aggregate-only durable snapshot after a successful refresh.
 * @param snapshot - immutable successful snapshot to retain for the next visit.
 */
export function writeUsageSnapshot(snapshot: UsageInsightsSnapshot): void {
  latestSnapshot = snapshot
  if (!isUsageSnapshot(snapshot)) return
  try {
    durableStorage()?.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, snapshot }))
  } catch {
    // localStorage quota/privacy failures must never make Usage Insights fail.
  }
}

/**
 * Clear isolated test state, optionally preserving durable bytes to emulate a renderer restart.
 * @param options - Cleanup options for the isolated renderer-cache fixture.
 */
export function resetUsageSnapshotForTest(options: { preserveStorage?: boolean } = {}): void {
  latestSnapshot = undefined
  if (options.preserveStorage === true) return
  try { durableStorage()?.removeItem(STORAGE_KEY) } catch { /* test cleanup remains best-effort */ }
}
