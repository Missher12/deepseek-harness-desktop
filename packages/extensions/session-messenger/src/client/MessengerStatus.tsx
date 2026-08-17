/** Harness-native compact communication status entry for the sidebar footer. */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconCheckOutline16,
  IconCopyOutline16,
  IconLoadingOutline16,
  IconSendOutline16,
  IconWarningOutline16,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionMessengerKey } from './locales.ts'
import { MessengerStore, summarizeMessenger } from './store.ts'
import css from './MessengerStatus.module.css'

type Translate = (key: SessionMessengerKey, params?: Record<string, unknown>) => string

/** Private face injected by this plugin's footer registration. */
export interface MessengerStatusInjected {
  readonly store: MessengerStore
}

/** Root-global standard props plus the sidebar's wide/rail share. */
export interface MessengerStatusProps extends MessengerStatusInjected {
  readonly wide: boolean
  readonly useSessions: SnapshotSelectorHook<SessionListState>
  readonly t: Translate
}

/** Render status text and bounded actions without exposing message contents. */
export function MessengerStatus({ wide, useSessions, store, t }: MessengerStatusProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const sessionId = useSessions(state => state.current)
  const summary = summarizeMessenger(snapshot, sessionId)
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      queueMicrotask(() => { trigger.current?.focus() })
    }
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('keydown', close) }
  }, [open])

  const copyCurrent = async (): Promise<void> => {
    if (sessionId === undefined) {
      setFeedback(t('noSession'))
      return
    }
    try {
      const accepted = await writeClipboard(sessionId)
      setFeedback(t(accepted ? 'copied' : 'copyFailed'))
    } catch {
      setFeedback(t('copyFailed'))
    }
  }

  const markRead = async (): Promise<void> => {
    if (sessionId === undefined || summary.unreadDeliveryIds.length === 0) return
    try {
      await store.acknowledge(sessionId, summary.unreadDeliveryIds)
      setFeedback(t('markedRead'))
    } catch {
      setFeedback(t('ackFailed'))
    }
  }

  const liveSummary = t('triggerLabel', { unread: summary.unread, pending: summary.pending })
  const badge = summary.unread + summary.pending

  return (
    <div className={`${css.root} ${wide ? '' : css.rail}`}>
      <button
        ref={trigger}
        type="button"
        className={css.trigger}
        aria-label={liveSummary}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(current => !current); setFeedback(null) }}
      >
        <IconSendOutline16 size={wide ? 16 : 18} />
        {wide && <span className={css.triggerText}>{t('trigger')}</span>}
        {badge > 0 && <span className={css.badge} aria-hidden>{badge > 99 ? '99+' : badge}</span>}
      </button>

      {open && (
        <section className={css.panel} role="dialog" aria-label={t('panelTitle')}>
          <div className={css.heading}>
            <strong>{t('panelTitle')}</strong>
            <button
              type="button"
              className={css.close}
              aria-label={t('close')}
              onClick={() => { setOpen(false); trigger.current?.focus() }}
            >
              ×
            </button>
          </div>
          <div className={css.states}>
            <div className={css.stateRow} data-messenger-state="pending">
              <IconLoadingOutline16 size={16} />
              <span>{t('pending', { count: summary.pending })}</span>
            </div>
            <div className={css.stateRow} data-messenger-state="unread">
              <IconSendOutline16 size={16} />
              <span>{t('unread', { count: summary.unread })}</span>
            </div>
            {summary.latestError === null
              ? (
                <div className={css.stateRow} data-messenger-state="ok">
                  <IconCheckOutline16 size={16} />
                  <span>{t('noError')}</span>
                </div>
              )
              : (
                <div className={`${css.stateRow} ${css.error}`} data-messenger-state="error">
                  <IconWarningOutline16 size={16} />
                  <span>{t('latestError', { error: summary.latestError })}</span>
                </div>
              )}
          </div>
          <div className={css.actions}>
            <button type="button" disabled={sessionId === undefined} onClick={() => { void copyCurrent() }}>
              <IconCopyOutline16 size={16} />
              <span>{t('copy')}</span>
            </button>
            <button
              type="button"
              disabled={sessionId === undefined || summary.unread === 0}
              onClick={() => { void markRead() }}
            >
              <IconCheckOutline16 size={16} />
              <span>{t('markRead')}</span>
            </button>
          </div>
          {feedback !== null && (
            <p className={css.feedback} role="status" aria-live="polite" aria-atomic="true">
              {feedback}
            </p>
          )}
          {snapshot.connectionError !== null && (
            <p className={`${css.feedback} ${css.error}`}>{snapshot.connectionError}</p>
          )}
        </section>
      )}

      {(!open || feedback === null) && (
        <span className={css.live} role="status" aria-live="polite" aria-atomic="true">
          {feedback ?? liveSummary}
        </span>
      )}
    </div>
  )
}
