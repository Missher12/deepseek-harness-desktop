import { useEffect, useState } from 'react'
import { IconCordisPluginOutline14, IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserSkillHealth, BrowserSkillStatus } from '../protocol.ts'
import { workbenchTransport } from './transport.ts'
import { NS, type DesktopWorkbenchKey } from './locales.ts'
import css from './BrowserSkillMode.module.css'

type Props = PropsRuntime<'layout.utility'> & PropsLocale<typeof NS>

/** Only official HTTPS destinations are reachable from this page. */
export const BROWSER_SKILL_OFFICIAL_URL = 'https://github.com/Tencent/BrowserSkill#readme'
export const OPEN_DESIGN_OFFICIAL_URL = 'https://github.com/nexu-io/open-design/blob/main/docs/i18n/README.zh-CN.md'

type OpenDesignState = 'loading' | 'installed' | 'missing' | 'unavailable'
interface DesktopIntegrationsApi {
  getDesktopIntegrations(): Promise<{ openDesign: { state: 'installed' | 'missing'; profile: 'open-design' } }>
}

function desktopIntegrationsApi(): DesktopIntegrationsApi | undefined {
  return (window as unknown as { dshDesktop?: DesktopIntegrationsApi }).dshDesktop
}

/** Locale-owned status labels, exhaustively keyed by the Host health state. */
const STATE_LABEL_KEYS = {
  'bundled-ready': 'browserSkillBundled',
  missing: 'browserSkillMissing',
  incompatible: 'browserSkillIncompatible',
  unhealthy: 'browserSkillUnhealthy',
} as const satisfies Record<BrowserSkillHealth, DesktopWorkbenchKey>

/**
 * Explicit-only BrowserSkill status page. The probe runs when the user
 * presses the check button — never on mount and never on a timer — so a
 * dormant installation stays cold. The only actions are the check and the
 * official HTTPS install page.
 */
export function BrowserSkillMode({ sessionId, t }: Props) {
  const [status, setStatus] = useState<BrowserSkillStatus>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [openDesign, setOpenDesign] = useState<OpenDesignState>('loading')

  useEffect(() => {
    let live = true
    const api = desktopIntegrationsApi()
    if (api === undefined) {
      setOpenDesign('unavailable')
      return () => { live = false }
    }
    void api.getDesktopIntegrations().then((snapshot) => {
      if (live) setOpenDesign(snapshot.openDesign.state)
    }).catch(() => {
      if (live) setOpenDesign('unavailable')
    })
    return () => { live = false }
  }, [])

  const refresh = async () => {
    setBusy(true)
    setError(undefined)
    try {
      setStatus(await workbenchTransport.browserSkillStatus(sessionId))
    } catch (reason: unknown) {
      setStatus(undefined)
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const openDesignCopy = openDesign === 'installed'
    ? t('openDesignInstalled')
    : openDesign === 'missing'
      ? t('openDesignMissing')
      : openDesign === 'loading' ? t('openDesignLoading') : t('openDesignFailed')

  return <div className={css.page}>
    <header className={css.pageHeader}><strong>{t('browserSkill')}</strong></header>
    <div className={css.cards}>
      <article className={css.card} data-plugin-card="browser-skill">
        <header className={css.header}>
          <span className={css.identity}>
            <span className={css.icon} aria-hidden="true"><IconGlobeOutline14 size={16} /></span>
            <strong className={css.title}>{t('browserSkillTitle')}</strong>
          </span>
          <button type="button" className={css.check} disabled={busy} onClick={() => { void refresh() }}>
            {busy ? t('browserSkillChecking') : t('browserSkillCheck')}
          </button>
        </header>
        <div className={css.body}>
          {status === undefined
            ? <p className={css.idle} data-browser-skill-idle>
              {error === undefined ? t('browserSkillIdle') : t('browserSkillFailed', { message: error })}
            </p>
            : <dl className={css.facts}>
              <div className={css.fact}>
                <dt>{t('browserSkillTitle')}</dt>
                <dd data-browser-skill-state={status.state}>{t(STATE_LABEL_KEYS[status.state])}</dd>
              </div>
              {status.cliVersion !== undefined && <div className={css.fact}>
                <dt>{t('browserSkillCliFact')}</dt>
                <dd>{t('browserSkillVersion', { version: status.cliVersion })}</dd>
              </div>}
              <div className={css.fact}>
                <dt>{t('browser')}</dt>
                <dd data-browser-skill-extension={status.extension}>
                  {status.extension === 'connected' ? t('browserSkillExtensionConnected') : t('browserSkillExtensionNotConnected')}
                </dd>
              </div>
              <div className={css.fact}>
                <dt>{t('browserSkillSessionFact')}</dt>
                <dd>{t('browserSkillSessions', { owned: String(status.ownedSessions), borrowed: String(status.borrowedSessions) })}</dd>
              </div>
            </dl>}
          <p className={css.hint}>
            <a href={BROWSER_SKILL_OFFICIAL_URL} target="_blank" rel="noopener noreferrer" data-browser-skill-official>
              {t('browserSkillInstallExtension')}
            </a>
          </p>
        </div>
      </article>
      <article className={css.card} data-plugin-card="open-design">
        <header className={css.header}>
          <span className={css.identity}>
            <span className={css.icon} aria-hidden="true"><IconCordisPluginOutline14 size={16} /></span>
            <strong className={css.title}>{t('openDesignTitle')}</strong>
          </span>
          <span className={css.state} data-open-design-state={openDesign}>{openDesignCopy}</span>
        </header>
        <p className={css.hint}>
          <a href={OPEN_DESIGN_OFFICIAL_URL} target="_blank" rel="noopener noreferrer" data-open-design-official>
            {t('openDesignOfficial')}
          </a>
        </p>
      </article>
    </div>
  </div>
}
