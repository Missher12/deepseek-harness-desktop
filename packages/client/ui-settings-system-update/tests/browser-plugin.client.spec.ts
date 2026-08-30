// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, NS } from '../src/client/index.ts'
import { SystemUpdateSection, type SystemUpdateInjected } from '../src/client/SystemUpdateSection.tsx'
import type { DesktopUpdateSnapshot } from '../src/client/contracts.ts'
import type { createSystemUpdateStore } from '../src/client/store.ts'

const snapshot: DesktopUpdateSnapshot = {
  phase: 'idle', runningDesktop: '0.2.1', includedHarness: '0.1.0-rc.8',
  latestOfficialHarness: null, latestDesktop: null, lastCheckedAt: null,
  downloadProgress: null, message: null,
}

const contexts: Context[] = []

afterEach(async () => {
  delete window.dshDesktop
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function bench(): Promise<{ ctx: Context; slots: SlotRegistry; locale: LocaleRuntime }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
  return { ctx, slots, locale }
}

function bridge(): NonNullable<Window['dshDesktop']> & {
  emit(value: DesktopUpdateSnapshot): void
  unsubscribe: ReturnType<typeof vi.fn>
  installCalls(): number
  statusCalls(): number
  setInstallResult(value: { opened: boolean; message?: string }): void
} {
  let listener: ((value: DesktopUpdateSnapshot) => void) | undefined
  let installResult: { opened: boolean; message?: string } = { opened: true }
  const unsubscribe = vi.fn()
  const getUpdateStatus = vi.fn(async () => snapshot)
  const installUpdate = vi.fn(async () => installResult)
  return {
    getUpdateStatus,
    onCommand: vi.fn((_listener: (command: unknown) => void) => () => {}),
    checkForUpdates: vi.fn(async () => ({ ...snapshot, phase: 'current' as const })),
    downloadUpdate: vi.fn(async () => ({ ...snapshot, phase: 'ready' as const })),
    installUpdate,
    onUpdateStatus: vi.fn((next: (value: DesktopUpdateSnapshot) => void) => { listener = next; return unsubscribe }),
    emit(value) { listener?.(value) },
    unsubscribe,
    installCalls: () => installUpdate.mock.calls.length,
    statusCalls: () => getUpdateStatus.mock.calls.length,
    setInstallResult(value) { installResult = value },
  }
}

describe('ui-settings-system-update browser plugin', () => {
  it('keeps the section absent for every incomplete or non-object preload face', async () => {
    expect(inject).toEqual(['slots', 'locale'])
    const valid = bridge()
    const keys = ['getUpdateStatus', 'checkForUpdates', 'downloadUpdate', 'installUpdate', 'onUpdateStatus'] as const
    const invalid: unknown[] = [undefined, null, 'bridge']
    for (const key of keys) invalid.push({ ...valid, [key]: undefined })

    for (const candidate of invalid) {
      const b = await bench()
      window.dshDesktop = candidate as never
      await b.ctx.plugin({ inject: [...inject], apply }).await()
      expect(b.slots.entries('settings.section')).toHaveLength(0)
    }
  })

  it('registers one localized section and routes all update operations through its store', async () => {
    const b = await bench()
    const desktop = bridge()
    window.dshDesktop = desktop
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(SystemUpdateSection)
    expect(entry.options).toMatchObject({ id: 'system-update', order: 95 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('System Update')
    const handle = entry.store as ReturnType<typeof createSystemUpdateStore>
    const instance = handle.create()
    const face = (entry.inject as unknown as (actions: typeof instance.actions) => SystemUpdateInjected)(instance.actions)
    await vi.waitFor(() => { expect(instance.getSnapshot().snapshot).toEqual(snapshot) })

    const pushed = { ...snapshot, phase: 'checking' as const }
    desktop.emit(pushed)
    expect(instance.getSnapshot().snapshot).toEqual(pushed)
    await face.check()
    expect(instance.getSnapshot().snapshot.phase).toBe('current')
    await face.download()
    expect(instance.getSnapshot().snapshot.phase).toBe('ready')
    await face.install()
    expect(desktop.installCalls()).toBe(1)
    expect(desktop.statusCalls()).toBe(2)

    b.locale.setLocale('zh')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('系统更新')
    await b.ctx.fiber.dispose()
    expect(desktop.unsubscribe).toHaveBeenCalledOnce()
  })

  it('rejects an installer handoff that was not opened, with and without a message', async () => {
    for (const message of ['blocked', undefined]) {
      const b = await bench()
      const desktop = bridge()
      desktop.setInstallResult({ opened: false, ...(message === undefined ? {} : { message }) })
      window.dshDesktop = desktop
      await b.ctx.plugin({ inject: [...inject], apply }).await()
      const entry = b.slots.entries('settings.section')[0]!
      const handle = entry.store as ReturnType<typeof createSystemUpdateStore>
      const instance = handle.create()
      const face = (entry.inject as unknown as (actions: typeof instance.actions) => SystemUpdateInjected)(instance.actions)

      await expect(face.install()).rejects.toThrow(message ?? 'Failed to open the verified installer.')
    }
  })
})
