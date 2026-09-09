// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, NS } from '../src/client/index.ts'
import { SystemUpdateSection, type SystemUpdateInjected } from '../src/client/SystemUpdateSection.tsx'
import type { DesktopInstallResult, DesktopUpdateSnapshot } from '../src/client/contracts.ts'
import type { createSystemUpdateStore } from '../src/client/store.ts'

const snapshot: DesktopUpdateSnapshot = {
  phase: 'idle', runningDesktop: '0.2.1', includedHarness: '0.1.0-rc.8',
  latestOfficialHarness: null, latestDesktop: null, lastCheckedAt: null,
  downloadProgress: null, message: null,
  assetName: null, downloadedBytes: null, downloadTotalBytes: null,
  platform: 'darwin', arch: 'x64', packageFormat: 'dmg',
  installAction: 'protected-replace', supportReason: null,
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
  cancelCalls(): readonly unknown[][]
  setInstallResult(value: DesktopInstallResult): void
  setSnapshot(value: DesktopUpdateSnapshot): void
} {
  let listener: ((value: DesktopUpdateSnapshot) => void) | undefined
  let currentSnapshot = snapshot
  let installResult: DesktopInstallResult = { opened: true, status: 'handoff-requested', action: 'protected-replace' }
  const unsubscribe = vi.fn()
  const getUpdateStatus = vi.fn(async () => currentSnapshot)
  const installUpdate = vi.fn(async () => installResult)
  const cancelUpdateDownload = vi.fn(async () => ({ ...snapshot, phase: 'desktop-available' as const }))
  return {
    getUpdateStatus,
    onCommand: vi.fn((_listener: (command: unknown) => void) => () => {}),
    checkForUpdates: vi.fn(async () => ({ ...snapshot, phase: 'current' as const })),
    downloadUpdate: vi.fn(async () => ({ ...snapshot, phase: 'ready' as const })),
    cancelUpdateDownload,
    installUpdate,
    onUpdateStatus: vi.fn((next: (value: DesktopUpdateSnapshot) => void) => { listener = next; return unsubscribe }),
    emit(value) { listener?.(value) },
    unsubscribe,
    installCalls: () => installUpdate.mock.calls.length,
    statusCalls: () => getUpdateStatus.mock.calls.length,
    cancelCalls: () => cancelUpdateDownload.mock.calls,
    setInstallResult(value) { installResult = value },
    setSnapshot(value) { currentSnapshot = value },
  }
}

describe('ui-settings-system-update browser plugin', () => {
  it('keeps the section absent for every incomplete or non-object preload face', async () => {
    expect(inject).toEqual(['slots', 'locale'])
    const valid = bridge()
    const keys = ['getUpdateStatus', 'checkForUpdates', 'downloadUpdate', 'cancelUpdateDownload', 'installUpdate', 'onUpdateStatus'] as const
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
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

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
    await face.cancelDownload()
    expect(instance.getSnapshot().snapshot.phase).toBe('desktop-available')
    expect(desktop.cancelCalls()).toEqual([[]])
    await face.install()
    expect(desktop.installCalls()).toBe(1)
    expect(desktop.statusCalls()).toBe(2)

    b.locale.setLocale('zh')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('系统更新')
    await fiber.dispose()
    expect(desktop.unsubscribe).toHaveBeenCalledOnce()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
  })

  it('rejects only explicit installer errors with the sanitized native message', async () => {
    for (const action of ['protected-replace', 'open-setup-wizard', 'reveal-package', null] as const) {
      const b = await bench()
      const desktop = bridge()
      desktop.setInstallResult({ opened: false, status: 'error', action, message: 'Retry after closing the installer.' })
      window.dshDesktop = desktop
      await b.ctx.plugin({ inject: [...inject], apply }).await()
      const entry = b.slots.entries('settings.section')[0]!
      const handle = entry.store as ReturnType<typeof createSystemUpdateStore>
      const instance = handle.create()
      const face = (entry.inject as unknown as (actions: typeof instance.actions) => SystemUpdateInjected)(instance.actions)

      await expect(face.install()).rejects.toThrow('Retry after closing the installer.')
    }
  })

  it.each(['protected-replace', 'open-setup-wizard', 'reveal-package'] as const)(
    'treats observed %s confirmation cancellation as a non-error',
    async (action) => {
      const b = await bench()
      const desktop = bridge()
      desktop.setInstallResult({ opened: false, status: 'cancelled', action })
      desktop.setSnapshot({ ...snapshot, phase: 'ready' })
      window.dshDesktop = desktop
      await b.ctx.plugin({ inject: [...inject], apply }).await()
      const entry = b.slots.entries('settings.section')[0]!
      const instance = (entry.store as ReturnType<typeof createSystemUpdateStore>).create()
      const face = (entry.inject as unknown as (actions: typeof instance.actions) => SystemUpdateInjected)(instance.actions)
      await expect(face.install()).resolves.toBeUndefined()
      expect(instance.getSnapshot().snapshot.phase).toBe('ready')
      expect(instance.getSnapshot().snapshot.runningDesktop).toBe('0.2.1')
    },
  )

  it.each(['deb', 'appimage'] as const)('keeps %s manual-ready after repeated reveals', async (packageFormat) => {
    const b = await bench()
    const desktop = bridge()
    desktop.setInstallResult({ opened: true, status: 'manual-install-ready', action: 'reveal-package', packageFormat })
    desktop.setSnapshot({
      ...snapshot, platform: 'linux', packageFormat, installAction: 'reveal-package', phase: 'manual-install-ready',
    })
    window.dshDesktop = desktop
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const instance = (entry.store as ReturnType<typeof createSystemUpdateStore>).create()
    const face = (entry.inject as unknown as (actions: typeof instance.actions) => SystemUpdateInjected)(instance.actions)
    await face.install()
    await face.install()
    expect(instance.getSnapshot().snapshot.phase).toBe('manual-install-ready')
    expect(instance.getSnapshot().snapshot.runningDesktop).toBe('0.2.1')
    expect(desktop.installCalls()).toBe(2)
  })

  it('does not let an older initial read replace a newer pushed native snapshot', async () => {
    const b = await bench()
    const desktop = bridge()
    let finishRead!: (value: DesktopUpdateSnapshot) => void
    desktop.getUpdateStatus = vi.fn(() => new Promise<DesktopUpdateSnapshot>((resolve) => { finishRead = resolve }))
    window.dshDesktop = desktop
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const instance = (entry.store as ReturnType<typeof createSystemUpdateStore>).create()
    ;(entry.inject as unknown as (actions: typeof instance.actions) => SystemUpdateInjected)(instance.actions)
    const pushed = { ...snapshot, phase: 'downloading' as const, downloadedBytes: 123, downloadTotalBytes: 1000 }
    desktop.emit(pushed)
    finishRead(snapshot)
    await Promise.resolve()
    await Promise.resolve()
    expect(instance.getSnapshot().snapshot).toEqual(pushed)
  })

  it('recovers from an initial status-read rejection using only a no-argument status retry', async () => {
    const b = await bench()
    const desktop = bridge()
    const nativeError = 'private transport detail '.repeat(100)
    const getUpdateStatus = vi.fn(async () => snapshot).mockRejectedValueOnce(new Error(nativeError))
    const checkForUpdates = vi.fn(async () => snapshot)
    const downloadUpdate = vi.fn(async () => snapshot)
    const installUpdate = vi.fn(async (): Promise<DesktopInstallResult> => ({ opened: false, status: 'cancelled', action: 'protected-replace' }))
    Object.assign(desktop, { getUpdateStatus, checkForUpdates, downloadUpdate, installUpdate })
    window.dshDesktop = desktop
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const instance = (entry.store as ReturnType<typeof createSystemUpdateStore>).create()
    const face = (entry.inject as unknown as (actions: typeof instance.actions) => SystemUpdateInjected)(instance.actions)

    await vi.waitFor(() => { expect(instance.getSnapshot().statusLoad).toBe('error') })
    expect(instance.getSnapshot().snapshot.installAction).toBeNull()
    expect(JSON.stringify(instance.getSnapshot())).not.toContain('private transport detail')
    await expect(face.retryStatus()).resolves.toBeUndefined()
    expect(instance.getSnapshot().statusLoad).toBe('ready')
    expect(instance.getSnapshot().snapshot).toEqual(snapshot)
    expect(getUpdateStatus.mock.calls).toEqual([[], []])
    expect(checkForUpdates).not.toHaveBeenCalled()
    expect(downloadUpdate).not.toHaveBeenCalled()
    expect(installUpdate).not.toHaveBeenCalled()
  })

  it.each(['pushed', 'disposed'] as const)('ignores a late status-read rejection after the section is %s without an unhandled rejection', async (outcome) => {
    const b = await bench()
    const desktop = bridge()
    let rejectRead!: (reason: Error) => void
    desktop.getUpdateStatus = vi.fn(() => new Promise<DesktopUpdateSnapshot>((_resolve, reject) => { rejectRead = reject }))
    window.dshDesktop = desktop
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('settings.section')[0]!
    const instance = (entry.store as ReturnType<typeof createSystemUpdateStore>).create()
    ;(entry.inject as unknown as (actions: typeof instance.actions) => SystemUpdateInjected)(instance.actions)
    if (outcome === 'pushed') desktop.emit({ ...snapshot, phase: 'current' })
    else await fiber.dispose()
    const before = instance.getSnapshot()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      rejectRead(new Error('Late status transport failure'))
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(instance.getSnapshot()).toEqual(before)
      if (outcome === 'pushed') expect(instance.getSnapshot().statusLoad).toBe('ready')
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('keeps a newer check authoritative when the older initial read finishes first', async () => {
    const b = await bench()
    const desktop = bridge()
    let finishRead!: (value: DesktopUpdateSnapshot) => void
    let finishCheck!: (value: DesktopUpdateSnapshot) => void
    desktop.getUpdateStatus = vi.fn(() => new Promise<DesktopUpdateSnapshot>((resolve) => { finishRead = resolve }))
    desktop.checkForUpdates = vi.fn(() => new Promise<DesktopUpdateSnapshot>((resolve) => { finishCheck = resolve }))
    window.dshDesktop = desktop
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const instance = (entry.store as ReturnType<typeof createSystemUpdateStore>).create()
    const face = (entry.inject as unknown as (actions: typeof instance.actions) => SystemUpdateInjected)(instance.actions)
    const checking = face.check()
    finishRead(snapshot)
    await Promise.resolve()
    await Promise.resolve()
    finishCheck({ ...snapshot, phase: 'current' })
    await checking
    expect(instance.getSnapshot().snapshot.phase).toBe('current')
  })

  it('ignores pending reads and late native events after the plugin is disposed', async () => {
    const b = await bench()
    const desktop = bridge()
    let finishRead!: (value: DesktopUpdateSnapshot) => void
    desktop.getUpdateStatus = vi.fn(() => new Promise<DesktopUpdateSnapshot>((resolve) => { finishRead = resolve }))
    window.dshDesktop = desktop
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('settings.section')[0]!
    const instance = (entry.store as ReturnType<typeof createSystemUpdateStore>).create()
    ;(entry.inject as unknown as (actions: typeof instance.actions) => SystemUpdateInjected)(instance.actions)
    const before = instance.getSnapshot().snapshot
    await fiber.dispose()
    finishRead(snapshot)
    await Promise.resolve()
    await Promise.resolve()
    desktop.emit({ ...snapshot, phase: 'downloading' })
    expect(instance.getSnapshot().snapshot).toEqual(before)
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(desktop.unsubscribe).toHaveBeenCalledOnce()
  })
})
