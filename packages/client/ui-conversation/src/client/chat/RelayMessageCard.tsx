import type { ContextMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconCopyOutline16,
  IconSendOutline16,
  MessageText,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatMessageClock } from './message-chrome.ts'
import css from './RelayMessageCard.module.css'

const SESSION_MESSENGER_PLUGIN = 'dsh-session-messenger'
const REPLY_EVENT = 'dsh-session-messenger:reply'
const PRINTABLE_ID = /^[\x21-\x7e]+$/

/** Strictly recognized relay fields rendered outside the generic context disclosure. */
export interface RelayMessageView {
  readonly senderSessionId: string
  readonly deliveryId: string
  readonly mode: 'inject' | 'followup'
  readonly body: string
  readonly metadata: string | null
}

function safeId(value: unknown): value is string {
  return typeof value === 'string'
    && PRINTABLE_ID.test(value)
    && new TextEncoder().encode(value).byteLength <= 256
}

/** Return a visible relay only for the exact session-messenger schema. */
export function readRelayMessage(
  source: unknown,
  content: ContextMessageNode['content'],
): RelayMessageView | null {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null
  const record = source as Record<string, unknown>
  if (record.kind !== 'plugin'
    || record.plugin !== SESSION_MESSENGER_PLUGIN
    || record.form !== 'relay'
    || !safeId(record.senderSessionId)
    || !safeId(record.deliveryId)
    || (record.mode !== 'inject' && record.mode !== 'followup')
    || !Number.isInteger(record.bodyBlockIndex)) return null
  const bodyBlockIndex = record.bodyBlockIndex as number
  if (bodyBlockIndex < 0 || bodyBlockIndex >= content.length) return null
  const bodyBlock = content[bodyBlockIndex]
  if (bodyBlock?.type !== 'text') return null
  const metadataBlock = content[0]
  return {
    senderSessionId: record.senderSessionId,
    deliveryId: record.deliveryId,
    mode: record.mode,
    body: bodyBlock.text,
    metadata: metadataBlock?.type === 'text' && bodyBlockIndex !== 0 ? metadataBlock.text : null,
  }
}

/** Visible Harness-style card for one durable cross-session relay record. */
export function RelayMessageCard({ relay, time, t }: {
  readonly relay: RelayMessageView
  readonly time: number
  readonly t: ChatViewSlotProps['t']
}) {
  const reply = (): void => {
    window.dispatchEvent(new CustomEvent(REPLY_EVENT, {
      detail: {
        deliveryId: relay.deliveryId,
        senderSessionId: relay.senderSessionId,
      },
    }))
  }

  return (
    <article className={css.root} data-session-relay-card data-session-relay-mode={relay.mode}>
      <div className={css.accent} aria-hidden />
      <div className={css.content}>
        <header className={css.header}>
          <span className={css.title}>{t('message.relay.title')}</span>
          <span className={css.mode}>{t(`message.relay.mode.${relay.mode}`)}</span>
        </header>
        <div className={css.sourceRow}>
          <span className={css.from}>{t('message.relay.from')}</span>
          <code className={css.sessionId}>{relay.senderSessionId}</code>
          <Tooltip label={t('message.relay.copySessionId')} side="bottom">
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('message.relay.copySessionId')}
              onClick={() => { void writeClipboard(relay.senderSessionId) }}
            >
              <IconCopyOutline16 size={14} />
            </button>
          </Tooltip>
        </div>
        <div className={css.body}><MessageText text={relay.body} /></div>
        <footer className={css.footer}>
          <time className={css.time} dateTime={new Date(time).toISOString()}>{formatMessageClock(time, t)}</time>
          {relay.metadata !== null && (
            <details className={css.details}>
              <summary>{t('message.relay.details')}</summary>
              <pre>{relay.metadata}</pre>
            </details>
          )}
          <button type="button" className={css.reply} aria-label={t('message.relay.reply')} onClick={reply}>
            <IconSendOutline16 size={14} />
            <span>{t('message.relay.reply')}</span>
          </button>
        </footer>
      </div>
    </article>
  )
}
