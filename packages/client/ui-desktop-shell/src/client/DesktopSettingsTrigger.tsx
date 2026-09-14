/** Content for the official settings shell's surrounding trigger button. */
import { useEffect, useRef } from 'react'
import { IconSettingsOutline14, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './native-shell.module.css'

/** Bind the host button reached exclusively from this mounted contribution. */
export interface DesktopSettingsInjected {
  bindButton: (button: HTMLButtonElement | null) => void
}

/** Official trigger owner and locale shares plus the native binding callback. */
export type DesktopSettingsTriggerProps = PropsRuntime<'settings.trigger'> & PropsLocale<'desktop.shell'> & InjectFace<DesktopSettingsInjected>

/**
 * Render localized settings content and retain its documented button ancestor while mounted.
 * @param props - official trigger owner, locale, and native ref binding.
 * @returns settings icon and optional wide-sidebar label.
 */
export function DesktopSettingsTrigger({ wide, t, bindButton }: DesktopSettingsTriggerProps) {
  const content = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    bindButton(content.current?.closest('button') ?? null)
    return () => { bindButton(null) }
  }, [bindButton])
  return (
    <span ref={content} className={css.trigger}>
      {wide ? <IconSettingsOutline16 size={16} /> : <IconSettingsOutline14 size={18} />}
      {wide && <span>{t('settings')}</span>}
    </span>
  )
}
