import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconCopyOutline16,
  IconLoadingOutline16,
  IconSendOutline16,
  IconWarningOutline16,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MessengerUiInjected } from './MessengerUiController.ts'
import { summarizeMessenger } from './store.ts'
import { NS } from './locales.ts'
import css from './MessengerStatus.module.css'

export type MessengerDrawerProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<MessengerUiInjected>

function focusTrigger(sessionId: SessionId | undefined): void {
  if (sessionId === undefined) return
  const triggers = document.querySelectorAll<HTMLButtonElement>('[data-messenger-trigger]')
  for (const trigger of triggers) {
    if (trigger.dataset.sessionId === sessionId) {
      trigger.focus()
      return
    }
  }
}

/** Resizable frame-level communication drawer owned entirely by the removable plugin. */
export function MessengerDrawer({
  useSessions, useMessenger, useMessengerUi,
  selectSession, close, setWidth, clearReply, send, reply, acknowledge, t,
}: MessengerDrawerProps) {
  const sessionId = useSessions(state => state.current)
  const snapshot = useMessenger(value => value)
  const ui = useMessengerUi(value => value)
  const summary = summarizeMessenger(snapshot, sessionId)
  const [targetId, setTargetId] = useState('')
  const [message, setMessage] = useState('')
  const [wake, setWake] = useState(true)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const drag = useRef<{ x: number; width: number } | null>(null)

  useEffect(() => { selectSession(sessionId) }, [selectSession, sessionId])
  useEffect(() => {
    if (!ui.open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
      queueMicrotask(() => { focusTrigger(sessionId) })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [close, sessionId, ui.open])

  const receipts = useMemo(() => [...snapshot.receipts.values()]
    .filter(receipt => receipt.sourceSessionId === sessionId || receipt.targetSessionId === sessionId)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 6), [sessionId, snapshot.receipts])

  if (!ui.open) return null

  const finishClose = (): void => {
    close()
    queueMicrotask(() => { focusTrigger(sessionId) })
  }

  const copyCurrent = async (): Promise<void> => {
    if (sessionId === undefined) return
    const accepted = await writeClipboard(sessionId)
    setFeedback(t(accepted ? 'copied' : 'copyFailed'))
  }

  const markRead = async (): Promise<void> => {
    if (sessionId === undefined || summary.unreadDeliveryIds.length === 0) return
    try {
      await acknowledge(sessionId, summary.unreadDeliveryIds)
      setFeedback(t('markedRead'))
    } catch {
      setFeedback(t('ackFailed'))
    }
  }

  const submit = async (): Promise<void> => {
    if (submittingRef.current || sessionId === undefined || message.trim() === '') return
    if (ui.reply === null && targetId.trim() === '') return
    submittingRef.current = true
    setSubmitting(true)
    setFeedback(null)
    try {
      if (ui.reply === null) {
        await send(sessionId, targetId.trim() as SessionId, message, wake)
        setMessage('')
        setFeedback(t('sendSuccess'))
      } else {
        await reply(sessionId, ui.reply.deliveryId, message, wake)
        setMessage('')
        clearReply()
        setFeedback(t('replySuccess'))
      }
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : t('sendFailed'))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const onResizeStart = (event: PointerEvent<HTMLDivElement>): void => {
    drag.current = { x: event.clientX, width: ui.width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizeMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current === null) return
    setWidth(drag.current.width + drag.current.x - event.clientX)
  }
  const onResizeEnd = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current === null) return
    onResizeMove(event)
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const style = { '--messenger-drawer-width': `${String(ui.width)}px` } as CSSProperties
  return (
    <aside className={css.drawer} style={style} role="dialog" aria-label={t('panelTitle')}>
      <div
        className={css.resizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('resize')}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') setWidth(ui.width + 16)
          if (event.key === 'ArrowRight') setWidth(ui.width - 16)
        }}
      />
      <header className={css.drawerHeader}>
        <div>
          <strong>{t('panelTitle')}</strong>
          <p>{t('panelDescription')}</p>
        </div>
        <button type="button" className={css.iconAction} aria-label={t('close')} onClick={finishClose}>
          <IconCloseOutline16 />
        </button>
      </header>

      <div className={css.drawerBody}>
        <section className={css.sessionCard}>
          <div className={css.sectionHead}>
            <span>{t('currentSession')}</span>
            <button type="button" className={css.textAction} disabled={sessionId === undefined} onClick={() => { void copyCurrent() }}>
              <IconCopyOutline16 size={14} />
              {t('copyShort')}
            </button>
          </div>
          <code>{sessionId ?? t('noSession')}</code>
          <div className={css.metrics}>
            <span data-messenger-state="pending"><IconLoadingOutline16 size={14} />{t('pending', { count: summary.pending })}</span>
            <span data-messenger-state="unread"><IconSendOutline16 size={14} />{t('unread', { count: summary.unread })}</span>
            <button type="button" disabled={summary.unread === 0} onClick={() => { void markRead() }}>
              <IconCheckOutline16 size={14} />{t('markRead')}
            </button>
          </div>
        </section>

        <section className={css.composerCard}>
          <div className={css.sectionHead}>
            <strong>{ui.reply === null ? t('composeTitle') : t('replyTitle')}</strong>
            {ui.reply !== null && (
              <button type="button" className={css.textAction} onClick={clearReply}>{t('cancelReply')}</button>
            )}
          </div>
          {ui.reply === null
            ? (
              <label className={css.field}>
                <span>{t('targetSession')}</span>
                <input value={targetId} onChange={(event) => { setTargetId(event.target.value) }} placeholder={t('targetPlaceholder')} />
              </label>
            )
            : (
              <div className={css.replyTarget}>
                <span>{t('replyTo')}</span>
                <code>{ui.reply.senderSessionId}</code>
                <span>{t('deliveryId')}</span>
                <code>{ui.reply.deliveryId}</code>
              </div>
            )}
          <label className={css.field}>
            <span>{t('messageLabel')}</span>
            <textarea value={message} onChange={(event) => { setMessage(event.target.value) }} rows={5} />
          </label>
          <div className={css.composeActions}>
            <label className={css.wake}>
              <input type="checkbox" checked={wake} onChange={(event) => { setWake(event.target.checked) }} />
              <span>{t('wake')}</span>
            </label>
            <button
              type="button"
              className={css.primaryAction}
              disabled={submitting || sessionId === undefined || message.trim() === '' || (ui.reply === null && targetId.trim() === '')}
              onClick={() => { void submit() }}
            >
              {submitting ? <IconLoadingOutline16 size={14} /> : <IconSendOutline16 size={14} />}
              {ui.reply === null ? t('send') : t('sendReply')}
            </button>
          </div>
          {feedback !== null && (
            <p className={css.feedback} role="status" aria-live="polite">{feedback}</p>
          )}
        </section>

        <section className={css.activity}>
          <div className={css.sectionHead}><strong>{t('recentActivity')}</strong></div>
          {receipts.length === 0
            ? <p className={css.empty}>{t('noActivity')}</p>
            : (
              <ul>
                {receipts.map(receipt => (
                  <li key={receipt.deliveryId}>
                    {receipt.errorCode === undefined
                      ? <IconCheckOutline16 size={14} />
                      : <IconWarningOutline16 size={14} />}
                    <span>{receipt.replyToDeliveryId === undefined ? t('delivery') : t('reply')}</span>
                    <code>{receipt.deliveryId}</code>
                    <small>{receipt.errorCode ?? receipt.status}</small>
                  </li>
                ))}
              </ul>
            )}
        </section>
        {snapshot.connectionError !== null && <p className={css.connectionError}>{snapshot.connectionError}</p>}
      </div>
    </aside>
  )
}
