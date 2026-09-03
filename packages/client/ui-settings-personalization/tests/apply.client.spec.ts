import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, NS } from '../src/client/index.ts'
import { PersonalizationSection, type PersonalizationSectionInjected } from '../src/client/PersonalizationSection.tsx'
import { apply as applyHostEntry } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const view = {
    instructions: '', style: 'default' as const, revision: 'a'.repeat(64),
    hasExternalContent: false, writable: true,
  }
  const personalizationRead = vi.fn(async () => ({
    ok: true as const, value: view,
  }))
  const personalizationWrite = vi.fn(async () => ({
    ok: true as const, value: view,
  }))
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.settings', { personalizationRead, personalizationWrite })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, locale, slots, personalizationRead, personalizationWrite }
}

describe('ui-settings-personalization apply', () => {
  it('registers one localized first-class section and routes typed reads and writes', async () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.settings'])
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(PersonalizationSection)
    expect(entry.options).toMatchObject({ id: 'personalization', order: 5 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('个性化')
    const face = (entry.inject as unknown as () => PersonalizationSectionInjected)()
    await expect(face.load()).resolves.toMatchObject({ style: 'default' })
    await expect(face.save({ instructions: 'x', style: 'concise', expectedRevision: 'a'.repeat(64) }))
      .resolves.toMatchObject({ writable: true })
    expect(b.personalizationRead).toHaveBeenCalledWith()
    expect(b.personalizationWrite).toHaveBeenCalledWith({
      instructions: 'x', style: 'concise', expectedRevision: 'a'.repeat(64),
    })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Personalization')
  })

  it('surfaces API refusals as rejected operations', async () => {
    const b = await bench()
    b.personalizationRead.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'settings/rejected' as const, message: 'blocked', details: { ns: 'personalization' } },
    } as never)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (b.slots.entries('settings.section')[0]!.inject as unknown as () => PersonalizationSectionInjected)()
    await expect(face.load()).rejects.toThrow('blocked')

    b.personalizationWrite.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'settings/rejected' as const, message: 'read-only', details: { ns: 'personalization' } },
    } as never)
    await expect(face.save({ instructions: 'x', style: 'default', expectedRevision: 'a'.repeat(64) }))
      .rejects.toThrow('read-only')
  })

  it('keeps the Host loader entry intentionally inert', () => {
    expect(applyHostEntry).toBeTypeOf('function')
    applyHostEntry()
  })
})
