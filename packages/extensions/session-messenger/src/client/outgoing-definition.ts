import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import type { OutgoingRelayEvent } from '../types.ts'

export interface OutgoingRelayChatData extends OutgoingRelayEvent { readonly time: number }

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Model-hidden source-side transcript for an accepted cross-session relay. */
    'session-relay-outgoing': OutgoingRelayChatData
  }
}

interface OutgoingState extends OutgoingRelayChatData { readonly seq: number }

export const outgoingRelayDefinition: ConversationNodeDefinition<OutgoingState> = {
  kind: 'session-messenger-outgoing',
  target: 'chat',
  match: event => event.type === 'session-messenger/outgoing'
    ? { id: String(event.data.deliveryId), role: 'start' }
    : null,
  start: (_context, match) => {
    const event = match.event as SessionEvent<'session-messenger/outgoing'>
    return { ...event.data, seq: event.seq, time: event.time }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined ? null : {
    key: context.key,
    kind: 'session-relay-outgoing',
    id: context.id,
    target: 'chat',
    anchorSeq: context.state.seq,
    location: context.start?.location ?? { kind: 'unresolved' },
    visibility: 'visible',
    data: context.state,
  },
}
