/**
 * Client-side money figures for the stats line: per-model CNY pricing for
 * the session cost estimate and the account-balance bridge bootstrap.
 *
 * Prices mirror the current official DeepSeek V4 price list (CNY per 1M
 * tokens, https://api-docs.deepseek.com/zh-cn/quick_start/pricing), including
 * its Beijing-time peak windows. Cache writes are billed at the cache-miss
 * rate, matching the provider's billing buckets. The session cost remains an
 * estimate because Harness projects provider usage rather than reconciling
 * the provider invoice.
 *
 * @module @deepseek-ai/dsh-client-ui-conversation/usage-money
 */

import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'

/** One model's per-1M-token CNY prices. */
export interface ModelPriceCny {
  /** Input tokens served from provider cache. */
  cacheHit: number
  /** Input tokens missing the cache; cache writes bill here too. */
  cacheMiss: number
  /** Generated output tokens. */
  output: number
}

interface TieredModelPriceCny {
  peak: ModelPriceCny
  offPeak: ModelPriceCny
}

/** Official V4 model prices; unknown models report no estimate. */
const V4_PRICES: Readonly<Record<string, TieredModelPriceCny>> = {
  'deepseek-v4-flash': {
    peak: { cacheHit: 0.1, cacheMiss: 3, output: 9 },
    offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
  },
  'deepseek-v4-pro': {
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
  'deepseek-v4-flash-vision-exp': {
    peak: { cacheHit: 0.1, cacheMiss: 3, output: 9 },
    offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
  },
}

/** Beijing-time price windows exposed to the footer. */
export type PricingTier = 'weekday-peak' | 'weekday-off-peak' | 'weekend-off-peak'

/**
 * Resolve the official Beijing-time tier, including all-day weekend discounts.
 * @param at - instant to classify after conversion to Beijing time.
 * @returns the active weekday peak, weekday off-peak, or weekend off-peak tier.
 */
export function pricingTierAt(at = new Date()): PricingTier {
  const beijing = new Date(at.getTime() + 8 * 60 * 60 * 1_000)
  const day = beijing.getUTCDay()
  if (day === 0 || day === 6) return 'weekend-off-peak'
  const hour = beijing.getUTCHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
    ? 'weekday-peak'
    : 'weekday-off-peak'
}

/**
 * Resolve the current official price for one model.
 * @param model - billed model id, when the durable projection identified one.
 * @param at - instant used to select the official Beijing-time price tier.
 * @returns the official CNY price, or null for an unknown model.
 */
export function priceOfModel(model: string | undefined, at = new Date()): ModelPriceCny | null {
  if (model === undefined) return null
  const prices = V4_PRICES[model]
  if (prices === undefined) return null
  return pricingTierAt(at) === 'weekday-peak' ? prices.peak : prices.offPeak
}

/**
 * Whole-session cost estimate in CNY, or null when the session's single model
 * has no known price. Totals are a whole-log projection, so paging and
 * compaction cannot move the figure.
 * @param usage - the session's token-usage projection.
 * @param model - the single billed model id selected by the caller.
 * @param at - instant used to select the official Beijing-time price tier.
 * @returns the CNY estimate, or null when unpriced.
 */
export function sessionCostCny(
  usage: TokenUsageProjection,
  model: string | undefined,
  at = new Date(),
): number | null {
  const price = priceOfModel(model, at)
  if (price === null) return null
  const inputMissTokens = usage.uncachedInputTokens + usage.cacheWriteTokens
  return (inputMissTokens * price.cacheMiss
    + usage.cacheReadTokens * price.cacheHit
    + usage.outputTokens * price.output) / 1_000_000
}

/**
 * Format a compact CNY estimate with extra precision below one cent.
 * @param value - non-negative CNY estimate.
 * @returns a compact decimal without a currency prefix.
 */
export function formatCny(value: number): string {
  if (value > 0 && value < 0.0001) return '<0.0001'
  const digits = value < 0.01 ? 4 : 2
  return value.toFixed(digits)
}

/**
 * Format an exact provider balance with an explicit currency marker.
 * @param value - validated non-negative provider balance.
 * @param currency - provider currency code, or null when unavailable.
 * @returns the formatted balance, or null for an unavailable currency.
 */
export function formatBalance(value: number, currency: string | null): string | null {
  if (currency === 'CNY') return `¥${value.toFixed(2)}`
  if (currency === 'USD') return `$${value.toFixed(2)}`
  if (currency === null) return null
  return `${currency} ${value.toFixed(2)}`
}

/** Frozen facts the Host injected into the page generation. */
export interface BalanceBootstrap {
  path: string
  capabilityHeader: string
  capability: string
}

/**
 * Read the immutable page-generation bootstrap, when the Host bridge mounted.
 * @returns validated same-origin transport facts, or null outside a mounted generation.
 */
export function readBalanceBootstrap(): BalanceBootstrap | null {
  if (typeof window === 'undefined') return null
  const value = window.__DSH_DEEPSEEK_BALANCE__
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.path !== 'string'
    || typeof candidate.capabilityHeader !== 'string'
    || typeof candidate.capability !== 'string') return null
  return {
    path: candidate.path,
    capabilityHeader: candidate.capabilityHeader,
    capability: candidate.capability,
  }
}

/** The client-visible balance snapshot mirror of the Host's validated record. */
export interface BalanceSnapshot {
  fetchedAt: number
  currency: string | null
  totalBalance: number | null
  grantedBalance: number | null
  toppedUpBalance: number | null
  error: string | null
}

function parseBalanceSnapshot(value: unknown): BalanceSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const money = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
  const text = (v: unknown): string | null =>
    typeof v === 'string' && v !== '' ? v : null
  return {
    fetchedAt: typeof record.fetchedAt === 'number' ? record.fetchedAt : 0,
    currency: text(record.currency),
    totalBalance: money(record.totalBalance),
    grantedBalance: money(record.grantedBalance),
    toppedUpBalance: money(record.toppedUpBalance),
    error: text(record.error),
  }
}

/**
 * Fetch one cached account-balance snapshot through the same-origin bridge.
 * @param bootstrap - the validated page-generation bootstrap.
 * @returns the snapshot, or null when the bridge answers nothing readable.
 */
export async function fetchBalanceSnapshot(bootstrap: BalanceBootstrap): Promise<BalanceSnapshot | null> {
  try {
    const response = await fetch(bootstrap.path, {
      method: 'GET',
      headers: { [bootstrap.capabilityHeader]: bootstrap.capability },
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (!response.ok) return null
    return parseBalanceSnapshot(await response.json())
  } catch {
    return null
  }
}

declare global {
  interface Window {
    __DSH_DEEPSEEK_BALANCE__?: unknown
  }
}
