/** Harness-native reasoning-effort model-seat plugin. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only service and slot/locale declarations; runtime collaboration rides Cordis.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { EffortControl, type EffortControlInjected } from './EffortControl.tsx'
import { en, zh, type ReasoningEffortKey } from './locales.ts'

export { EffortControl, EffortSlider, effectiveEffortIndex, sliderLevels } from './EffortControl.tsx'
export type { EffortControlInjected, EffortSliderProps } from './EffortControl.tsx'
export { drawRadiation } from './draw-radiation.ts'
export type { RadiationState } from './draw-radiation.ts'
export type { ReasoningEffortKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy owned by the removable reasoning-effort model-seat plugin. */
    reasoningEffort: ReasoningEffortKey
  }
}

/** Cordis Client plugin name. */
export const name = 'reasoning-effort-client'

/** Exact services required by the replacement model seat. */
export const inject = ['locale', 'modelDirectories', 'sessions', 'slots', 'remote', 'remote.session']

/** Register localized dictionaries and the priority -100 single-seat entry. */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register('reasoningEffort', { zh, en }),
    'reasoning-effort: dictionaries',
  )
  ctx.slots.inject('conversation.input.model', () => ctx.slots.register({
    name: 'conversation.input.model',
    priority: -100,
    locale: 'reasoningEffort',
    inject: (sessionId: SessionId): EffortControlInjected => {
      if (ctx.sessions.subagentAddress(sessionId) !== undefined) {
        return { available: false, controller: null }
      }
      return { available: true, controller: ctx.modelDirectories.directoryFor(sessionId), sessionId }
    },
  }, EffortControl))
}
