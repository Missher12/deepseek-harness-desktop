import { useMemo, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { IconCopyOutline16, IconSendOutline16, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchInjected } from './preferences.ts'
import { NS } from './locales.ts'
import css from './SideChatMode.module.css'

type Props = PropsRuntime<'layout.utility'> & PropsLocale<typeof NS> & InjectFace<WorkbenchInjected>

/** Continuous, session-scoped operator surface over the durable messenger transport. */
export function SideChatMode({ sessionId, useMessenger, send, reply, acknowledge, t }: Props) {
  const snapshot = useMessenger(state => state)
  const [target, setTarget] = useState('')
  const [body, setBody] = useState('')
  const [wake, setWake] = useState(true)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const submitting = useRef(false)
  const receipts = useMemo(() => [...snapshot.receipts.values()]
    .filter(item => item.sourceSessionId === sessionId || item.targetSessionId === sessionId)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 12), [sessionId, snapshot.receipts])

  const copyId = async () => {
    setFeedback(t(await writeClipboard(sessionId) ? 'copied' : 'copyFailed'))
  }
  const submit = async () => {
    if (submitting.current || body.trim() === '' || (replyTo === null && target.trim() === '')) return
    submitting.current = true
    setBusy(true)
    setFeedback(null)
    try {
      if (replyTo === null) await send(sessionId, target.trim() as SessionId, body.trim(), wake)
      else await reply(sessionId, replyTo, body.trim(), wake)
      setBody('')
      setReplyTo(null)
      setFeedback(t('sent'))
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : t('sendFailed'))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  return (
    <div className={css.root}>
      <div className={css.identity}>
        <div><span>{t('currentSession')}</span><code>{sessionId}</code></div>
        <button type="button" onClick={() => { void copyId() }}><IconCopyOutline16 size={14} />{t('copy')}</button>
      </div>
      <div className={css.composer}>
        {replyTo === null ? (
          <label><span>{t('targetSession')}</span><input value={target} onChange={(event) => { setTarget(event.target.value) }} placeholder={t('targetPlaceholder')} /></label>
        ) : (
          <div className={css.replying}><code>{replyTo}</code><button type="button" onClick={() => { setReplyTo(null) }}>{t('cancelReply')}</button></div>
        )}
        <label><span>{t('message')}</span><textarea rows={5} value={body} onChange={(event) => { setBody(event.target.value) }} /></label>
        <div className={css.actions}>
          <label className={css.wake}><input type="checkbox" checked={wake} onChange={(event) => { setWake(event.target.checked) }} />{t('wake')}</label>
          <button type="button" className={css.send} disabled={busy || body.trim() === '' || (replyTo === null && target.trim() === '')} onClick={() => { void submit() }}>
            <IconSendOutline16 size={14} />{t(busy ? 'sending' : 'send')}
          </button>
        </div>
        {feedback !== null && <p className={css.feedback} role="status">{feedback}</p>}
      </div>
      <div className={css.activity}>
        <h3>{t('recent')}</h3>
        {receipts.length === 0 ? <p>{t('noRecent')}</p> : <ul>{receipts.map((receipt) => {
          const inbound = receipt.targetSessionId === sessionId
          return <li key={receipt.deliveryId}>
            <span className={css.direction}>{inbound ? '←' : '→'}</span>
            <code>{inbound ? receipt.sourceSessionId : receipt.targetSessionId}</code>
            <small>{receipt.status}</small>
            {inbound && (receipt.status === 'delivered' || receipt.status === 'claimed') && <button type="button" onClick={() => {
              setReplyTo(receipt.deliveryId)
              if (!receipt.acknowledged) void acknowledge(sessionId, [receipt.deliveryId])
            }}>{t('reply')}</button>}
          </li>
        })}</ul>}
      </div>
      {snapshot.connectionError !== null && <p className={css.error}>{t('connectionError', { error: snapshot.connectionError })}</p>}
    </div>
  )
}
