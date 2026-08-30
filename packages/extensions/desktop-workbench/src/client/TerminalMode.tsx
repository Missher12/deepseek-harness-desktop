import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchTerminalSnapshot } from '../protocol.ts'
import { workbenchTransport } from './transport.ts'
import { NS } from './locales.ts'
import css from './TerminalMode.module.css'

type Props = PropsRuntime<'layout.utility'> & PropsLocale<typeof NS>

function printable(text: string): string {
  return text.replace(/\u001B(?:[@-_]|\[[0-?]*[ -/]*[@-~])/gu, '')
}

export function TerminalMode({ sessionId, t }: Props) {
  const [items, setItems] = useState<WorkbenchTerminalSnapshot[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [command, setCommand] = useState('')
  const [clearedAt, setClearedAt] = useState<Record<string, number>>({})
  const [error, setError] = useState<string>()
  const owned = useRef(new Set<string>())
  const active = useMemo(() => items.find(item => item.id === activeId) ?? items[0], [activeId, items])
  const refresh = useCallback(async () => {
    const result = await workbenchTransport.terminalSnapshots(sessionId)
    setItems(result.terminals.filter(item => owned.current.has(item.id)))
  }, [sessionId])
  const open = useCallback(async () => {
    if (owned.current.size >= 4) return
    const item = await workbenchTransport.openTerminal(sessionId)
    owned.current.add(item.id)
    setActiveId(item.id)
    await refresh()
  }, [refresh, sessionId])
  useEffect(() => {
    let mounted = true
    void open().catch((reason: unknown) => { if (mounted) setError(reason instanceof Error ? reason.message : String(reason)) })
    const timer = window.setInterval(() => {
      void refresh().catch((reason: unknown) => { if (mounted) setError(reason instanceof Error ? reason.message : String(reason)) })
    }, 300)
    return () => {
      mounted = false
      window.clearInterval(timer)
      const ids = [...owned.current]
      owned.current.clear()
      for (const id of ids) void workbenchTransport.terminalAction(sessionId, id, 'close').catch(() => {})
    }
  }, [open, refresh, sessionId])
  const send = async () => {
    if (active === undefined || command === '') return
    const value = command
    setCommand('')
    await workbenchTransport.terminalAction(sessionId, active.id, 'write', `${value}\n`)
    await refresh()
  }
  const close = async (id: string) => {
    owned.current.delete(id)
    await workbenchTransport.terminalAction(sessionId, id, 'close')
    if (activeId === id) setActiveId(undefined)
    await refresh()
  }
  const offset = active === undefined ? 0 : (clearedAt[active.id] ?? 0)
  const output = active === undefined ? '' : printable(active.output.slice(offset))
  return <div className={css.terminal}>
    <div className={css.tabs}>
      {items.map((item, index) => <button key={item.id} type="button" data-active={item.id === active?.id || undefined}
        onClick={() => { setActiveId(item.id) }}>{t('terminalTab', { index: index + 1 })}<span>{item.status === 'running' ? '●' : '○'}</span></button>)}
      <button type="button" disabled={owned.current.size >= 4} onClick={() => { void open() }}>＋</button>
    </div>
    <div className={css.meta}><code>{active?.cwd ?? ''}</code><span>
      <button type="button" disabled={active === undefined} onClick={() => {
        if (active !== undefined) setClearedAt(value => ({ ...value, [active.id]: active.output.length }))
      }}>{t('clearView')}</button>
      <button type="button" disabled={active === undefined} onClick={() => {
        if (active !== undefined) void workbenchTransport.terminalAction(sessionId, active.id, 'signal', 'SIGINT')
      }}>{t('terminalInterrupt')}</button>
      <button type="button" disabled={active === undefined} onClick={() => { if (active !== undefined) void close(active.id) }}>{t('close')}</button>
    </span></div>
    <pre className={css.output}>{output || error || t('terminalReady')}</pre>
    <form className={css.input} onSubmit={(event) => { event.preventDefault(); void send() }}>
      <span>$</span><input value={command} autoComplete="off" spellCheck={false} onChange={(event) => { setCommand(event.target.value) }}
        placeholder={t('terminalPlaceholder')} disabled={active?.status !== 'running'} />
    </form>
  </div>
}
