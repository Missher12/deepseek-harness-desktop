// @vitest-environment jsdom
import { cleanup } from '@testing-library/react'
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { UsageInsightsSection } from '../src/client/UsageInsightsSection.tsx'
import type { UsageInsightsSectionInjected } from '../src/client/UsageInsightsSection.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY = {
  generatedAt: 0,
  timeZone: 'UTC',
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
  activity: [],
  features: [],
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const snapshot = vi.fn().mockResolvedValue({ ok: true, value: EMPTY })
  ctx.provide('remote.usageInsights', { snapshot })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, snapshot }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-usage browser plugin', () => {
  it('registers a lazy localized section between Models and Plugins', async () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.usageInsights'])
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(UsageInsightsSection)
    expect(entry.options).toMatchObject({ id: 'usage', order: 12 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('使用统计')
    expect(b.snapshot).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => UsageInsightsSectionInjected)()
    expect(injected.locale).toBe('zh')
    await expect(injected.load()).resolves.toEqual(EMPTY)
    expect(b.snapshot).toHaveBeenCalledOnce()
    b.snapshot.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(injected.load()).rejects.toThrow('usageInsights.snapshot failed: REMOTE_ERROR: unavailable')

    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Usage')
    expect((b.slots.entries('settings.section')[0]!.inject as unknown as () => UsageInsightsSectionInjected)().locale).toBe('en')
    await b.ctx.fiber.dispose()
  })
})
