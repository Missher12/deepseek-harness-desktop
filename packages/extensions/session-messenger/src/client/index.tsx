/** Harness Client plugin: one notification store and one sidebar footer action. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { MessengerStatus, type MessengerStatusInjected } from './MessengerStatus.tsx'
import { en, NS, zh, type SessionMessengerKey } from './locales.ts'
import {
  MessengerStore,
  createHttpMessengerTransport,
  readSessionMessengerBootstrap,
} from './store.ts'

export { MessengerStatus } from './MessengerStatus.tsx'
export type { MessengerStatusInjected, MessengerStatusProps } from './MessengerStatus.tsx'
export * from './store.ts'
export { en, NS, zh } from './locales.ts'
export type { SessionMessengerKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy owned by the removable session messenger Client plugin. */
    sessionMessenger: SessionMessengerKey
  }
}

/** Cordis Client plugin name. */
export const name = 'session-messenger-client'
/** The standard global session hook is renderer-supplied; only locale and slots are injected. */
export const inject = ['locale', 'slots']

/** Register one store-backed compact footer entry. */
export function apply(ctx: ClientContext): void {
  const bootstrap = readSessionMessengerBootstrap()
  const store = bootstrap === undefined
    ? new MessengerStore()
    : new MessengerStore(createHttpMessengerTransport(bootstrap))
  ctx.effect(() => async () => { await store.dispose() }, 'session-messenger: browser notification store')
  if (bootstrap !== undefined) {
    ctx.effect(() => store.start(), 'session-messenger: browser metadata stream')
  }
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'session-messenger: dictionaries',
  )
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'session-messenger',
    order: 80,
    locale: NS,
    inject: (): MessengerStatusInjected => ({ store }),
  }, MessengerStatus))
}
