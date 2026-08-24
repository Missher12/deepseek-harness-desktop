// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UsageInsightsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { UsageInsightsSection } from '../src/client/UsageInsightsSection.tsx'
import type { UsageInsightsSectionInjected, UsageInsightsSectionProps } from '../src/client/UsageInsightsSection.tsx'
import { en, zh, type UsageInsightsLocaleKey } from '../src/client/locales.ts'
import { resetUsageSnapshotForTest } from '../src/client/snapshot-cache.ts'

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  resetUsageSnapshotForTest()
})

const t = ((key: UsageInsightsLocaleKey): string => en[key]) as UsageInsightsSectionProps['t']
const activity: UsageInsightsSnapshot['activity'] = Array.from({ length: 371 }, (_, index) => ({
  date: new Date(Date.UTC(2025, 7, 17 + index)).toISOString().slice(0, 10),
  humanMessages: index === 365 ? 1 : 0,
  tokens: index === 365 ? 1_000 : 0,
  toolCalls: 0,
  level: index === 365 ? 4 : 0,
}))
const SNAPSHOT: UsageInsightsSnapshot = {
  generatedAt: Date.parse('2026-08-18T00:00:00.000Z'),
  timeZone: 'Asia/Shanghai',
  sessionCount: 8,
  omittedSessions: 1,
  incompleteUsageSamples: 2,
  summary: {
    totalTokens: 96_500,
    peakDailyTokens: 15_700,
    longestSessionMs: 6 * 3_600_000 + 22 * 60_000,
    currentStreakDays: 22,
    longestStreakDays: 22,
  },
  insights: {
    cacheHitRate: 0.58,
    mostUsedModel: 'deepseek/deepseek-v4-flash',
    mostUsedReasoningEffort: 'max',
    uniqueSkills: 51,
    totalToolCalls: 959,
    chatDays: 373,
  },
  activity,
  features: [
    { kind: 'skill', name: 'preview', count: 110 },
    { kind: 'tool', name: 'bash', count: 86 },
  ],
}

function props(
  load: UsageInsightsSectionInjected['load'],
  locale = 'en',
  translate: UsageInsightsSectionProps['t'] = t,
): UsageInsightsSectionProps {
  return { t: translate, locale, load } as UsageInsightsSectionProps
}

describe('UsageInsightsSection', () => {
  it('keeps the native page title and description visible across loading and ready states', async () => {
    const deferred = Promise.withResolvers<UsageInsightsSnapshot>()
    render(<UsageInsightsSection {...props(() => deferred.promise)} />)

    expect(screen.getByRole('heading', { name: en.section, level: 2 })).toBeTruthy()
    expect(screen.getByText(en.sectionIntro)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT); await deferred.promise })
    expect(screen.getByRole('heading', { name: en.section, level: 2 })).toBeTruthy()
    expect(screen.getByText(en.sectionIntro)).toBeTruthy()
  })

  it('ends a never-settling first-load skeleton and allows a successful retry', async () => {
    vi.useFakeTimers()
    const never = new Promise<UsageInsightsSnapshot>(() => {})
    const load = vi.fn<UsageInsightsSectionInjected['load']>()
      .mockReturnValueOnce(never)
      .mockResolvedValueOnce(SNAPSHOT)
    render(<UsageInsightsSection {...props(load)} />)

    expect(document.querySelector('[data-usage-skeleton]')).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(screen.getByRole('alert').textContent).toBe(en.error)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.retry }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('96.5K')).toBeTruthy()
  })

  it('accepts the original response when it settles after the first-load timeout', async () => {
    vi.useFakeTimers()
    const deferred = Promise.withResolvers<UsageInsightsSnapshot>()
    render(<UsageInsightsSection {...props(() => deferred.promise)} />)

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(screen.getByRole('alert').textContent).toBe(en.error)

    await act(async () => { deferred.resolve(SNAPSHOT); await deferred.promise })
    expect(screen.getByText('96.5K')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders the five KPIs, partial notice, charts, insights, and ranked features', async () => {
    const deferred = Promise.withResolvers<UsageInsightsSnapshot>()
    const view = render(<UsageInsightsSection {...props(() => deferred.promise)} />)
    const skeleton = view.container.querySelector('[data-usage-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.querySelectorAll('[data-usage-skeleton-metric]')).toHaveLength(5)
    expect(skeleton?.querySelectorAll('[data-usage-skeleton-tab]')).toHaveLength(3)
    expect(skeleton?.querySelectorAll('[data-usage-skeleton-day]')).toHaveLength(371)
    expect(skeleton?.querySelectorAll('[data-usage-skeleton-month]')).toHaveLength(12)
    expect(skeleton?.querySelectorAll('[data-usage-skeleton-detail]')).toHaveLength(2)
    expect(screen.queryByText(en.loading)).toBeNull()

    await act(async () => { deferred.resolve(SNAPSHOT) })

    expect(screen.getByText('96.5K')).toBeTruthy()
    expect(screen.getByText('15.7K')).toBeTruthy()
    expect(screen.getByText('6h 22m')).toBeTruthy()
    expect(screen.getAllByText('22')).toHaveLength(2)
    expect(screen.getByRole('status').textContent).toContain('1')
    expect(view.container.querySelectorAll('[data-activity-day]')).toHaveLength(371)
    expect(screen.getByText('58%')).toBeTruthy()
    expect(screen.getByText('deepseek/deepseek-v4-flash')).toBeTruthy()
    expect(screen.getByText('preview')).toBeTruthy()
    expect(screen.getByText(en.skillBadge)).toBeTruthy()
    expect(screen.getByText(en.toolBadge)).toBeTruthy()
  })

  it('reuses the last process-memory snapshot while a background refresh settles', async () => {
    const first = render(<UsageInsightsSection {...props(async () => SNAPSHOT)} />)
    await screen.findByText('96.5K')
    first.unmount()

    const refresh = Promise.withResolvers<UsageInsightsSnapshot>()
    const load = vi.fn(() => refresh.promise)
    const second = render(<UsageInsightsSection {...props(load)} />)
    expect(screen.getByText('96.5K')).toBeTruthy()
    expect(second.container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
    expect(second.container.querySelector('[data-usage-skeleton]')).toBeNull()

    await act(async () => { refresh.reject(new Error('private refresh detail')) })

    expect(screen.getByText('96.5K')).toBeTruthy()
    expect(second.container.querySelector('[data-usage-refresh-stale]')?.textContent).toContain(en.refreshFailed)
    expect(screen.queryByText('private refresh detail')).toBeNull()

    load.mockResolvedValueOnce({
      ...SNAPSHOT,
      summary: { ...SNAPSHOT.summary, totalTokens: 100_000 },
    })
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText('100K')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('switches chart views with click and keyboard navigation', async () => {
    const view = render(<UsageInsightsSection {...props(async () => SNAPSHOT)} />)
    const daily = await screen.findByRole('tab', { name: en.daily })
    const weekly = screen.getByRole('tab', { name: en.weekly })
    const cumulative = screen.getByRole('tab', { name: en.cumulative })
    expect(daily.getAttribute('aria-selected')).toBe('true')

    fireEvent.click(weekly)
    expect(weekly.getAttribute('aria-selected')).toBe('true')
    const weeklyParticles = view.container.querySelectorAll('[data-particle-mode="weekly"]')
    expect(weeklyParticles).toHaveLength(371)
    expect(weeklyParticles[365]?.getAttribute('data-display-tokens')).toBe('1000')

    fireEvent.keyDown(weekly, { key: 'ArrowRight' })
    expect(cumulative.getAttribute('aria-selected')).toBe('true')
    const cumulativeParticles = view.container.querySelectorAll('[data-particle-mode="cumulative"]')
    expect(cumulativeParticles).toHaveLength(371)
    expect(cumulativeParticles[365]?.getAttribute('data-display-tokens')).toBe('96500')
    expect(view.container.querySelector('[data-cumulative-chart]')).toBeNull()

    fireEvent.keyDown(cumulative, { key: 'Home' })
    expect(daily.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(daily, { key: 'ArrowLeft' })
    expect(cumulative.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(cumulative, { key: 'End' })
    expect(cumulative.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(cumulative, { key: 'Space' })
    expect(cumulative.getAttribute('aria-selected')).toBe('true')
  })

  it('shows scope-specific Chinese copy in the visible particle tooltip', async () => {
    const translate = ((key: UsageInsightsLocaleKey): string => zh[key]) as UsageInsightsSectionProps['t']
    const tooltipSnapshot = { ...SNAPSHOT, summary: { ...SNAPSHOT.summary, totalTokens: 1_000 } }
    const view = render(<UsageInsightsSection {...props(async () => tooltipSnapshot, 'zh-CN', translate)} />)
    await screen.findByRole('tab', { name: zh.daily })
    const particle = (): Element => {
      const found = view.container.querySelector('[data-activity-day="2026-08-17"]')
      if (found === null) throw new Error('missing 2026-08-17 particle')
      return found
    }

    fireEvent.mouseEnter(particle())
    expect(screen.getByRole('tooltip').textContent).toBe('8月17日 使用了 1000 个 Token')

    fireEvent.click(screen.getByRole('tab', { name: zh.weekly }))
    fireEvent.mouseEnter(particle())
    expect(screen.getByRole('tooltip').textContent).toBe('2026年8月16日 当周使用了 1000 个 Token')

    fireEvent.click(screen.getByRole('tab', { name: zh.cumulative }))
    fireEvent.mouseEnter(particle())
    expect(screen.getByRole('tooltip').textContent).toBe('截至 2026年8月16日 当周累计使用 1000 个 Token')
  })

  it('positions particle tooltips at each edge and clears them on exit', async () => {
    const view = render(<UsageInsightsSection {...props(async () => SNAPSHOT)} />)
    await screen.findByRole('tab', { name: en.daily })
    const particles = view.container.querySelectorAll('[data-activity-day]')

    fireEvent.mouseEnter(particles[0] as Element)
    expect(screen.getByRole('tooltip').getAttribute('data-edge')).toBe('left')
    fireEvent.mouseEnter(particles[180] as Element)
    expect(screen.getByRole('tooltip').getAttribute('data-edge')).toBe('middle')
    fireEvent.mouseEnter(particles[370] as Element)
    expect(screen.getByRole('tooltip').getAttribute('data-edge')).toBe('right')

    const stage = screen.getByRole('img').firstElementChild
    if (stage === null) throw new Error('missing heatmap stage')
    fireEvent.mouseLeave(stage)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows unavailable values honestly and retries a generic failure', async () => {
    const empty: UsageInsightsSnapshot = {
      ...SNAPSHOT,
      sessionCount: 0,
      omittedSessions: 0,
      incompleteUsageSamples: 0,
      summary: {
        totalTokens: null,
        peakDailyTokens: null,
        longestSessionMs: null,
        currentStreakDays: 0,
        longestStreakDays: 0,
      },
      insights: {
        cacheHitRate: null,
        mostUsedModel: null,
        mostUsedReasoningEffort: null,
        uniqueSkills: 0,
        totalToolCalls: 0,
        chatDays: 0,
      },
      features: [],
    }
    const load = vi.fn<UsageInsightsSectionInjected['load']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce(empty)
    render(<UsageInsightsSection {...props(load)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('does not update state after either pending load outcome is unmounted', async () => {
    const resolved = Promise.withResolvers<UsageInsightsSnapshot>()
    const first = render(<UsageInsightsSection {...props(() => resolved.promise)} />)
    first.unmount()
    await act(async () => { resolved.resolve(SNAPSHOT) })

    const rejected = Promise.withResolvers<UsageInsightsSnapshot>()
    const second = render(<UsageInsightsSection {...props(() => rejected.promise)} />)
    second.unmount()
    await act(async () => { rejected.reject(new Error('late failure')) })
  })

  it('shows a partial notice for either omission source independently', async () => {
    const omittedOnly = {
      ...SNAPSHOT,
      incompleteUsageSamples: 0,
    }
    const first = render(<UsageInsightsSection {...props(async () => omittedOnly)} />)
    expect(await screen.findByRole('status')).toBeTruthy()
    first.unmount()

    const incompleteOnly = {
      ...SNAPSHOT,
      omittedSessions: 0,
    }
    render(<UsageInsightsSection {...props(async () => incompleteOnly)} />)
    expect(await screen.findByRole('status')).toBeTruthy()
  })
})
