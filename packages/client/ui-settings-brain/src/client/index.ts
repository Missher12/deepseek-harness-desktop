import type { BrainHubSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { BrainSettingsSection, type BrainSettingsInjected } from './BrainSettingsSection.tsx'
import { en, zh, type BrainSettingsLocaleKey } from './locales.ts'

export type { BrainSettingsInjected, BrainSettingsProps } from './BrainSettingsSection.tsx'
export type { BrainSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.brain': BrainSettingsLocaleKey }
}

/** Locale namespace owned by the Memory & Learning settings package. */
export const NS = 'settings.brain'
export const inject = ['slots', 'locale', 'remote', 'remote.missherBrain']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-brain: dictionaries')
  const t = ctx.locale.bind(NS)
  const load = async (): Promise<BrainHubSnapshot> => {
    const result = await ctx.remote.missherBrain.snapshot()
    if (!result.ok) throw new Error(`missherBrain.snapshot failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'brain', order: 9,
    label: () => t('section'), locale: NS, inject: (): BrainSettingsInjected => ({ load }),
  }, BrainSettingsSection))
}
