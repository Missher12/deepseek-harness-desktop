import { useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconCheckOutline16, IconDownloadOutline16,
  IconRefreshOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopUpdatePhase, DesktopUpdateSnapshot } from './contracts.ts'
import type { createSystemUpdateStore } from './store.ts'
import type { SystemUpdateLocaleKey } from './locales.ts'
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

const PHASE_COPY: Record<DesktopUpdatePhase, { titleKey: SystemUpdateLocaleKey; detail: SystemUpdateLocaleKey }> = {
  idle: { titleKey: 'idleTitle', detail: 'idle' },
  checking: { titleKey: 'checking', detail: 'checkingDetail' },
  current: { titleKey: 'currentTitle', detail: 'current' },
  'upstream-available': { titleKey: 'upstreamTitle', detail: 'upstream' },
  'desktop-available': { titleKey: 'desktopReadyTitle', detail: 'desktopReady' },
  downloading: { titleKey: 'downloadingTitle', detail: 'downloading' },
  verifying: { titleKey: 'verifying', detail: 'verifyingDetail' },
  ready: { titleKey: 'readyTitle', detail: 'ready' },
  installing: { titleKey: 'installing', detail: 'installingDetail' },
  error: { titleKey: 'errorTitle', detail: 'error' },
}

function statusText(snapshot: DesktopUpdateSnapshot, t: SystemUpdateSectionProps['t']): string {
  return t(PHASE_COPY[snapshot.phase].detail)
    .replace('{0}', String(Math.round((snapshot.downloadProgress ?? 0) * 100)))
}

export function SystemUpdateSection(props: SystemUpdateSectionProps) {
  const { t, useStore } = props
  const snapshot = useStore(state => state.snapshot)
  const [busy, setBusy] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const run = (operation: () => Promise<void>): void => {
    setRequestError(null)
    setBusy(true)
    void operation()
      .catch((error: unknown) => { setRequestError(error instanceof Error ? error.message : t('operationFailed')) })
      .finally(() => { setBusy(false) })
  }
  const inProgress = ['checking', 'downloading', 'verifying', 'installing'].includes(snapshot.phase)
  const failed = snapshot.phase === 'error' || requestError !== null
  const complete = snapshot.phase === 'current' || snapshot.phase === 'ready'
  const action = snapshot.phase === 'desktop-available'
    ? { label: t('download'), icon: <IconDownloadOutline16 />, run: () => props.download() }
    : snapshot.phase === 'ready'
      ? { label: t('install'), icon: <IconDownloadOutline16 />, run: () => props.install() }
      : { label: inProgress ? t(PHASE_COPY[snapshot.phase].titleKey) : t('check'), icon: <IconRefreshOutline16 />, run: () => props.check() }
  const lastChecked = snapshot.lastCheckedAt === null
    ? t('neverChecked')
    : t('lastChecked').replace('{0}', new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(snapshot.lastCheckedAt))
  const errorDetail = requestError ?? snapshot.message
  const desktopAvailable = ['desktop-available', 'downloading', 'verifying', 'ready', 'installing'].includes(snapshot.phase)
  const progress = Math.round((snapshot.downloadProgress ?? 0) * 100)
  return (
    <section className={css.root} data-system-update-section>
      <header className={css.header}>
        <h2>{t('title')}</h2>
        <p>{t('subtitle')}</p>
      </header>
      <div className={clsx(css.statusCard, failed && css.error, complete && !failed && css.complete)} aria-busy={inProgress || busy}>
        <div className={css.statusMain}>
          <span className={clsx(css.statusIcon, inProgress && css.spinning)} aria-hidden="true">
            {failed ? <IconWarningOutline16 size={24} /> : complete ? <IconCheckOutline16 size={24} /> : <IconRefreshOutline16 size={24} />}
          </span>
          <div className={css.statusCopy} role={failed ? 'alert' : 'status'}>
            <h3>{t(failed ? 'errorTitle' : PHASE_COPY[snapshot.phase].titleKey)}</h3>
            <p>{requestError !== null ? t('operationFailed') : statusText(snapshot, t)}</p>
          </div>
        </div>
        {(snapshot.phase === 'downloading' || snapshot.phase === 'verifying') && (
          <progress
            className={css.progress}
            max={100}
            value={snapshot.phase === 'downloading' ? progress : undefined}
            aria-label={t(snapshot.phase === 'downloading' ? 'downloadProgress' : 'verifying')}
          />
        )}
        {failed && errorDetail !== null && (
          <details className={css.errorDetail}><summary>{t('errorDetails')}</summary><p>{errorDetail}</p></details>
        )}
        <div className={css.statusActions}>
          <span>{lastChecked}</span>
          <Button variant="primary" size="sm" icon={action.icon} disabled={busy || inProgress} onClick={() => { run(action.run) }}>{action.label}</Button>
        </div>
      </div>
      <div className={css.versions}>
        <h3>{t('installedVersions')}</h3>
        <div className={css.rows}>
          <div className={css.row} data-update-version="desktop">
            <div className={css.product}><strong>{t('desktop')}</strong><small>{t('platformIntelMac')}</small></div>
            <div className={css.versionGroup}>
              <span className={css.version}>{t('runningDesktopVersion').replace('{0}', snapshot.runningDesktop)}</span>
              {desktopAvailable && snapshot.latestDesktop !== null && <small className={css.available}>{t('availableVersion').replace('{0}', snapshot.latestDesktop)}</small>}
            </div>
          </div>
          <div className={css.row} data-update-version="core">
            <div className={css.product}>
              <strong>{t('core')}</strong>
              <small>{snapshot.latestOfficialHarness === null ? t('officialNotChecked') : t('latest').replace('{0}', snapshot.latestOfficialHarness)}</small>
            </div>
            <div className={css.versionGroup}>
              <span className={css.version}>{t('runningDesktopVersion').replace('{0}', snapshot.includedHarness)}</span>
              {snapshot.includedHarness.includes('-') && <span className={css.badge}>{t('prerelease')}</span>}
            </div>
          </div>
        </div>
        <p className={css.updateNote}>{t('includedNote')}</p>
      </div>
      <footer className={css.footer}>
        <a href="https://github.com/Missher12/deepseek-harness-desktop/releases" target="_blank" rel="noreferrer">{t('desktopRelease')}<span aria-hidden="true"> ↗</span></a>
        <a href="https://github.com/deepseek-ai/deepseek-harness/releases" target="_blank" rel="noreferrer">{t('officialRelease')}<span aria-hidden="true"> ↗</span></a>
      </footer>
    </section>
  )
}
