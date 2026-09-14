// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { DesktopSettingsTrigger, type DesktopSettingsTriggerProps } from '../src/client/DesktopSettingsTrigger.tsx'
import { DesktopCloseRow, type DesktopCloseRowProps } from '../src/client/DesktopCloseRow.tsx'
import { DesktopRecoveryRow } from '../src/client/DesktopRecoveryRow.tsx'
import { en } from '../src/client/locales.ts'
import type { DesktopShellBridge } from '../src/client/contracts.ts'

const contexts: Context[] = []
afterEach(async () => {
  cleanup()
  delete (window as unknown as { dshDesktop?: unknown }).dshDesktop
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const startSession = vi.fn()
  ctx.provide('uiWorkspace', { startSession })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'settings.trigger': { kind: 'single', scope: 'root' }, 'settings.general.item': { kind: 'list', scope: 'root' } } } as never, () => null)
  const fallback = () => null
  slots.register({ name: 'settings.trigger' }, fallback)
  return { ctx, slots, fallback, locale, startSession }
}

function bridge() {
  let command: (value: unknown) => void = () => {}
  const unsubscribe = vi.fn()
  const api: DesktopShellBridge = {
    presentation: { titlebar: 'native' }, onCommand(next) { command = next; return unsubscribe },
    getDesktopPreferences: async () => ({ closeBehavior: 'quit' }),
    setDesktopPreference: async mutation => ({ closeBehavior: mutation.value }),
    onDesktopPreferences: () => unsubscribe,
  }
  return { api, emit: (value: unknown) => { command(value) }, unsubscribe }
}

describe('official client native-shell contribution', () => {
  it('adds native recovery only with its fixed preload action and opens it through a localized control', async () => {
    const b = await bench()
    const native = bridge()
    const openCompatibility = vi.fn(async () => {})
    native.api.openCompatibility = openCompatibility
    ;(window as unknown as { dshDesktop: unknown }).dshDesktop = native.api
    await b.ctx.plugin({ inject, apply }).await()
    expect(b.slots.entries('settings.general.item').map(entry => entry.options.id))
      .toEqual(['desktop-close-behavior', 'desktop-plugin-recovery'])
    render(createElement(DesktopRecoveryRow, {
      t: (key: keyof typeof en) => en[key], openCompatibility,
    } as unknown as Parameters<typeof DesktopRecoveryRow>[0]))
    fireEvent.click(screen.getByRole('button', { name: 'Open recovery' }))
    expect(openCompatibility).toHaveBeenCalledOnce()
  })
  it('stays absent without a complete native bridge', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject, apply }).await()
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
    expect(document.body.dataset.dshSurface).toBeUndefined()
  })
  it('registers additive close settings, restores the default trigger, and stops commands on disposal', async () => {
    const b = await bench()
    const native = bridge()
    ;(window as unknown as { dshDesktop: unknown }).dshDesktop = native.api
    const fiber = b.ctx.plugin({ inject, apply })
    await fiber.await()
    expect(b.slots.entries('settings.general.item').map(entry => entry.options.id)).toEqual(['desktop-close-behavior'])
    expect(b.slots.entries('settings.trigger')[0]?.component).toBe(DesktopSettingsTrigger)
    native.emit('new-session')
    expect(b.startSession).toHaveBeenCalledOnce()
    await fiber.dispose()
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
    expect(b.slots.entries('settings.trigger')[0]?.component).toBe(b.fallback)
    expect(document.body.dataset.dshSurface).toBeUndefined()
    native.emit('new-session')
    expect(b.startSession).toHaveBeenCalledOnce()
    expect(native.unsubscribe).toHaveBeenCalledTimes(2)
  })
  it('reports a missing official native-command target instead of silently accepting it', async () => {
    const b = await bench()
    const native = bridge()
    ;(window as unknown as { dshDesktop: unknown }).dshDesktop = native.api
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await b.ctx.plugin({ inject, apply }).await()
      native.emit('open-settings')
      expect(warn).toHaveBeenCalledWith('[ui-desktop-shell] Native command rejected: its official UI target is unavailable or ambiguous.')
    } finally {
      warn.mockRestore()
    }
  })
  it('binds and releases only its rendered trigger host button', () => {
    const bindButton = vi.fn()
    const clicked = vi.fn()
    const props = { wide: true, t: (key: keyof typeof en) => en[key], bindButton } as unknown as DesktopSettingsTriggerProps
    const result = render(createElement('button', { onClick: clicked }, createElement(DesktopSettingsTrigger, props)))
    expect(bindButton).toHaveBeenLastCalledWith(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(clicked).toHaveBeenCalledOnce()
    result.unmount()
    expect(bindButton).toHaveBeenLastCalledWith(null)
  })
  it('renders native close choices and disables writes until preference data arrives', () => {
    const setCloseBehavior = vi.fn()
    const props = { t: (key: keyof typeof en) => en[key], usePreference: (selector: (value: unknown) => unknown) => selector({ closeBehavior: 'quit', status: 'ready', saving: false }), setCloseBehavior, reload: vi.fn() } as unknown as DesktopCloseRowProps
    const result = render(createElement(DesktopCloseRow, props))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'keep-running' } })
    expect(setCloseBehavior).toHaveBeenCalledExactlyOnceWith('keep-running')
    result.rerender(createElement(DesktopCloseRow, { ...props, usePreference: (selector: (value: unknown) => unknown) => selector({ closeBehavior: null, status: 'loading', saving: false }) } as unknown as DesktopCloseRowProps))
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(true)
  })
})
