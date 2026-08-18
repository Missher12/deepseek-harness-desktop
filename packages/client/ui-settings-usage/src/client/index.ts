/** Read-only all-history usage dashboard registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { UsageInsightsSection, type UsageInsightsSectionInjected } from './UsageInsightsSection.tsx'
import { en, zh, type UsageInsightsLocaleKey } from './locales.ts'

export type { UsageInsightsSectionInjected, UsageInsightsSectionProps } from './UsageInsightsSection.tsx'
export type { UsageInsightsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** All-history local usage dashboard copy. */
    'settings.usage': UsageInsightsLocaleKey
  }
}

/** Dictionary namespace owned by this feature. */
export const NS = 'settings.usage'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.usageInsights']

/** Contribute the lazy Usage section between Models and Plugins. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-usage: dictionaries')
  const t = ctx.locale.bind(NS)
  const load: UsageInsightsSectionInjected['load'] = async () => {
    const result = await ctx.remote.usageInsights.snapshot()
    if (!result.ok) {
      throw new Error(`usageInsights.snapshot failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const injected = (): UsageInsightsSectionInjected => ({
    load,
    locale: ctx.locale.getLocale().active,
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 12,
    label: () => t('section'),
    locale: NS,
    inject: injected,
  }, UsageInsightsSection))
}
