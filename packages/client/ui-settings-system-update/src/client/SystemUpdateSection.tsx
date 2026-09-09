import { useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconCheckOutline16, IconDownloadOutline16,
  IconRefreshOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopInstallAction, DesktopUpdatePhase, DesktopUpdateSnapshot } from './contracts.ts'
import type { createSystemUpdateStore } from './store.ts'
import type { SystemUpdateLocaleKey } from './locales.ts'
import css from './SystemUpdateSection.module.css'

export interface SystemUpdateInjected {
  retryStatus(): Promise<void>
  check(): Promise<void>
  download(): Promise<void>
  cancelDownload(): Promise<void>
  install(): Promise<void>
}

export type SystemUpdateSectionProps =
  PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createSystemUpdateStore>>
  & PropsLocale<'settings.systemUpdate'>
  & SystemUpdateInjected

type StatusCopy = { titleKey: SystemUpdateLocaleKey; detail: SystemUpdateLocaleKey }

const PHASE_COPY: Record<DesktopUpdatePhase, StatusCopy> = {
  idle: { titleKey: 'idleTitle', detail: 'idle' },
  checking: { titleKey: 'checking', detail: 'checkingDetail' },
  current: { titleKey: 'currentTitle', detail: 'current' },
  'upstream-available': { titleKey: 'upstreamTitle', detail: 'upstream' },
  'desktop-available': { titleKey: 'desktopReadyTitle', detail: 'desktopReady' },
  downloading: { titleKey: 'downloadingTitle', detail: 'downloading' },
  verifying: { titleKey: 'verifying', detail: 'verifyingDetail' },
  ready: { titleKey: 'readyTitle', detail: 'ready' },
  'manual-install-ready': { titleKey: 'manualReadyTitle', detail: 'manualReady' },
  installing: { titleKey: 'installing', detail: 'installingDetail' },
  error: { titleKey: 'errorTitle', detail: 'error' },
}

const SUPPORT_COPY: Record<NonNullable<DesktopUpdateSnapshot['supportReason']>, StatusCopy> = {
  detecting: { titleKey: 'detectingTitle', detail: 'detecting' },
  'unknown-package': { titleKey: 'unknownPackageTitle', detail: 'unknownPackage' },
  'unsupported-runtime': { titleKey: 'unsupportedTitle', detail: 'unsupportedRuntime' },
}

const INSTALL_LABELS: Record<DesktopInstallAction, SystemUpdateLocaleKey> = {
  'protected-replace': 'install',
  'open-setup-wizard': 'openSetup',
  'reveal-package': 'revealPackage',
}

const PACKAGE_COPY: Record<Exclude<DesktopUpdateSnapshot['packageFormat'], 'unknown'>, {
  platform: SystemUpdateLocaleKey
  guidance: SystemUpdateLocaleKey
}> = {
  dmg: { platform: 'platformIntelMac', guidance: 'macInstallGuidance' },
  nsis: { platform: 'platformWindows', guidance: 'windowsSetupGuidance' },
  deb: { platform: 'platformLinuxDeb', guidance: 'linuxDebManual' },
  appimage: { platform: 'platformLinuxAppImage', guidance: 'linuxAppImageManual' },
}

const UNSUPPORTED_PLATFORM_COPY: Record<DesktopUpdateSnapshot['platform'], SystemUpdateLocaleKey> = {
  darwin: 'platformMacUnsupported',
  win32: 'platformWindowsUnsupported',
  linux: 'platformLinuxUnsupported',
  unsupported: 'platformUnsupported',
}

function statusCopy(snapshot: DesktopUpdateSnapshot): StatusCopy {
  if (snapshot.supportReason !== null) return SUPPORT_COPY[snapshot.supportReason]
  if (snapshot.phase === 'ready' && snapshot.installAction !== 'protected-replace') {
    return { titleKey: 'readyTitle', detail: snapshot.installAction === 'open-setup-wizard' ? 'windowsReady' : 'linuxReady' }
  }
  if (snapshot.phase === 'installing' && snapshot.installAction === 'open-setup-wizard') {
    return { titleKey: 'windowsHandoffTitle', detail: 'windowsHandoff' }
  }
  if (snapshot.phase === 'downloading' && snapshot.downloadProgress === null) {
    return { titleKey: 'downloadingTitle', detail: 'downloadingUnknown' }
  }
  return PHASE_COPY[snapshot.phase]
}

export function SystemUpdateSection(props: SystemUpdateSectionProps) {
  const { t, useStore } = props
  const snapshot = useStore(state => state.snapshot)
  const statusLoad = useStore(state => state.statusLoad)
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const run = (operation: () => Promise<void>, cancellation = false): void => {
    const setPending = cancellation ? setCancelling : setBusy
    setRequestError(null)
    setPending(true)
    void operation()
      .catch((error: unknown) => { setRequestError(error instanceof Error ? error.message : t('operationFailed')) })
      .finally(() => { setPending(false) })
  }
  const statusUnavailable = statusLoad !== 'ready'
  const inProgress = !statusUnavailable && ['checking', 'downloading', 'verifying', 'installing'].includes(snapshot.phase)
  const cancellable = !statusUnavailable && (snapshot.phase === 'downloading' || snapshot.phase === 'verifying')
  const supported = snapshot.installAction !== null
  const copy: StatusCopy = statusLoad === 'loading'
    ? { titleKey: 'statusLoading', detail: 'statusLoadingDetail' }
    : statusLoad === 'error'
      ? { titleKey: 'statusLoadFailedTitle', detail: 'statusLoadFailed' }
      : statusCopy(snapshot)
  const failed = statusLoad === 'error' || (!statusUnavailable && (snapshot.phase === 'error' || requestError !== null))
  const ready = snapshot.phase === 'ready' || snapshot.phase === 'manual-install-ready'
  const complete = !statusUnavailable && supported && (snapshot.phase === 'current' || ready)
  const action = statusUnavailable
    ? { label: t(statusLoad === 'loading' ? 'statusLoading' : 'retryStatus'), icon: <IconRefreshOutline16 />, run: () => props.retryStatus() }
    : snapshot.phase === 'desktop-available'
      ? { label: t('download'), icon: <IconDownloadOutline16 />, run: () => props.download() }
      : ready && snapshot.installAction !== null
        ? { label: t(INSTALL_LABELS[snapshot.installAction]), icon: <IconDownloadOutline16 />, run: () => props.install() }
        : { label: inProgress ? t(copy.titleKey) : t('check'), icon: <IconRefreshOutline16 />, run: () => props.check() }
  const actionDisabled = busy || cancelling || statusLoad === 'loading' || (!statusUnavailable && (!supported || inProgress))
  const lastChecked = snapshot.lastCheckedAt === null
    ? t('neverChecked')
    : t('lastChecked').replace('{0}', new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(snapshot.lastCheckedAt))
  const errorDetail = statusUnavailable ? null : requestError ?? snapshot.message
  const desktopAvailable = ['desktop-available', 'downloading', 'verifying', 'ready', 'manual-install-ready', 'installing'].includes(snapshot.phase)
  const progress = snapshot.downloadProgress === null ? undefined : Math.round(snapshot.downloadProgress * 100)
  const packageCopy = snapshot.packageFormat === 'unknown' ? null : PACKAGE_COPY[snapshot.packageFormat]
  const platformKey = packageCopy?.platform ?? (statusUnavailable ? 'platformUnconfirmed'
    : snapshot.supportReason === 'unsupported-runtime' ? UNSUPPORTED_PLATFORM_COPY[snapshot.platform] : 'platformLinuxUnknown')
  const byteCount = snapshot.downloadedBytes === null || snapshot.downloadTotalBytes === null ? null
    : t('downloadBytes')
      .replace('{0}', new Intl.NumberFormat().format(snapshot.downloadedBytes))
      .replace('{1}', new Intl.NumberFormat().format(snapshot.downloadTotalBytes))
  const detail = progress === undefined ? t(copy.detail) : t(copy.detail).replace('{0}', String(progress))
  return (
    <section className={css.root} data-system-update-section>
      <header className={css.header}>
        <h2>{t('title')}</h2>
        <p>{t('subtitle')}</p>
      </header>
      <div className={clsx(css.statusCard, failed && css.error, complete && !failed && css.complete)} aria-busy={statusLoad === 'loading' || inProgress || busy || snapshot.supportReason === 'detecting'}>
        <div className={css.statusMain}>
          <span className={clsx(css.statusIcon, inProgress && css.spinning)} aria-hidden="true">
            {failed ? <IconWarningOutline16 size={24} /> : complete ? <IconCheckOutline16 size={24} /> : <IconRefreshOutline16 size={24} />}
          </span>
          <div className={css.statusCopy} role={failed ? 'alert' : 'status'}>
            <h3>{t(!statusUnavailable && failed ? 'errorTitle' : copy.titleKey)}</h3>
            <p>{!statusUnavailable && requestError !== null ? t('operationFailed') : detail}</p>
          </div>
        </div>
        {cancellable && (
          <progress
            className={css.progress}
            max={100}
            value={snapshot.phase === 'downloading' ? progress : undefined}
            aria-label={t(snapshot.phase === 'downloading' ? 'downloadProgress' : 'verifying')}
          />
        )}
        {(snapshot.assetName !== null || byteCount !== null) && (
          <div className={css.downloadFacts}>
            {snapshot.assetName !== null && <p>{snapshot.assetName}</p>}
            {byteCount !== null && <p>{byteCount}</p>}
          </div>
        )}
        {failed && errorDetail !== null && (
          <details className={css.errorDetail}><summary>{t('errorDetails')}</summary><p>{errorDetail}</p></details>
        )}
        <div className={css.statusActions}>
          <span>{lastChecked}</span>
          <Button variant="primary" size="sm" icon={action.icon} disabled={actionDisabled} onClick={() => { run(action.run) }}>{action.label}</Button>
          {cancellable && <Button size="sm" disabled={cancelling} onClick={() => { run(() => props.cancelDownload(), true) }}>{t('cancelDownload')}</Button>}
        </div>
      </div>
      {packageCopy !== null && (
        <div className={css.guidance}>
          <p>{t(packageCopy.guidance)}</p>
          {snapshot.packageFormat === 'appimage' && <p>{t('linuxAppImagePathPolicy')}</p>}
        </div>
      )}
      <div className={css.versions}>
        <h3>{t('installedVersions')}</h3>
        <div className={css.rows}>
          <div className={css.row} data-update-version="desktop">
            <div className={css.product}><strong>{t('desktop')}</strong><small>{t(platformKey)}</small></div>
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
