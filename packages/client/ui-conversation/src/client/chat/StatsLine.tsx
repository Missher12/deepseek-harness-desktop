// Settled-node identity prevents stream-delta updates from rerendering this row.
// Mounted on 'conversation.composer.dock' so it sticks with the composer in the
// active conversation scrollport (see ConversationRoot data-conversation-scroll).

import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ConversationSnapshot, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the sessionStats key into SessionProjectionMap for useProjection.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type {
  ContextPressureProjection, LatestTurnBillingProjection, TokenUsageProjection,
} from '@deepseek-ai/dsh-token-meter/client'
import type { ComposerBarProps } from '../contract/slots.ts'
import { formatTokensPerSecond } from './message-chrome.ts'
import { assistantStepReading } from './turn-metrics.ts'
import {
  fetchBalanceSnapshot, formatBalance, formatCny, priceOfModel, pricingTierAt,
  readBalanceBootstrap, sessionCostCny,
  type BalanceSnapshot,
} from './usage-money.ts'
import css from './StatsLine.module.css'

interface WindowStats {
  turns: number
  steps: number
  /** Summed request wall time (step/start → assistant/message); 0 when no node carries timing. */
  llmMs: number
  /** Summed tool wall time (tool/call → tool/result); 0 when no pair is in-window. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`; 0 when no step records it. */
  ttftMs: number
  /** Steps carrying a recorded TTFT. */
  ttftSteps: number
  /** Summed decode wall time over steps that also report output tokens. */
  decodeMs: number
  /** Summed output tokens over the same decode-timed steps. */
  decodeTokens: number
}

/**
 * Fold assistant and tool-result nodes into window-scoped display totals —
 * the FALLBACK for assemblies without the `sessionStats` projection.
 *
 * Every displayed figure rides that durable whole-log projection (and token
 * accounting rides `tokenUsage`) because the window is paged and compaction
 * rewrites it; this fold answers "what is on screen" only when no projection
 * value is served. Its field names deliberately mirror the projection's so
 * the two swap wholesale.
 * @param nodes - snapshot nodes.
 * @returns fallback counts and summed wall times.
 */
export function deriveStats(nodes: ConversationSnapshot['nodes']): WindowStats {
  const turns = new Set<number>()
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime)
      continue
    }
    if (node.kind !== 'assistant') continue
    turns.add(node.turn)
    steps += 1
    if (node.timing !== undefined && node.timing.stepStartTime !== null) {
      llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
    }
    const reading = assistantStepReading(node)
    if (reading.ttftMs !== null) {
      ttftMs += reading.ttftMs
      ttftSteps += 1
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      decodeMs += reading.decodeMs
      decodeTokens += reading.outputTokens
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
}

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @returns display string.
 */
export function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Round a cache-read ratio to an integer percentage, with positive ties rounded up. */
function roundedIntegerPercent(cacheReadTokens: number, denominator: number): number {
  const denominatorQuotient = Math.floor(denominator / 200)
  const denominatorRemainder = denominator % 200
  let lower = 0
  let upper = 100
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2)
    const factor = candidate * 2 - 1
    const threshold = factor * denominatorQuotient
      + Math.ceil(factor * denominatorRemainder / 200)
    if (cacheReadTokens >= threshold) {
      lower = candidate
    } else {
      upper = candidate - 1
    }
  }
  return lower
}

/**
 * Display-ready cache-hit share of prompt-side input over the whole durable log.
 * @param usage - the session's token-usage projection value.
 * @returns integer text when integer rounding stays below 100, otherwise the
 * minimum decimal precision that still rounds below 100; a full hit returns
 * 100, and no billed input returns null.
 */
export function cacheHitPercent(usage: TokenUsageProjection): string | null {
  const denominator = billedInputTokens(usage)
  if (denominator === 0) return null
  const missedInputTokens = usage.uncachedInputTokens + usage.cacheWriteTokens
  if (missedInputTokens === 0) return '100'

  const integerPercent = roundedIntegerPercent(usage.cacheReadTokens, denominator)
  if (integerPercent < 100) return String(integerPercent)

  // At the first distinguishing precision, the rounded result is 100 minus
  // one to five units in the final decimal place. Scale only while the next
  // multiplication remains at or below the denominator, then derive that
  // final digit through exact small-factor comparisons.
  let decimalPlaces = 1
  let scaledDoubleGap = missedInputTokens * 200
  const denominatorTens = Math.floor(denominator / 10)
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10
    decimalPlaces += 1
  }
  const denominatorOnes = denominator % 10
  let roundedLoss = 5
  for (let loss = 1; loss < 5; loss += 1) {
    const factor = loss * 2 + 1
    const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10)
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss
      break
    }
  }
  return `99.${'9'.repeat(decimalPlaces - 1)}${10 - roundedLoss}`
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

interface ContextOccupancy {
  percent: number
  usedTokens: number
  contextWindow: number
}

/**
 * Approximate context occupancy, using the TUI's integer rounding and upper
 * clamp. The numerator is `projectedTokens` — the provider sample carried
 * forward over the surface's movement since — so compaction shows immediately
 * instead of waiting for the next request to report usage; it falls back to the
 * bare sample only for a log whose projection predates that field. Numerator
 * and capacity remain independent last-wins projection fields, so this is a
 * reference figure rather than an exact measurement of one request (see the
 * token-meter README).
 * @param pressure - the session's context-pressure projection value.
 * @returns occupancy with its numerator and denominator, or null until both values are known.
 */
export function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
): ContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/** Props: the conversation-snapshot selector plus the projection read seat. */
export interface StatsLineProps {
  useSession: SnapshotSelectorHook<ConversationSnapshot>
  useProjection: UseProjection
  /** The owning dock's locale seat. */
  t: ComposerBarProps['t']
}

interface DesktopEstimateBridge {
  getDesktopPreferences(): Promise<{ tieredPricingEstimates: boolean }>
  onDesktopPreferences(listener: (value: { tieredPricingEstimates: boolean }) => void): () => void
}

function estimateBridge(): DesktopEstimateBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const candidate = (window as unknown as { dshDesktop?: Partial<DesktopEstimateBridge> }).dshDesktop
  return typeof candidate?.getDesktopPreferences === 'function'
    && typeof candidate.onDesktopPreferences === 'function'
    ? candidate as DesktopEstimateBridge
    : undefined
}

function latestModel(latest: LatestTurnBillingProjection | null | undefined): string | undefined {
  return latest?.billingModel.kind === 'single'
    && latest.billingModel.provider === 'deepseek-official'
    ? latest.billingModel.model
    : undefined
}

export const StatsLine = memo(function StatsLine({ useSession, useProjection, t }: StatsLineProps) {
  const settledNodes = useSession(s => s.chat.legacy.nodes)
  const usage = useProjection('tokenUsage')
  // Every figure rides the durable sessionStats projection, so paging and
  // compaction cannot change any of them; an assembly without the unit falls
  // back to the window-scoped fold wholesale (same field names), paid only
  // while no projection value is served.
  const projected = useProjection('sessionStats')
  const stats = useMemo(() => projected ?? deriveStats(settledNodes), [projected, settledNodes])
  const billingModel = useProjection('tokenBillingModel')
  const latestBilling = useProjection('latestTurnBilling')
  const model = billingModel?.kind === 'single' && billingModel.provider === 'deepseek-official'
    ? billingModel.model
    : undefined
  // One wall-clock snapshot owns both price lookup and the visible tier. Its
  // aligned minute tick makes documented Beijing boundaries self-updating,
  // even when no conversation event causes another render.
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    let interval: number | undefined
    const tick = (): void => { setClock(new Date()) }
    const timeout = window.setTimeout(() => {
      tick()
      interval = window.setInterval(tick, 60_000)
    }, 60_000 - (Date.now() % 60_000))
    return () => {
      window.clearTimeout(timeout)
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [])
  // Account balance: fetched once on mount and re-read on a one-minute cycle
  // through the Host bridge. A mounted bridge's failed read is explicit; an
  // absent bridge remains absent because this capability is Desktop/Web-only.
  const [balance, setBalance] = useState<BalanceSnapshot | null>(null)
  const [balanceAttempted, setBalanceAttempted] = useState(false)
  const [tieredEstimates, setTieredEstimates] = useState(true)
  useEffect(() => {
    const bridge = estimateBridge()
    if (bridge === undefined) return
    let disposed = false
    void bridge.getDesktopPreferences().then((value) => {
      if (!disposed) setTieredEstimates(value.tieredPricingEstimates)
    }).catch(() => {})
    const unsubscribe = bridge.onDesktopPreferences((value) => {
      if (!disposed) setTieredEstimates(value.tieredPricingEstimates)
    })
    return () => { disposed = true; unsubscribe() }
  }, [])
  useEffect(() => {
    const bootstrap = readBalanceBootstrap()
    if (bootstrap === null) return
    let disposed = false
    const refresh = async (): Promise<void> => {
      const snapshot = await fetchBalanceSnapshot(bootstrap)
      if (!disposed) {
        setBalance(snapshot)
        setBalanceAttempted(true)
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])
  // Pipe-separated groups (figma stats strip); a group with no data drops out whole.
  const groups: string[] = []
  if (stats.steps > 0) {
    groups.push(t('stats.counts', { turns: stats.turns, steps: stats.steps }))
    const durations: string[] = []
    if (stats.llmMs > 0) durations.push(t('stats.llm', { duration: formatDuration(stats.llmMs) }))
    if (stats.toolMs > 0) durations.push(t('stats.toolCall', { duration: formatDuration(stats.toolMs) }))
    if (durations.length > 0) groups.push(durations.join(' · '))
    const speeds: string[] = []
    if (stats.ttftSteps > 0) {
      speeds.push(t('stats.ttftAverage', { duration: formatDuration(stats.ttftMs / stats.ttftSteps) }))
    }
    if (stats.decodeMs > 0) {
      speeds.push(t('stats.tokensPerSecond', {
        throughput: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
      }))
    }
    if (speeds.length > 0) groups.push(speeds.join(' · '))
  }
  // Context occupancy deliberately lives on the composer's ContextMeter ring,
  // not here — one home per fact.
  // Billing rides the durable projection, so these survive paging and
  // compaction. Gated on actual token activity: a session whose steps all
  // settled without billing (e.g. every request failed) shows its counts
  // without a zero-token group.
  if (usage !== undefined
    && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    const cacheHit = cacheHitPercent(usage)
    if (cacheHit !== null) groups.push(t('stats.cacheHit', { percent: cacheHit }))
    groups.push(t('stats.tokens', {
      input: formatTokens(billedInputTokens(usage)),
      output: formatTokens(usage.outputTokens),
    }))
  }
  const financialGroups: string[] = []
  if (tieredEstimates) {
    const turnModel = latestModel(latestBilling)
    const turnCost = latestBilling === null || latestBilling === undefined
      ? null
      : sessionCostCny(latestBilling, turnModel, clock)
    if (turnCost !== null && turnCost > 0) {
      financialGroups.push(t('stats.lastTurnCost', { cost: formatCny(turnCost) }))
    }
    if (usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
      const cost = sessionCostCny(usage, model, clock)
      if (cost !== null && cost > 0) financialGroups.push(t('stats.cost', { cost: formatCny(cost) }))
    }
  }
  if (balance?.totalBalance !== null && balance?.totalBalance !== undefined) {
    const formatted = formatBalance(balance.totalBalance, balance.currency)
    if (formatted !== null) financialGroups.push(t('stats.balance', { balance: formatted }))
  } else if (balanceAttempted) {
    financialGroups.push(t('stats.balanceUnavailable'))
  }
  if (tieredEstimates && priceOfModel(model, clock) !== null) {
    financialGroups.push(t(`stats.tier.${pricingTierAt(clock)}`))
  }
  const line = groups.join(' | ')
  // Keep clipped details in-flow: a floating tooltip can cross the workbench
  // boundary and cover either the composer or a native browser surface.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const pointerFocusRef = useRef(false)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const measure = () => {
      // An expanded row is intentionally no longer clipped. Preserve its
      // collapsed measurement until the user closes it again.
      if (expanded) return
      const clipped = el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight
      setTruncated(clipped)
      if (!clipped) setExpanded(false)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [expanded, line])
  if (groups.length === 0 && financialGroups.length === 0) return null
  return (
    <>
      {groups.length > 0 && <div
        ref={rootRef}
        className={css.root}
        role={truncated ? 'button' : undefined}
        tabIndex={truncated ? 0 : undefined}
        aria-expanded={truncated ? expanded : undefined}
        data-truncated={truncated ? 'true' : undefined}
        data-expanded={expanded ? 'true' : undefined}
        onPointerDown={truncated ? () => { pointerFocusRef.current = true } : undefined}
        onPointerCancel={truncated ? () => { pointerFocusRef.current = false } : undefined}
        onFocus={truncated ? () => {
          if (!pointerFocusRef.current) setExpanded(true)
          pointerFocusRef.current = false
        } : undefined}
        onBlur={truncated ? () => { pointerFocusRef.current = false } : undefined}
        onClick={truncated ? () => {
          pointerFocusRef.current = false
          setExpanded(value => !value)
        } : undefined}
        onKeyDown={truncated ? (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          setExpanded(value => !value)
        } : undefined}
      >
        {groups.map((group, i) => (
          <Fragment key={group}>
            {i > 0 && <>{' '}<span className={css.sep} aria-hidden>|</span>{' '}</>}
            <span>{group}</span>
          </Fragment>
        ))}
      </div>}
      {financialGroups.length > 0 && <div className={`${css.root} ${css.finance}`}>
        {financialGroups.map((group, i) => (
          <Fragment key={group}>
            {i > 0 && <>{' '}<span className={css.sep} aria-hidden>|</span>{' '}</>}
            <span>{group}</span>
          </Fragment>
        ))}
      </div>}
    </>
  )
})
