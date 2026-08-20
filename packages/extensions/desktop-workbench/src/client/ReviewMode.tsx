import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReviewEntry } from '../protocol.ts'
import { workbenchTransport } from './transport.ts'
import { NS } from './locales.ts'
import css from './ReadOnlyModes.module.css'

type Props = PropsRuntime<'layout.utility'> & PropsLocale<typeof NS>

export function ReviewMode({ sessionId, t, inputActions }: Props) {
  const [entries, setEntries] = useState<ReviewEntry[]>([])
  const [selected, setSelected] = useState<string | undefined>()
  const [diff, setDiff] = useState('')
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => {
    setError(null)
    void workbenchTransport.status(sessionId).then(
      (result) => { setEntries(result.entries) },
      (reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) },
    )
  }, [sessionId])
  useEffect(refresh, [refresh])
  useEffect(() => {
    if (selected === undefined) { setDiff(''); return }
    void workbenchTransport.diff(sessionId, selected).then(
      (result) => { setDiff(result.text) },
      (reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) },
    )
  }, [selected, sessionId])
  return <div className={css.split}>
    <div className={css.listPane}><div className={css.toolbar}><strong>{t('changes')}</strong><button type="button" onClick={refresh}>{t('refresh')}</button></div>
      {entries.length === 0 ? <p>{error ?? t('noChanges')}</p> : <ul>{entries.map(entry => <li key={`${entry.status}:${entry.path}`}><button type="button" data-selected={entry.path === selected || undefined} onClick={() => { setSelected(entry.path) }}><span>{entry.status}</span>{entry.path}</button></li>)}</ul>}
    </div>
    <div className={css.preview}>{selected === undefined ? <p>{t('selectChange')}</p> : <><header><code>{selected}</code><button type="button" onClick={() => { inputActions.setDraft(t('reviewDraft', { path: selected })) }}>{t('reviewInChat')}</button></header><pre>{diff || t('noDiff')}</pre></>}</div>
  </div>
}
