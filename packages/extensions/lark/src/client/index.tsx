import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { LarkSettingsSection, type LarkSettingsInjected } from './LarkSettingsSection.tsx'
import { createLarkSettingsStore } from './store.ts'
import { en, zh, type LarkLocaleKey } from './locales.ts'

export { LarkSettingsSection } from './LarkSettingsSection.tsx'
export type { LarkSettingsInjected } from './LarkSettingsSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.lark': LarkLocaleKey }
}

export const name = 'lark-client'
export const NS = 'settings.lark'
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lark: dictionaries')
  const t = ctx.locale.bind(NS)
  const store = createLarkSettingsStore()
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'lark', order: 40,
    label: () => t('section'), locale: NS,
    inject: (): LarkSettingsInjected => ({ load: store.load, action: store.action }),
  }, LarkSettingsSection))
}
