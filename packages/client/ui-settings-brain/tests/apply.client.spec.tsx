// @vitest-environment jsdom
import { cleanup } from '@testing-library/react'
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { apply as applyHostEntry } from '../src/index.ts'
import { BrainSettingsSection, type BrainSettingsInjected } from '../src/client/BrainSettingsSection.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const SNAPSHOT = {
  generatedAt: 1,
  limits: { maxItems: 6, maxBytes: 4_000, timeoutMs: 150 },
  providers: [
    { id: 'memory', state: 'ready' as const, count: 12, byteBudget: 3_000 },
    { id: 'evolution', state: 'ready' as const, count: 3, byteBudget: 2_000 },
  ],
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  const snapshot = vi.fn().mockResolvedValue({ ok: true, value: SNAPSHOT })
  ctx.provide('remote.missherBrain', { snapshot })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, snapshot }
}

describe('ui-settings-brain browser plugin', () => {
  it('keeps the host loader entry inert', () => {
    applyHostEntry()
    expect(applyHostEntry).toBeTypeOf('function')
  })

  it('registers one lazy localized Memory & Learning section', async () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.missherBrain'])
    const b = await bench()
    b.slots.register({
      name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(BrainSettingsSection)
    expect(entry.options).toMatchObject({ id: 'brain', order: 9 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('记忆与学习')
    expect(b.snapshot).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => BrainSettingsInjected)()
    await expect(injected.load()).resolves.toEqual(SNAPSHOT)
    b.snapshot.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'private detail' } })
    await expect(injected.load()).rejects.toThrow('missherBrain.snapshot failed: REMOTE_ERROR: private detail')

    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Memory & Learning')
    await b.ctx.fiber.dispose()
  })
})
