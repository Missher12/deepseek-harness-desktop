import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopUpdateBridge, DesktopUpdateSnapshot } from './contracts.ts'
import { SystemUpdateSection, type SystemUpdateInjected } from './SystemUpdateSection.tsx'
import { createSystemUpdateStore } from './store.ts'
import { en, zh, type SystemUpdateLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.systemUpdate': SystemUpdateLocaleKey
  }
}

/** Locale namespace registered by the System Update settings contribution. */
export const NS = 'settings.systemUpdate'
export const inject = ['slots', 'locale']

function isDesktopUpdateBridge(value: unknown): value is DesktopUpdateBridge {
  if (typeof value !== 'object' || value === null) return false
  const bridge = value as Record<string, unknown>
  return ['getUpdateStatus', 'checkForUpdates', 'downloadUpdate', 'installUpdate', 'onUpdateStatus']
    .every(key => typeof bridge[key] === 'function')
}

export function apply(ctx: ClientContext): void {
  const bridge = window.dshDesktop
  if (!isDesktopUpdateBridge(bridge)) return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-system-update: dictionaries')
  const store = createSystemUpdateStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (snapshot: DesktopUpdateSnapshot): void => { bound?.sync(snapshot) }
  const unsubscribe = bridge.onUpdateStatus(sync)
  ctx.effect(() => unsubscribe, 'ui-settings-system-update: Desktop IPC subscription')
  const invoke = async (operation: () => Promise<DesktopUpdateSnapshot>): Promise<void> => {
    sync(await operation())
  }
  const injected = (actions: BoundActions<typeof store>): SystemUpdateInjected => {
    bound = actions
    void bridge.getUpdateStatus().then(sync)
    return {
      check: async () => { await invoke(() => bridge.checkForUpdates()) },
      download: async () => { await invoke(() => bridge.downloadUpdate()) },
      install: async () => {
        const result = await bridge.installUpdate()
        if (!result.opened) throw new Error(result.message ?? 'Failed to open the verified installer.')
        sync(await bridge.getUpdateStatus())
      },
    }
  }
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'system-update',
    order: 95,
    label: () => t('section'),
    locale: NS,
    store,
    inject: injected,
  }, SystemUpdateSection))
}
