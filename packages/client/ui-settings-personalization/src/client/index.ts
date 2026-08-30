import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the generated ctx.remote.settings namespace into this client face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  PersonalizationSection, type PersonalizationSectionInjected, type PersonalizationWrite,
} from './PersonalizationSection.tsx'
import { en, zh, type PersonalizationLocaleKey } from './locales.ts'

export type {
  PersonalizationSectionInjected, PersonalizationSectionProps,
  PersonalizationStyle, PersonalizationView, PersonalizationWrite,
} from './PersonalizationSection.tsx'
export type { PersonalizationLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.personalization': PersonalizationLocaleKey
  }
}

/** Locale namespace owned by the global personalization Settings section. */
export const NS = 'settings.personalization'
/** Browser services required to register and operate the Settings section. */
export const inject = ['slots', 'locale', 'remote', 'remote.settings']

/** Registers the localized personalization section against the typed Settings API. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-personalization: dictionaries')
  const load: PersonalizationSectionInjected['load'] = async () => {
    const response = await ctx.remote.settings.personalizationRead()
    if (!response.ok) throw new Error(response.error.message)
    return response.value
  }
  const save: PersonalizationSectionInjected['save'] = async (input: PersonalizationWrite) => {
    const response = await ctx.remote.settings.personalizationWrite(input)
    if (!response.ok) throw new Error(response.error.message)
    return response.value
  }
  const injected = (): PersonalizationSectionInjected => ({ load, save })
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personalization',
    order: 5,
    label: () => t('section'),
    locale: NS,
    inject: injected,
  }, PersonalizationSection))
}
