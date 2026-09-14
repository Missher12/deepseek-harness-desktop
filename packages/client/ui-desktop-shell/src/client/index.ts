/** Native-shell browser plugin for the unmodified official Web client. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { isDesktopShellBridge } from './contracts.ts'
import { dispatchDesktopCommand, installPresentation } from './bridge.ts'
import { createDesktopPreferences } from './preferences.ts'
import { DesktopCloseRow, type DesktopCloseInjected } from './DesktopCloseRow.tsx'
import { DesktopRecoveryRow, type DesktopRecoveryInjected } from './DesktopRecoveryRow.tsx'
import { DesktopSettingsTrigger, type DesktopSettingsInjected } from './DesktopSettingsTrigger.tsx'
import { en, zh, type DesktopShellKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Native window controls. */
    'desktop.shell': DesktopShellKey
  }
}

const NS = 'desktop.shell'

/** Official presentation and workspace services consumed by the native shell. */
export const inject = ['slots', 'locale', 'uiWorkspace']

/**
 * Bind the restricted preload face and contribute one close-behavior row.
 * @param ctx - official client context; all registrations follow its fiber lifetime.
 */
export function apply(ctx: Context): void {
  const bridge: unknown = (window as unknown as { dshDesktop?: unknown }).dshDesktop
  if (!isDesktopShellBridge(bridge)) return
  const preferences = createDesktopPreferences(bridge)
  const openCompatibility = bridge.openCompatibility?.bind(bridge)
  let settingsButton: HTMLButtonElement | null = null
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-desktop-shell: dictionaries')
  ctx.effect(() => installPresentation(document, bridge.presentation), 'ui-desktop-shell: native titlebar')
  ctx.effect(() => preferences.start(), 'ui-desktop-shell: native close preferences')
  const workspaceText = ctx.locale.bind('workspace')
  ctx.effect(() => {
    let active = true
    const off = bridge.onCommand((command) => {
      if (!active) return
      const handled = dispatchDesktopCommand(command, document, {
        startSession: () => { ctx.uiWorkspace.startSession() },
        settingsButton: () => settingsButton,
        searchLabel: () => workspaceText('search.sessions.aria'),
      })
      if (!handled) console.warn('[ui-desktop-shell] Native command rejected: its official UI target is unavailable or ambiguous.')
    })
    return () => { active = false; settingsButton = null; off() }
  }, 'ui-desktop-shell: native menu commands')
  ctx.slots.inject('settings.trigger', () => ctx.slots.register({
    name: 'settings.trigger',
    priority: -100,
    locale: NS,
    inject: (): DesktopSettingsInjected => ({ bindButton: (button) => { settingsButton = button } }),
  }, DesktopSettingsTrigger))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-close-behavior',
    order: 90,
    locale: NS,
    inject: (): DesktopCloseInjected => ({
      hooks: { preference: preferences.source },
      reload: preferences.reload,
      setCloseBehavior: preferences.setCloseBehavior,
    }),
  }, DesktopCloseRow))
  if (openCompatibility !== undefined) ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'desktop-plugin-recovery', order: 91, locale: NS,
    inject: (): DesktopRecoveryInjected => ({ openCompatibility }),
  }, DesktopRecoveryRow))
}
