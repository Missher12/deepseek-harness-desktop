/** Visible chat card for a cross-session relay message. */

import { memo } from 'react'
import type { ReactNode } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ContextMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { IconSendOutline16, MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './RelayNodeView.module.css'

type Translate = ChatViewSlotProps['t']

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Whether the durable source records a session-messenger relay: a
 * `plugin`-kind record whose producer declares the `relay` form. Relays from
 * other producers (subagent coordinators) keep their context presentation.
 */
export function isSessionMessengerRelay(source: unknown): boolean {
  const record = asRecord(source)
  return record !== null
    && record.kind === 'plugin'
    && record.plugin === 'dsh-session-messenger'
    && record.form === 'relay'
}

/** The sending agent's session id, or null when the record does not name one. */
function relaySender(source: unknown): string | null {
  const sender = asRecord(source)?.['senderSessionId']
  return typeof sender === 'string' && sender !== '' ? sender : null
}

/** Whether this delivery woke the receiving session (follow-up mode). */
function relayWake(source: unknown): boolean {
  return asRecord(source)?.['mode'] === 'followup'
}

/**
 * The untrusted message body: the block the producer flagged with
 * `bodyBlockIndex`, or the last text block when the flag is unreadable.
 */
function relayBody(content: ContextMessageNode['content'], source: unknown): string {
  const index = asRecord(source)?.['bodyBlockIndex']
  const blocks = content.filter(block => block.type === 'text')
  const flagged = typeof index === 'number' && Number.isSafeInteger(index)
    ? content[index]
    : blocks.at(-1)
  if (flagged === undefined || flagged.type !== 'text') return ''
  return flagged.text
}

/** Sender label: the source session's durable title, else display title, else its id. */
function senderLabelOf(sessions: SessionListState, sender: string | null): string | undefined {
  if (sender === null) return undefined
  const summary = sessions.byId[sender as SessionId]
  return summary === undefined ? undefined : summary.title ?? summary.displayTitle
}

/**
 * A session-messenger relay rendered inline in the chat flow — who sent it
 * from another session, then what they said — instead of a collapsed
 * context-injection row.
 */
export const RelayNodeView = memo(function RelayNodeView({
  content, source, useSessions, t,
}: {
  content: ContextMessageNode['content']
  source: unknown
  useSessions: SnapshotSelectorHook<SessionListState>
  t: Translate
}): ReactNode {
  const sender = relaySender(source)
  const senderLabel = useSessions(sessions => senderLabelOf(sessions, sender))
  const label = senderLabel ?? sender ?? t('message.relay.unknownSender')
  const wake = relayWake(source)
  const body = relayBody(content, source)
  return (
    <div className={css.root} data-session-relay-incoming>
      <div className={css.header}>
        <IconSendOutline16 size={14} className={css.icon} />
        <span className={css.attribution}>{t('message.relay.from', { session: label })}</span>
        {wake && <span className={css.chip}>{t('message.relay.wake')}</span>}
      </div>
      {body !== '' && (
        <p className={css.body}>
          <MessageText text={body} />
        </p>
      )}
    </div>
  )
})
