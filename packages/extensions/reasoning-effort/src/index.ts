/** Host companion for the profile-backed reasoning-effort preference. */

import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import {
  PREFERENCE_PATH,
  createPreferenceCapability,
  createPreferenceHttpHandler,
  injectPreferenceCapability,
} from './http.ts'
import {
  REASONING_EFFORT_SETTINGS_NAMESPACE,
  ReasoningEffortPreferenceSchema,
} from './preference.ts'

export * from './http.ts'
export * from './preference.ts'

/** Cordis Host plugin name. */
export const name = 'reasoning-effort'

/** Both services are required: no non-durable or route-only degraded mode. */
export const inject = ['settings', 'webServer']

/** Register the namespace, exact route, and generation-scoped index bootstrap. */
export function apply(ctx: Context): void {
  const scope = ctx.settings.register(
    REASONING_EFFORT_SETTINGS_NAMESPACE,
    ReasoningEffortPreferenceSchema,
  )
  const capability = createPreferenceCapability()
  const route: WebRoute = {
    kind: 'exact',
    path: PREFERENCE_PATH,
    handler: createPreferenceHttpHandler({
      port: ctx.webServer.port,
      capability,
      read: () => scope.get(),
      write: value => scope.replace(value),
    }),
  }
  ctx.effect(
    () => ctx.webServer.register(route),
    'reasoning-effort: preference route',
  )
  ctx.effect(
    () => ctx.webServer.tapIndex(html => injectPreferenceCapability(html, capability)),
    'reasoning-effort: preference bootstrap',
  )
}
