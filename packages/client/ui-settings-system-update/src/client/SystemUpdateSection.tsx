import { useState } from 'react'
import { Button, IconDownloadOutline16, IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopUpdateSnapshot } from './contracts.ts'
import type { createSystemUpdateStore } from './store.ts'
import css from './SystemUpdateSection.module.css'

export interface SystemUpdateInjected {
  check(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
}

export type SystemUpdateSectionProps =
  PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createSystemUpdateStore>>
  & PropsLocale<'settings.systemUpdate'>
  & SystemUpdateInjected

function statusText(snapshot: DesktopUpdateSnapshot, t: SystemUpdateSectionProps['t']): string {
  if (snapshot.phase === 'checking') return t('checking')
  if (snapshot.phase === 'upstream-available') return t('upstream')
  if (snapshot.phase === 'desktop-available') return t('desktopReady')
  if (snapshot.phase === 'downloading') return t('downloading').replace('{0}', String(Math.round((snapshot.downloadProgress ?? 0) * 100)))
  if (snapshot.phase === 'verifying') return t('verifying')
  if (snapshot.phase === 'ready') return t('ready')
  if (snapshot.phase === 'installing') return t('installing')
  if (snapshot.phase === 'error') return snapshot.message ?? '—'
  return t('current')
}

export function SystemUpdateSection(props: SystemUpdateSectionProps) {
  const { t, useStore } = props
  const snapshot = useStore(state => state.snapshot)
  const [busy, setBusy] = useState(false)
  const run = (operation: () => Promise<void>): void => {
    setBusy(true)
    void operation()
      .catch(() => undefined)
      .finally(() => { setBusy(false) })
  }
  const action = snapshot.phase === 'desktop-available'
    ? { label: t('download'), icon: <IconDownloadOutline16 />, run: () => props.download() }
    : snapshot.phase === 'ready'
      ? { label: t('install'), icon: <IconDownloadOutline16 />, run: () => props.install() }
      : { label: t('check'), icon: <IconRefreshOutline14 />, run: () => props.check() }
  const disabled = busy || ['checking', 'downloading', 'verifying', 'installing'].includes(snapshot.phase)
  const lastChecked = snapshot.lastCheckedAt === null
    ? t('neverChecked')
    : t('lastChecked').replace('{0}', new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(snapshot.lastCheckedAt))
  return (
    <section className={css.root} data-system-update-section>
      <header className={css.header}>
        <div><h2>{t('title')}</h2><p>{t('subtitle')}</p></div>
        <Button variant="primary" size="sm" icon={action.icon} disabled={disabled} onClick={() => { run(action.run) }}>{action.label}</Button>
      </header>
      <div className={css.rows} aria-busy={snapshot.phase === 'checking'}>
        <div className={css.row}>
          <span><strong>{t('desktop')}</strong><small>{t('platformIntelMac')}</small></span>
          <span className={css.version}>{t('runningDesktopVersion').replace('{0}', snapshot.runningDesktop)}</span>
        </div>
        <div className={css.row}>
          <span><strong>{t('core')}</strong><small>{t('included').replace('{0}', snapshot.includedHarness)}</small></span>
          <span className={css.version}>{snapshot.latestOfficialHarness === null ? '—' : t('latest').replace('{0}', snapshot.latestOfficialHarness)}</span>
        </div>
      </div>
      {(snapshot.phase === 'downloading' || snapshot.phase === 'verifying') && (
        <div className={css.progress}><i style={{ width: `${Math.round((snapshot.downloadProgress ?? 0) * 100)}%` }} /></div>
      )}
      <div className={snapshot.phase === 'error' ? `${css.status} ${css.error}` : css.status}>{statusText(snapshot, t)}</div>
      <footer><span>{lastChecked}</span><a href="https://github.com/deepseek-ai/deepseek-harness/releases" target="_blank" rel="noreferrer">{t('officialRelease')}</a></footer>
    </section>
  )
}
