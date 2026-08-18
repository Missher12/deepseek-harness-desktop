import { useEffect } from 'react'
import { IconSendOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MessengerUiInjected } from './MessengerUiController.ts'
import { summarizeMessenger } from './store.ts'
import { NS } from './locales.ts'
import css from './MessengerStatus.module.css'

export type MessengerHeaderButtonProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<MessengerUiInjected>

/** Compact per-session entry point placed beside the native header utilities. */
export function MessengerHeaderButton({
  sessionId, useMessenger, useMessengerUi, selectSession, toggle, t,
}: MessengerHeaderButtonProps) {
  const snapshot = useMessenger(value => value)
  const ui = useMessengerUi(value => value)
  const summary = summarizeMessenger(snapshot, sessionId)
  const badge = summary.unread + summary.pending
  const label = t('triggerLabel', { unread: summary.unread, pending: summary.pending })

  useEffect(() => { selectSession(sessionId) }, [selectSession, sessionId])

  return (
    <button
      type="button"
      className={css.headerTrigger}
      data-messenger-trigger
      data-session-id={sessionId}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={ui.open}
      onClick={() => { toggle(sessionId) }}
    >
      <IconSendOutline16 size={14} />
      <span>{t('trigger')}</span>
      {badge > 0 && <span className={css.headerBadge} aria-hidden>{badge > 99 ? '99+' : badge}</span>}
    </button>
  )
}
