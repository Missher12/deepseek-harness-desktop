// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, NS } from '../src/client/index.ts'
import { LarkSettingsSection, type LarkSettingsInjected } from '../src/client/LarkSettingsSection.tsx'

afterEach(cleanup)

describe('Harness Lark settings section', () => {
  test('registers one localized settings.section entry', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    await ctx.plugin({ inject: ['slots', 'locale'], apply }).await()
    const entry = slots.entries('settings.section')[0]!
    expect(entry.options).toMatchObject({ id: 'lark' })
    expect(entry.component).toBe(LarkSettingsSection)
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('Lark Remote Development')
    locale.setLocale('zh')
    expect(resolveSlotLabel(slots.entries('settings.section')[0]!.options.label)).toBe('飞书远程开发')
    await ctx.fiber.dispose()
  })

  test('paints placeholders first, never echoes secrets, and confirms destructive actions', async () => {
    let resolveStatus!: (value: unknown) => void
    const load = vi.fn(() => new Promise((resolve) => { resolveStatus = resolve }))
    const action = vi.fn(async () => ({}))
    const props: LarkSettingsInjected = { load, action }
    render(<LarkSettingsSection {...props} t={(key: string) => key} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    const secret = screen.getByLabelText('appSecret')
    expect((secret as HTMLInputElement).type).toBe('password')
    fireEvent.change(screen.getByLabelText('appId'), { target: { value: 'cli_value' } })
    fireEvent.change(secret, { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByText('saveCredentials'))
    expect(action).toHaveBeenCalledWith({ action: 'set-credentials', appId: 'cli_value', appSecret: 'secret-value' })
    expect(screen.queryByDisplayValue('secret-value')).toBeNull()
    expect(action).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'clear' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByText('clear'))
    expect(action).toHaveBeenCalledWith({ action: 'clear', confirm: true })
    resolveStatus({ enabled: false, connected: false, queuePaused: true, queueDepth: 0, credentials: {}, pairing: 'unpaired' })
  })
})
