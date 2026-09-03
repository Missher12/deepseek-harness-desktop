/** One provider-reported token bucket set. */
export interface UsageTokenBuckets {
  /** Input tokens not served by provider cache. */
  uncachedInput: number
  /** Generated output tokens, including reasoning. */
  output: number
  /** Input tokens served from provider cache. */
  cacheRead: number
  /** Input tokens written to provider cache. */
  cacheWrite: number
}

/** Derived activity for one local calendar day. */
export interface UsageDay {
  /** Gregorian date in `YYYY-MM-DD` form for the row's time zone. */
  date: string
  /** Human-authored user messages on the day. */
  humanMessages: number
  /** Provider-reported tokens attributed to the day. */
  tokens: number
  /** Native plus nested Code Mode tool starts on the day. */
  toolCalls: number
}

/** Privacy-minimal derived facts for one durable session lifecycle. */
export interface SessionUsageRow {
  /** Session identity used only as the cache key. */
  sessionId: string
  /** Immutable lifecycle identity witness. */
  createdAt: number
  /** Time zone used for all date-derived fields. */
  timeZone: string
  /** Last inspected event sequence, or -1 for an empty owned suffix. */
  lastSeq: number
  /** Disjoint provider token buckets. */
  tokens: UsageTokenBuckets
  /** Sum of the four token buckets. */
  totalTokens: number
  /** Provider usage samples omitted because they were unsafe. */
  incompleteUsageSamples: number
  /** Distinct turn/step provider usage samples accepted into the totals. */
  validUsageSamples: number
  /** Sum of completed turn durations; inter-turn idle time is excluded. */
  completedTurnDurationMs: number
  /** Completed turns included in the duration sum. */
  completedTurnCount: number
  /** Sorted non-empty local daily rows. */
  daily: UsageDay[]
  /** Request counts keyed by `provider/model`. */
  models: Record<string, number>
  /** Request counts keyed by adapter-owned effort id. */
  reasoningEfforts: Record<string, number>
  /** Invocation counts keyed by skill name. */
  skills: Record<string, number>
  /** Invocation counts keyed by tool name. */
  tools: Record<string, number>
}

/** Activity cell returned for the fixed 53-by-7 recent range. */
export interface UsageActivityDay extends UsageDay {
  /** Stable token-activity intensity: 0 for empty, 1 through 4 for active. */
  level: 0 | 1 | 2 | 3 | 4
}

/** Ranked feature kind supported by durable history. */
export type UsageFeatureKind = 'skill' | 'tool'

/** One bounded top-feature row. */
export interface UsageFeature {
  kind: UsageFeatureKind
  name: string
  count: number
}

/** Read-only bounded aggregate returned to the Settings client. */
export interface UsageInsightsSnapshot {
  generatedAt: number
  timeZone: string
  sessionCount: number
  omittedSessions: number
  incompleteUsageSamples: number
  summary: {
    totalTokens: number | null
    peakDailyTokens: number | null
    longestSessionMs: number | null
    currentStreakDays: number
    longestStreakDays: number
  }
  insights: {
    cacheHitRate: number | null
    mostUsedModel: string | null
    mostUsedReasoningEffort: string | null
    uniqueSkills: number
    totalToolCalls: number
    chatDays: number
  }
  activity: UsageActivityDay[]
  features: UsageFeature[]
}
