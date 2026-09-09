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
  return ['getUpdateStatus', 'checkForUpdates', 'downloadUpdate', 'cancelUpdateDownload', 'installUpdate', 'onUpdateStatus']
    .every(key => typeof bridge[key] === 'function')
}

export function apply(ctx: ClientContext): void {
  const bridge = window.dshDesktop
  if (!isDesktopUpdateBridge(bridge)) return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-system-update: dictionaries')
  const store = createSystemUpdateStore()
  let bound: BoundActions<typeof store> | undefined
  let revision = 0
  const sync = (snapshot: DesktopUpdateSnapshot): void => {
    revision += 1
    bound?.sync(snapshot)
  }
  ctx.effect(() => {
    const unsubscribe = bridge.onUpdateStatus(sync)
    return () => {
      bound = undefined
      revision += 1
      unsubscribe()
    }
  }, 'ui-settings-system-update: Desktop IPC subscription')
  const invoke = async (operation: () => Promise<DesktopUpdateSnapshot>): Promise<void> => {
    const requestRevision = ++revision
    const snapshot = await operation()
    if (requestRevision === revision) sync(snapshot)
  }
  const readStatus = async (): Promise<void> => {
    if (!bound) return
    const requestRevision = ++revision
    bound.loading()
    try {
      const snapshot = await bridge.getUpdateStatus()
      if (requestRevision === revision) sync(snapshot)
    } catch {
      if (requestRevision === revision) bound.loadFailed()
    }
  }
  const injected = (actions: BoundActions<typeof store>): SystemUpdateInjected => {
    bound = actions
    revision += 1
    void readStatus()
    return {
      retryStatus: readStatus,
      check: async () => { await invoke(() => bridge.checkForUpdates()) },
      download: async () => { await invoke(() => bridge.downloadUpdate()) },
      cancelDownload: async () => { await invoke(() => bridge.cancelUpdateDownload()) },
      install: async () => {
        const result = await bridge.installUpdate()
        if (result.status === 'error') throw new Error(result.message)
        await readStatus()
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
