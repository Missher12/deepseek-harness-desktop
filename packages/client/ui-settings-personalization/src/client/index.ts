import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
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
export const inject = ['slots', 'locale', 'connection']

/** Registers the localized personalization section against the typed Settings API. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-personalization: dictionaries')
  const api = (ctx.get('connection') as ConnectionHandle).api.settings
  const load: PersonalizationSectionInjected['load'] = async () => {
    const response = await api.personalizationRead({})
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value
  }
  const save: PersonalizationSectionInjected['save'] = async (input: PersonalizationWrite) => {
    const response = await api.personalizationWrite(input)
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value
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
