import { useEffect, useMemo, useState } from 'react'
import { IconCopyOutline16, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FileEntry, FilePreview } from '../protocol.ts'
import { workbenchTransport } from './transport.ts'
import { NS } from './locales.ts'
import css from './ReadOnlyModes.module.css'

type Props = PropsRuntime<'layout.utility'> & PropsLocale<typeof NS>

export function FilesMode({ sessionId, t, useInput, inputActions }: Props) {
  const draft = useInput(state => state.draft)
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const shown = useMemo(() => entries.filter(entry => entry.name.toLowerCase().includes(filter.toLowerCase())), [entries, filter])
  useEffect(() => {
    let current = true
    setError(null)
    void workbenchTransport.list(sessionId, path).then((result) => { if (current) setEntries(result.entries) }, (reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [path, sessionId])
  const open = (entry: FileEntry) => {
    if (entry.kind === 'directory') { setPath(entry.path); setPreview(null); return }
    void workbenchTransport.read(sessionId, entry.path).then(
      setPreview,
      (reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) },
    )
  }
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const mention = () => {
    if (preview === null) return
    inputActions.setDraft(`${draft}${draft === '' || /\s$/u.test(draft) ? '' : ' '}@${preview.path} `)
  }
  return <div className={css.split}>
    <div className={css.listPane}>
      <div className={css.toolbar}><button type="button" disabled={path === ''} onClick={() => { setPath(parent) }}>‹</button><code>{path || '/'}</code></div>
      <input className={css.filter} value={filter} onChange={(event) => { setFilter(event.target.value) }} placeholder={t('filterFiles')} />
      <ul>{shown.map(entry => <li key={entry.path}><button type="button" onClick={() => { open(entry) }}><span>{entry.kind === 'directory' ? '⌄' : '·'}</span>{entry.name}</button></li>)}</ul>
    </div>
    <div className={css.preview}>
      {preview === null ? <p>{error ?? t('selectFile')}</p> : <>
        <header><code>{preview.path}</code><span><button type="button" onClick={mention}>{t('mention')}</button><button type="button" onClick={() => { void writeClipboard(preview.path) }}><IconCopyOutline16 size={14} />{t('copy')}</button></span></header>
        {preview.binary ? <p>{t('binaryFile')}</p> : <pre>{preview.text}</pre>}
        {preview.truncated && <small>{t('truncated')}</small>}
      </>}
    </div>
  </div>
}
