import { useEffect, useState } from 'react'
import type { LarkSettingsStatus } from './store.ts'
import css from './LarkSettingsSection.module.css'

export interface LarkSettingsInjected {
  load(): Promise<LarkSettingsStatus>
  action(body: Record<string, unknown>): Promise<unknown>
}

interface Props extends LarkSettingsInjected {
  t(key: string): string
}

export function LarkSettingsSection({ t, load, action }: Props) {
  const [status, setStatus] = useState<LarkSettingsStatus | null>(null)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  useEffect(() => {
    let active = true
    void load().then((value) => { if (active) setStatus(value) }).catch(() => {})
    return () => { active = false }
  }, [load])
  const run = async (body: Record<string, unknown>): Promise<void> => {
    const value = await action(body)
    if (typeof value === 'object' && value !== null && 'enabled' in value) setStatus(value as LarkSettingsStatus)
  }
  const save = (): void => {
    void run({ action: 'set-credentials', appId, appSecret })
    setAppSecret('')
  }
  return (
    <section className={css.root} data-lark-settings>
      <header><h2>{t('title')}</h2></header>
      <div className={css.grid}>
        <span>{t('enabled')}</span><strong>{status === null ? '—' : status.enabled ? t('enabled') : t('disabled')}</strong>
        <span>{t('connected')}</span><strong>{status === null ? '—' : status.connected ? t('online') : t('offline')}</strong>
        <span>{t('binding')}</span><strong>{status?.binding === undefined || status.binding === null ? '—' : `${status.binding.projectPath} · ${status.binding.sessionId}`}</strong>
        <span>{t('queue')}</span><strong>{status === null ? '—' : String(status.queueDepth)}</strong>
      </div>
      <div className={css.credentials}>
        <label>{t('appId')}<input aria-label="appId" value={appId} onChange={event => setAppId(event.target.value)} /></label>
        <label>{t('appSecret')}<input aria-label="appSecret" type="password" value={appSecret} onChange={event => setAppSecret(event.target.value)} /></label>
        <button disabled={!appId || !appSecret} onClick={save}>{t('saveCredentials')}</button>
      </div>
      <div className={css.actions}>
        <button onClick={() => { void run({ action: status?.enabled ? 'disable' : 'enable' }) }}>{status?.enabled ? t('disable') : t('enable')}</button>
        <button disabled={!status?.queuePaused} onClick={() => { void run({ action: 'resume' }) }}>{t('resume')}</button>
        <button onClick={() => { if (window.confirm(t('confirmRepair'))) void run({ action: 'repair', confirm: true }) }}>{t('repair')}</button>
        <button onClick={() => { if (window.confirm(t('confirmClear'))) void run({ action: 'clear', confirm: true }) }}>{t('clear')}</button>
      </div>
    </section>
  )
}
