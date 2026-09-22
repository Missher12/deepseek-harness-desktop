// Settled-node identity prevents stream-delta updates from rerendering this row.
// Mounted on 'conversation.composer.dock' so it sticks with the composer in the
// active conversation scrollport (see ConversationRoot data-conversation-scroll).

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the sessionStats key into SessionProjectionMap for useProjection.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type { LatestTurnBillingProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { formatTokensPerSecond } from './message-chrome.ts'
import { formatTokens } from './token-format.ts'
import {
  fetchBalanceSnapshot, formatBalance, formatCny, priceOfModel, pricingTierAt,
  readBalanceBootstrap, sessionCostCny,
  type BalanceSnapshot,
} from './usage-money.ts'
import { billedInputTokens, cacheHitPercent, deriveStats, formatDuration } from './window-stats.ts'
import css from './StatsLine.module.css'

export { billedInputTokens, cacheHitPercent, deriveStats, formatDuration } from './window-stats.ts'

/** Props: the conversation-snapshot selector plus the projection read seat. */
export interface StatsLineProps {
  useChat: SnapshotSelectorHook<ChatSnapshot>
  useProjection: UseProjection
  /** The owning dock's locale seat. */
  t: ChatViewSlotProps['t']
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

function StatsGroups({ groups }: { readonly groups: readonly string[] }) {
  return groups.map((group, i) => (
    <Fragment key={group}>
      {i > 0 && <>{' '}<span className={css.sep} aria-hidden>|</span>{' '}</>}
      <span>{group}</span>
    </Fragment>
  ))
}

/** Keep one measured row through session loading, empty data, and settled totals. */
const StatsLineContent = memo(function StatsLineContent({
  groups,
  line,
}: {
  readonly groups: readonly string[]
  readonly line: string
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  const measure = useCallback(() => {
    const el = rootRef.current
    if (el === null) return
    const next = el.scrollWidth > el.clientWidth
    setTruncated(current => current === next ? current : next)
  }, [])
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [measure])
  useLayoutEffect(measure, [line, measure])
  return (
    <Tooltip label={line} side="top" delayMs={500} disabled={!truncated}>
      <div ref={rootRef} className={css.root} data-conversation-stats="">
        <StatsGroups groups={groups} />
      </div>
    </Tooltip>
  )
})

export const StatsLine = memo(function StatsLine({ useChat, useProjection, t }: StatsLineProps) {
  const settledNodes = useChat(s => s.legacy.nodes)
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
  // Timings can arrive with the assistant response before its tool step closes.
  // Keep every metric in place and display each fact independently of counts.
  const unavailable = t('stats.unavailable')
  const groups: string[] = [
    t('stats.lineCounts', { turns: stats.turns, steps: stats.steps }),
    [
      t('stats.llm', { duration: stats.llmMs > 0 ? formatDuration(stats.llmMs, t) : unavailable }),
      t('stats.toolCall', { duration: stats.toolMs > 0 ? formatDuration(stats.toolMs, t) : unavailable }),
    ].join(' · '),
    [
      t('stats.ttftAverage', {
        duration: stats.ttftSteps > 0 ? formatDuration(stats.ttftMs / stats.ttftSteps, t) : unavailable,
      }),
      t('stats.tokensPerSecond', {
        throughput: stats.decodeMs > 0
          ? formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000))
          : unavailable,
      }),
    ].join(' · '),
  ]
  // Context occupancy deliberately lives on the composer's ContextMeter ring,
  // not here — one home per fact.
  // Billing rides the durable projection. Until billed activity exists, show
  // unknown values rather than reporting a failed or pending request as free.
  const billedUsage = usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)
    ? usage
    : undefined
  groups.push(t('stats.cacheHit', { percent: billedUsage === undefined ? unavailable : cacheHitPercent(billedUsage) ?? unavailable }))
  groups.push(t('stats.tokens', {
    input: billedUsage === undefined ? unavailable : formatTokens(billedInputTokens(billedUsage), t),
    output: billedUsage === undefined ? unavailable : formatTokens(billedUsage.outputTokens, t),
  }))
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
  return (
    <>
      <StatsLineContent groups={groups} line={line} />
      {financialGroups.length > 0 && <div className={`${css.root} ${css.finance}`}>
        <StatsGroups groups={financialGroups} />
      </div>}
    </>
  )
})
