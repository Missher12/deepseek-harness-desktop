/** Harness Client plugin: one notification store, header trigger, and shell drawer. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { MessengerDrawer } from './MessengerDrawer.tsx'
import { MessengerHeaderButton } from './MessengerHeaderButton.tsx'
import { MessengerUiController, type MessengerUiInjected } from './MessengerUiController.ts'
import { en, NS, zh, type SessionMessengerKey } from './locales.ts'
import {
  MessengerStore,
  createHttpMessengerTransport,
  readSessionMessengerBootstrap,
} from './store.ts'

export { MessengerStatus } from './MessengerStatus.tsx'
export type { MessengerStatusInjected, MessengerStatusProps } from './MessengerStatus.tsx'
export { MessengerDrawer } from './MessengerDrawer.tsx'
export type { MessengerDrawerProps } from './MessengerDrawer.tsx'
export { MessengerHeaderButton } from './MessengerHeaderButton.tsx'
export type { MessengerHeaderButtonProps } from './MessengerHeaderButton.tsx'
export * from './MessengerUiController.ts'
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

/** Register a shared controller across one Session header entry and one root drawer. */
export function apply(ctx: ClientContext): void {
  const bootstrap = readSessionMessengerBootstrap()
  const store = bootstrap === undefined
    ? new MessengerStore()
    : new MessengerStore(createHttpMessengerTransport(bootstrap))
  const ui = new MessengerUiController()
  ctx.effect(() => async () => { await store.dispose() }, 'session-messenger: browser notification store')
  ctx.effect(() => ui.listen(), 'session-messenger: visible relay reply bridge')
  if (bootstrap !== undefined) {
    ctx.effect(() => store.start(), 'session-messenger: browser metadata stream')
  }
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'session-messenger: dictionaries',
  )
  const face = (): MessengerUiInjected => ({
    hooks: { messenger: store, messengerUi: ui },
    selectSession: (sessionId) => { ui.selectSession(sessionId) },
    toggle: (sessionId) => { ui.toggle(sessionId) },
    close: () => { ui.close() },
    setWidth: (width) => { ui.setWidth(width) },
    clearReply: () => { ui.clearReply() },
    send: (sourceSessionId, targetSessionId, message, wake) =>
      store.send(sourceSessionId, targetSessionId, message, wake),
    reply: (sourceSessionId, deliveryId, message, wake) =>
      store.reply(sourceSessionId, deliveryId, message, wake),
    acknowledge: (sessionId: SessionId, deliveryIds: readonly string[]) =>
      store.acknowledge(sessionId, deliveryIds),
  })
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'session-messenger',
    order: 80,
    locale: NS,
    inject: face,
  }, MessengerHeaderButton))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-messenger-drawer',
    order: 80,
    locale: NS,
    inject: face,
  }, MessengerDrawer))
}
