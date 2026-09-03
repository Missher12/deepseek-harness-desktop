/** Pure fold from one immutable session inspection to privacy-minimal usage facts. */

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { SessionUsageRow, UsageDay, UsageTokenBuckets } from './types.ts'
import { usageDateKey } from './calendar.ts'

interface UsageSample {
  readonly buckets: UsageTokenBuckets
  readonly date: string
  readonly model?: string
  readonly reasoningEffort?: string
}

interface DayAccumulator {
  humanMessages: number
  tokens: number
  toolCalls: number
}

const zeroTokens = (): UsageTokenBuckets => ({
  uncachedInput: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
})

/** Whether a provider count is exact enough to join persisted aggregates. */
function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Parse four disjoint provider buckets, rejecting the entire unsafe sample. */
function tokenBuckets(value: unknown): UsageTokenBuckets | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const usage = value as Record<string, unknown>
  const uncachedInput = usage.inputTokens
  const output = usage.outputTokens
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  if (![uncachedInput, output, cacheRead, cacheWrite].every(validCount)) return undefined
  return {
    uncachedInput: uncachedInput as number,
    output: output as number,
    cacheRead: cacheRead as number,
    cacheWrite: cacheWrite as number,
  }
}

/** Add one count into a deterministic name counter. */
function increment(map: Map<string, number>, name: string): void {
  if (name.length === 0) return
  map.set(name, (map.get(name) ?? 0) + 1)
}

/** Materialize a sorted plain record for JSON storage and stable tests. */
function recordOf(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map].sort(([left], [right]) => left.localeCompare(right)))
}

/** Return the mutable accumulator for one local day. */
function dayOf(days: Map<string, DayAccumulator>, date: string): DayAccumulator {
  let day = days.get(date)
  if (day === undefined) {
    day = { humanMessages: 0, tokens: 0, toolCalls: 0 }
    days.set(date, day)
  }
  return day
}

/** Extract a usage sample from a chunk or finalized assistant event. */
function usageOf(event: SessionEvent): { turn: number; step: number; usage: unknown } | undefined {
  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.chunk.usage }
  }
  if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.usage }
  }
  return undefined
}

/** Extract a skill name without retaining or returning the raw arguments. */
function skillNameFromArguments(argumentsJson: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const name = (parsed as Record<string, unknown>).name
    return typeof name === 'string' && name.length > 0 ? name : undefined
  } catch {
    return undefined
  }
}

/** Add two non-negative safe integers, or decline an unsafe aggregate. */
function safeSum(left: number, right: number): number | undefined {
  const sum = left + right
  return Number.isSafeInteger(sum) ? sum : undefined
}

/**
 * Fold one session's owned event suffix into a derived usage row.
 * @param header - Immutable session identity and persisted prefix facts.
 * @param events - Ordered durable events belonging to the session.
 * @param timeZone - IANA zone used for local calendar aggregation.
 * @param inheritedEventCount - Exact fork-inherited prefix length owned by persistence.
 * @returns Privacy-minimal usage facts for this session revision.
 */
export function foldSessionUsage(
  header: SessionHeader,
  events: readonly SessionEvent[],
  timeZone: string,
  inheritedEventCount = 0,
): SessionUsageRow {
  // Constructing the formatter validates the time zone even for an empty log.
  void usageDateKey(header.createdAt, timeZone)
  const days = new Map<string, DayAccumulator>()
  const models = new Map<string, number>()
  const reasoningEfforts = new Map<string, number>()
  const skills = new Map<string, number>()
  const tools = new Map<string, number>()
  const samples = new Map<string, UsageSample>()
  const routes = new Map<string, Pick<UsageSample, 'model' | 'reasoningEffort'>>()
  const openTurns = new Map<number, number>()
  let currentModel: string | undefined
  let currentReasoningEffort: string | undefined
  let completedTurnDurationMs = 0
  let completedTurnCount = 0
  let incompleteUsageSamples = 0

  for (const item of events) {
    if (item.seq < inheritedEventCount) continue
    const type = item.type as string
    const data = item.data as unknown as Record<string, unknown>
    const date = usageDateKey(item.time, timeZone)

    if (item.type === 'user/message') {
      const source = item.data.source as { kind?: string; name?: string }
      if (source.kind === 'user') dayOf(days, date).humanMessages += 1
      if (source.kind === 'skill-invocation' && typeof source.name === 'string') increment(skills, source.name)
    } else if (item.type === 'request/header') {
      const config = item.data.header.config
      currentModel = `${config.provider}/${config.model}`
      currentReasoningEffort = config.reasoningEffort
    } else if (item.type === 'turn/start') {
      openTurns.set(item.data.turn, item.time)
    } else if (item.type === 'turn/end') {
      const startedAt = openTurns.get(item.data.turn)
      openTurns.delete(item.data.turn)
      if (startedAt !== undefined && item.time >= startedAt) {
        const duration = safeSum(completedTurnDurationMs, item.time - startedAt)
        if (duration !== undefined) {
          completedTurnDurationMs = duration
          completedTurnCount += 1
        }
      }
    }

    if (type === 'tool/call' || type === 'tool/code-dispatch-start') {
      const name = data.name
      if (typeof name === 'string' && name.length > 0) {
        increment(tools, name)
        dayOf(days, date).toolCalls += 1
        if (type === 'tool/call' && name === 'skill' && typeof data.arguments === 'string') {
          const skillName = skillNameFromArguments(data.arguments)
          if (skillName !== undefined) increment(skills, skillName)
        }
      }
    }

    const observed = usageOf(item)
    if (observed !== undefined) {
      const buckets = tokenBuckets(observed.usage)
      if (buckets === undefined) {
        incompleteUsageSamples += 1
      } else {
        const key = `${observed.turn}:${observed.step}`
        samples.set(key, {
          buckets,
          date,
          ...currentModel === undefined ? {} : { model: currentModel },
          ...currentReasoningEffort === undefined ? {} : { reasoningEffort: currentReasoningEffort },
        })
        routes.set(key, {
          ...currentModel === undefined ? {} : { model: currentModel },
          ...currentReasoningEffort === undefined ? {} : { reasoningEffort: currentReasoningEffort },
        })
      }
    } else if (item.type === 'assistant/message') {
      const key = `${item.data.turn}:${item.data.step}`
      routes.set(key, {
        ...currentModel === undefined ? {} : { model: currentModel },
        ...currentReasoningEffort === undefined ? {} : { reasoningEffort: currentReasoningEffort },
      })
    }
  }

  const tokens = zeroTokens()
  let totalTokens = 0
  let validUsageSamples = 0
  for (const sample of samples.values()) {
    const nextUncached = safeSum(tokens.uncachedInput, sample.buckets.uncachedInput)
    const nextOutput = safeSum(tokens.output, sample.buckets.output)
    const nextRead = safeSum(tokens.cacheRead, sample.buckets.cacheRead)
    const nextWrite = safeSum(tokens.cacheWrite, sample.buckets.cacheWrite)
    const sampleTotal = [
      sample.buckets.uncachedInput,
      sample.buckets.output,
      sample.buckets.cacheRead,
      sample.buckets.cacheWrite,
    ].reduce<number | undefined>((sum, value) => sum === undefined ? undefined : safeSum(sum, value), 0)
    const nextTotal = sampleTotal === undefined ? undefined : safeSum(totalTokens, sampleTotal)
    if ([nextUncached, nextOutput, nextRead, nextWrite, sampleTotal, nextTotal].some(value => value === undefined)) {
      incompleteUsageSamples += 1
      continue
    }
    tokens.uncachedInput = nextUncached as number
    tokens.output = nextOutput as number
    tokens.cacheRead = nextRead as number
    tokens.cacheWrite = nextWrite as number
    totalTokens = nextTotal as number
    const day = dayOf(days, sample.date)
    day.tokens += sampleTotal as number
    validUsageSamples += 1
  }

  for (const route of routes.values()) {
    if (route.model !== undefined) increment(models, route.model)
    if (route.reasoningEffort !== undefined) increment(reasoningEfforts, route.reasoningEffort)
  }

  const daily: UsageDay[] = [...days]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, day]) => ({ date, ...day }))

  return {
    sessionId: header.id,
    createdAt: header.createdAt,
    timeZone,
    lastSeq: events.at(-1)?.seq ?? -1,
    tokens,
    totalTokens,
    incompleteUsageSamples,
    validUsageSamples,
    completedTurnDurationMs,
    completedTurnCount,
    daily,
    models: recordOf(models),
    reasoningEfforts: recordOf(reasoningEfforts),
    skills: recordOf(skills),
    tools: recordOf(tools),
  }
}
