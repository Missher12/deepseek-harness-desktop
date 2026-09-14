/** Open recovery controls that remain available when the Harness plugin graph fails. */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './native-shell.module.css'

/** Fixed preload action; no configuration or package path is supplied by the browser. */
export interface DesktopRecoveryInjected { openCompatibility: () => Promise<void> }
type Props = PropsRuntime<'settings.general.item'> & PropsLocale<'desktop.shell'> & InjectFace<DesktopRecoveryInjected>

/** @param props Localized labels and the native recovery action. @returns A native recovery settings row. */
export function DesktopRecoveryRow({ t, openCompatibility }: Props) {
  const [failed, setFailed] = useState(false)
  return <div className={css.row}>
    <span>{t('recoveryTitle')}</span>
    <Button variant="outline" size="sm" onClick={() => {
      setFailed(false)
      void openCompatibility().catch(() => { setFailed(true) })
    }}>{t('recoveryOpen')}</Button>
    {failed && <span role="alert">{t('recoveryError')}</span>}
  </div>
}
