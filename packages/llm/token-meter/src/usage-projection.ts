/**
 * Pure folds for durable provider-reported token usage and context occupancy.
 */

import { z } from 'zod'
import { lastAssistantStreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {
  ContextPressureProjection, LatestTurnBillingProjection, TokenBillingModelProjection, TokenUsageProjection,
} from './projection.ts'
import { foldSurfaceProjection } from './surface-projection.ts'

const zeroBuckets = (): TokenUsageProjection => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

const bucketsFrom = (usage: TokenUsage): TokenUsageProjection => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
})

const bucketsEqual = (left: TokenUsageProjection, right: TokenUsageProjection): boolean =>
  left.uncachedInputTokens === right.uncachedInputTokens
  && left.outputTokens === right.outputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens

const addReplacing = (
  totals: TokenUsageProjection,
  previous: TokenUsageProjection | undefined,
  next: TokenUsageProjection,
): TokenUsageProjection => ({
  uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
  outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
  cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
  cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
})

const projectionSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

/**
 * The token-usage unit's state schema — the one definition of the state
 * shape; the state type is inferred from it.
 */
const tokenUsageStateSchema = z.object({
  totals: projectionSchema,
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    buckets: projectionSchema,
  }).nullable(),
}).strict()

type TokenUsageState = z.infer<typeof tokenUsageStateSchema>

const pressureSchema: z.ZodType<ContextPressureProjection> = z.object({
  pressureTokens: z.number().int().nonnegative().optional(),
  projectedTokens: z.number().int().nonnegative().optional(),
  contextWindow: z.number().int().positive().optional(),
}).strict().transform(({ pressureTokens, projectedTokens, contextWindow }) => ({
  ...pressureTokens === undefined ? {} : { pressureTokens },
  ...projectedTokens === undefined ? {} : { projectedTokens },
  ...contextWindow === undefined ? {} : { contextWindow },
}))

/** Prompt-side pressure of one request: input plus cache traffic, no output. */
const pressureFrom = (usage: TokenUsage): number =>
  usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)

/** The usage one durable Assistant settlement reports for its attempt, if any. */
function usageOf(event: SessionEvent): TokenUsage | undefined {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    tokenUsage: TokenUsageState
    tokenBillingModel: BillingModelState
    latestTurnBilling: LatestTurnBillingState
    contextPressure: ContextPressureState
  }
}

/** The context-pressure state schema and source of its inferred type. */
const contextPressureStateSchema = z.object({
  contextWindow: z.number().int().positive().optional(),
  pressureTokens: z.number().int().nonnegative().optional(),
  surfaceTokens: z.number().int().nonnegative(),
  sampledSurfaceTokens: z.number().int().nonnegative().optional(),
  claim: z.object({
    start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq),
    end: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq),
    tokens: z.number().int().nonnegative(),
  }).optional(),
}).strict()

type ContextPressureState = z.infer<typeof contextPressureStateSchema>

/**
 * Token-meter's session projection unit.
 *
 * Each v2 Assistant settlement contributes the last usage sample embedded in
 * its stream. `llm/retry-started` closes the replacement slot so the retried
 * attempt adds to the total.
 */
export const tokenUsageProjectionDefinition = {
  key: 'tokenUsage',
  stateVersion: 2,
  stateSchema: tokenUsageStateSchema,
  init: () => ({ totals: zeroBuckets(), last: null }),
  apply: (state, event) => {
    if (event.type === 'llm/retry-started') {
      return state.last?.turn === event.data.turn && state.last.step === event.data.step
        ? { ...state, last: null }
        : state
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') {
      return state
    }
    const sample = usageOf(event)
    if (sample === undefined) return state
    const { turn, step } = event.data
    const usage: TokenUsage = sample

    const buckets = bucketsFrom(usage)
    const previous = state.last !== null
      && state.last.turn === turn
      && state.last.step === step
      ? state.last.buckets
      : undefined
    if (previous !== undefined && bucketsEqual(previous, buckets)) return state

    return {
      totals: addReplacing(state.totals, previous, buckets),
      last: { turn, step, buckets },
    }
  },
  wire: { viewSchema: projectionSchema, view: state => state.totals },
} satisfies ProjectionDefinition<'tokenUsage', TokenUsageState>

const billingModelSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('single'), provider: z.string().min(1), model: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('mixed') }).strict(),
]) as z.ZodType<TokenBillingModelProjection>

const billingRouteSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
}).strict()

const billingModelStateSchema = z.object({
  current: billingRouteSchema.optional(),
  billing: billingModelSchema,
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    route: billingRouteSchema.optional(),
    before: billingModelSchema,
  }).strict().optional(),
}).strict()

type BillingRoute = z.infer<typeof billingRouteSchema>
type BillingModelState = z.infer<typeof billingModelStateSchema>

const sameBillingRoute = (left: BillingRoute | undefined, right: BillingRoute | undefined): boolean =>
  left?.provider === right?.provider && left?.model === right?.model

const mergeBillingRoute = (
  state: TokenBillingModelProjection,
  route: BillingRoute | undefined,
): TokenBillingModelProjection => {
  if (route === undefined || state.kind === 'mixed') return { kind: 'mixed' }
  if (state.kind === 'none') return { kind: 'single', ...route }
  return state.provider === route.provider && state.model === route.model
    ? state
    : { kind: 'mixed' }
}

const latestTurnViewSchema: z.ZodType<LatestTurnBillingProjection | null> = z.object({
  turn: z.number().int().nonnegative(),
  settledAt: z.number().int().nonnegative(),
  billingModel: billingModelSchema,
  ...projectionSchema.shape,
}).strict().nullable()

const latestTurnDraftSchema = z.object({
  turn: z.number().int().nonnegative(),
  totals: projectionSchema,
  billing: billingModelSchema,
  last: z.object({
    step: z.number().int().nonnegative(),
    buckets: projectionSchema,
    route: billingRouteSchema.optional(),
    beforeBilling: billingModelSchema,
  }).optional(),
}).strict()

const latestTurnBillingStateSchema = z.object({
  current: billingRouteSchema.optional(),
  draft: latestTurnDraftSchema.optional(),
  settled: latestTurnViewSchema,
}).strict()

type LatestTurnBillingState = z.infer<typeof latestTurnBillingStateSchema>

/** Latest billed turn, deliberately hidden from the wire until `turn/end`. */
export const latestTurnBillingProjectionDefinition = {
  key: 'latestTurnBilling',
  stateVersion: 2,
  stateSchema: latestTurnBillingStateSchema,
  init: () => ({ settled: null }),
  apply: (state, event) => {
    if (event.type === 'request/header') {
      const route = event.data.header.config
      const current = { provider: route.provider, model: route.model }
      return sameBillingRoute(state.current, current) ? state : { ...state, current }
    }
    if (event.type === 'turn/end') {
      if (state.draft?.turn !== event.data.turn) return state
      return {
        ...state,
        settled: {
          turn: state.draft.turn,
          settledAt: event.time,
          billingModel: state.draft.billing,
          ...state.draft.totals,
        },
      }
    }

    if (event.type === 'llm/retry-started' && state.draft?.turn === event.data.turn
      && state.draft.last?.step === event.data.step) {
      const { last: _last, ...draft } = state.draft
      return { ...state, draft }
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state
    const usage = usageOf(event)
    if (usage === undefined) return state
    const { turn, step } = event.data
    const route = event.type === 'assistant/message'
      ? { provider: event.data.message.source.provider, model: event.data.message.source.model }
      : state.current

    const draft = state.draft?.turn === turn
      ? state.draft
      : { turn, totals: zeroBuckets(), billing: { kind: 'none' as const } }
    const sameStep = draft.last?.step === step ? draft.last : undefined
    const buckets = bucketsFrom(usage)
    const beforeBilling = sameStep?.beforeBilling ?? draft.billing
    return {
      ...state,
      draft: {
        turn,
        totals: addReplacing(draft.totals, sameStep?.buckets, buckets),
        billing: mergeBillingRoute(beforeBilling, route),
        last: { step, buckets, ...route === undefined ? {} : { route }, beforeBilling },
      },
    }
  },
  wire: { viewSchema: latestTurnViewSchema, view: state => state.settled },
} satisfies ProjectionDefinition<'latestTurnBilling', LatestTurnBillingState>

/**
 * Durable billing-route projection. It waits for a finalized usage-bearing
 * assistant message so the provider/model identity comes from the exact
 * completed result rather than the currently visible or pending request.
 */
export const tokenBillingModelProjectionDefinition = {
  key: 'tokenBillingModel',
  stateVersion: 2,
  stateSchema: billingModelStateSchema,
  init: () => ({ billing: { kind: 'none' } }),
  apply: (state, event) => {
    if (event.type === 'request/header') {
      const next = event.data.header.config
      if (sameBillingRoute(state.current, next)) return state
      return { ...state, current: { provider: next.provider, model: next.model } }
    }

    if (event.type === 'llm/retry-started' && state.last?.turn === event.data.turn
      && state.last.step === event.data.step) {
      const { last: _last, ...next } = state
      return next
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state
    if (usageOf(event) === undefined) return state
    const { turn, step } = event.data
    const route = event.type === 'assistant/message'
      ? { provider: event.data.message.source.provider, model: event.data.message.source.model }
      : state.current

    const sameStep = state.last !== undefined
      && state.last.turn === turn
      && state.last.step === step
      ? state.last
      : undefined
    if (sameStep !== undefined && sameBillingRoute(sameStep.route, route)) return state
    const before = sameStep?.before ?? state.billing
    return {
      ...state,
      billing: mergeBillingRoute(before, route),
      last: { turn, step, ...route === undefined ? {} : { route }, before },
    }
  },
  wire: { viewSchema: billingModelSchema, view: state => state.billing },
} satisfies ProjectionDefinition<'tokenBillingModel', BillingModelState>

/**
 * Token-meter's context-occupancy projection unit.
 *
 * Independent last-wins slots: the newest usage sample supplies the provider
 * numerator, the newest `request/context` record the denominator. Both are
 * whole values, so replay order alone decides the result and no cross-field
 * consistency is claimed — the pair is explicitly not one atomic request
 * observation (see {@link ContextPressureProjection}).
 *
 * `pressureTokens` is prompt-side only, so it holds still while a turn streams
 * and steps forward once the next request reports its usage. Because nothing
 * but a request reports usage, it also cannot see a compaction: the fold
 * therefore carries a running surface total alongside it and publishes
 * `projectedTokens` — the sample plus the surface's signed movement since it
 * was taken — so occupancy answers for the next request rather than the last
 * one. The total rides {@link foldSurfaceProjection}, so the state stays O(1)
 * and a replacement shrinks it by its logged shadow price. A replacement
 * without a claim preserves the previous total. A usage sample is stamped
 * BEFORE the same event joins the surface, so an `assistant/message` anchors
 * against the surface its own request saw.
 */
export const contextPressureProjectionDefinition = {
  key: 'contextPressure',
  stateVersion: 4,
  stateSchema: contextPressureStateSchema,
  init: () => ({ surfaceTokens: 0 }),
  apply: (state, event) => {
    const fold = foldSurfaceProjection(state.claim, event)
    let next = state
    if (event.type === 'request/context') {
      const contextWindow = event.data.contextWindow
      if (contextWindow !== state.contextWindow) {
        if (contextWindow !== undefined) {
          next = { ...next, contextWindow }
        } else {
          const { contextWindow: _removed, ...withoutContextWindow } = next
          next = withoutContextWindow
        }
      }
    }
    const usage = usageOf(event)
    if (usage !== undefined) {
      const pressureTokens = pressureFrom(usage)
      if (pressureTokens !== next.pressureTokens || next.sampledSurfaceTokens !== next.surfaceTokens) {
        next = { ...next, pressureTokens, sampledSurfaceTokens: next.surfaceTokens }
      }
    }
    if (fold.deltaTokens !== 0) {
      next = { ...next, surfaceTokens: next.surfaceTokens + fold.deltaTokens }
    }
    // A defined fold.claim is always freshly built, so presence decides claim
    // bookkeeping: no claim before or after this event leaves `next` as is.
    if (state.claim === undefined && fold.claim === undefined) return next
    const { claim: _expired, ...withoutClaim } = next
    return fold.claim === undefined ? withoutClaim : { ...withoutClaim, claim: fold.claim }
  },
  wire: {
    viewSchema: pressureSchema,
    view: ({ contextWindow, pressureTokens, surfaceTokens, sampledSurfaceTokens }) => ({
      ...contextWindow === undefined ? {} : { contextWindow },
      ...pressureTokens === undefined ? {} : { pressureTokens },
      ...pressureTokens === undefined || sampledSurfaceTokens === undefined
        ? {}
        : { projectedTokens: Math.max(0, pressureTokens + surfaceTokens - sampledSurfaceTokens) },
    }),
  },
} satisfies ProjectionDefinition<'contextPressure', ContextPressureState>
