/** Harness Client plugin: durable cross-session transport and transcript projection. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionMessengerKey } from './locales.ts'
import { en, NS, zh } from './locales.ts'
import { MessengerStore, createHttpMessengerTransport, readSessionMessengerBootstrap } from './store.ts'
import { outgoingRelayDefinition } from './outgoing-definition.ts'
import { OutgoingRelayView } from './OutgoingRelayView.tsx'

export * from './store.ts'
export { outgoingRelayDefinition } from './outgoing-definition.ts'
export { OutgoingRelayView } from './OutgoingRelayView.tsx'
export { en, NS, zh } from './locales.ts'
export type { SessionMessengerKey } from './locales.ts'
export type { OutgoingRelayChatData } from './outgoing-definition.ts'

/** Client-side transport face consumed by the removable Desktop workbench. */
export interface ISessionMessengerClient {
  readonly store: MessengerStore
  send: MessengerStore['send']
  reply: MessengerStore['reply']
  stop: MessengerStore['stop']
  acknowledge: MessengerStore['acknowledge']
}

declare module '@deepseek-ai/cordis' {
  interface Context { sessionMessengerClient: ISessionMessengerClient }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy owned by the removable session messenger Client plugin. */
    sessionMessenger: SessionMessengerKey
  }
}

/** Cordis Client plugin name. */
export const name = 'session-messenger-client'
/** Definition, renderer, locale, and service dependencies. */
export const inject = ['locale', 'slots', 'uiConversation']

/** Provide transport state and the source-side transcript renderer; mount no legacy drawer or button. */
export function apply(ctx: ClientContext): void {
  const bootstrap = readSessionMessengerBootstrap()
  const store = bootstrap === undefined
    ? new MessengerStore()
    : new MessengerStore(createHttpMessengerTransport(bootstrap))
  const face: ISessionMessengerClient = {
    store,
    send: store.send.bind(store),
    reply: store.reply.bind(store),
    stop: store.stop.bind(store),
    acknowledge: store.acknowledge.bind(store),
  }
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('sessionMessengerClient', face)
    return () => { void disposeService() }
  }, 'session-messenger: client service')
  ctx.effect(() => async () => { await store.dispose() }, 'session-messenger: browser notification store')
  if (bootstrap !== undefined) ctx.effect(() => store.start(), 'session-messenger: browser metadata stream')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-messenger: dictionaries')
  ctx.uiConversation.events.register(outgoingRelayDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'session-relay-outgoing', locale: NS,
    inject: () => ({ messenger: face }),
  }, OutgoingRelayView))
}
