import { describe, expect, it } from 'vitest'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import {
  formatCny, priceOfModel, pricingTierAt, sessionCostCny,
} from '../src/client/chat/usage-money.ts'

const ONE_MILLION_EACH: TokenUsageProjection = {
  uncachedInputTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  cacheWriteTokens: 1_000_000,
  outputTokens: 1_000_000,
}

describe('DeepSeek session money', () => {
  it('uses the current official CNY peak and off-peak prices in Beijing time', () => {
    const beforeMorningPeak = new Date('2026-08-20T00:59:59.999Z')
    const morningPeak = new Date('2026-08-20T01:00:00.000Z')
    const noonOffPeak = new Date('2026-08-20T04:00:00.000Z')
    const afternoonPeak = new Date('2026-08-20T06:00:00.000Z')
    const eveningOffPeak = new Date('2026-08-20T10:00:00.000Z')

    expect(priceOfModel('deepseek-v4-flash', beforeMorningPeak)).toEqual({
      cacheHit: 0.05, cacheMiss: 1.5, output: 4.5,
    })
    expect(priceOfModel('deepseek-v4-flash', morningPeak)).toEqual({
      cacheHit: 0.1, cacheMiss: 3, output: 9,
    })
    expect(priceOfModel('deepseek-v4-pro', noonOffPeak)).toEqual({
      cacheHit: 0.15, cacheMiss: 4.5, output: 13.5,
    })
    expect(priceOfModel('deepseek-v4-pro', afternoonPeak)).toEqual({
      cacheHit: 0.3, cacheMiss: 9, output: 27,
    })
    expect(priceOfModel('deepseek-v4-flash', eveningOffPeak)).toEqual({
      cacheHit: 0.05, cacheMiss: 1.5, output: 4.5,
    })
    expect(priceOfModel('unknown', morningPeak)).toBeNull()
  })

  it('bills cache writes as cache misses and hides unknown models', () => {
    const peak = new Date('2026-08-20T01:00:00.000Z')
    const offPeak = new Date('2026-08-20T04:00:00.000Z')
    expect(sessionCostCny(ONE_MILLION_EACH, 'deepseek-v4-flash', peak)).toBeCloseTo(15.1)
    expect(sessionCostCny(ONE_MILLION_EACH, 'deepseek-v4-pro', offPeak)).toBeCloseTo(22.65)
    expect(sessionCostCny(ONE_MILLION_EACH, undefined, peak)).toBeNull()
  })

  it('uses all-day off-peak pricing on weekends and supports the Vision experiment', () => {
    const saturdayPeakClock = new Date('2026-08-22T01:30:00.000Z')
    const sundayPeakClock = new Date('2026-08-23T06:30:00.000Z')
    expect(pricingTierAt(saturdayPeakClock)).toBe('weekend-off-peak')
    expect(pricingTierAt(sundayPeakClock)).toBe('weekend-off-peak')
    expect(priceOfModel('deepseek-v4-flash-vision-exp', sundayPeakClock)).toEqual({
      cacheHit: 0.05, cacheMiss: 1.5, output: 4.5,
    })
    expect(pricingTierAt(new Date('2026-08-24T01:30:00.000Z'))).toBe('weekday-peak')
    expect(pricingTierAt(new Date('2026-08-24T04:30:00.000Z'))).toBe('weekday-off-peak')
  })

  it('classifies every minute boundary and the Friday-to-Saturday transition exactly', () => {
    expect(pricingTierAt(new Date('2026-08-24T00:59:59.999Z'))).toBe('weekday-off-peak')
    expect(pricingTierAt(new Date('2026-08-24T01:00:00.000Z'))).toBe('weekday-peak')
    expect(pricingTierAt(new Date('2026-08-24T03:59:59.999Z'))).toBe('weekday-peak')
    expect(pricingTierAt(new Date('2026-08-24T04:00:00.000Z'))).toBe('weekday-off-peak')
    expect(pricingTierAt(new Date('2026-08-24T05:59:59.999Z'))).toBe('weekday-off-peak')
    expect(pricingTierAt(new Date('2026-08-24T06:00:00.000Z'))).toBe('weekday-peak')
    expect(pricingTierAt(new Date('2026-08-24T09:59:59.999Z'))).toBe('weekday-peak')
    expect(pricingTierAt(new Date('2026-08-24T10:00:00.000Z'))).toBe('weekday-off-peak')
    expect(pricingTierAt(new Date('2026-08-28T15:59:59.999Z'))).toBe('weekday-off-peak')
    expect(pricingTierAt(new Date('2026-08-28T16:00:00.000Z'))).toBe('weekend-off-peak')
  })

  it('never formats a positive sub-ten-thousandth estimate as zero', () => {
    expect(formatCny(0)).toBe('0.0000')
    expect(formatCny(0.00002)).toBe('<0.0001')
    expect(formatCny(0.00876)).toBe('0.0088')
    expect(formatCny(2.345)).toBe('2.35')
  })
})
