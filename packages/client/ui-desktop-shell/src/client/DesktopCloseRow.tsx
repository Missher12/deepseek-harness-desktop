/** Native close behavior contributed to the official General settings list. */
import { useId } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopPreferences } from './preferences.ts'
import css from './native-shell.module.css'

/** Native close operations and a renderer-bound preference snapshot. */
export interface DesktopCloseInjected {
  hooks: { preference: DesktopPreferences['source'] }
  reload: DesktopPreferences['reload']
  setCloseBehavior: DesktopPreferences['setCloseBehavior']
}

/** Official General item shares plus this registration's native preference face. */
export type DesktopCloseRowProps = PropsRuntime<'settings.general.item'> & PropsLocale<'desktop.shell'> & InjectFace<DesktopCloseInjected>

/**
 * Render the native preference without optimistically changing the native value.
 * @param props - localized copy, native operations, and framework-bound snapshot.
 * @returns close-behavior row with loading and retry states.
 */
export function DesktopCloseRow({ t, usePreference, setCloseBehavior, reload }: DesktopCloseRowProps) {
  const id = useId()
  const state = usePreference(snapshot => snapshot)
  return (
    <div className={css.row}>
      <label htmlFor={id}>{t('closeTitle')}</label>
      <select
        id={id}
        className={css.select}
        value={state.closeBehavior ?? ''}
        disabled={state.closeBehavior === null || state.saving || state.status === 'loading'}
        onChange={(event) => {
          const value = event.currentTarget.value
          if (value === 'keep-running' || value === 'quit') void setCloseBehavior(value)
        }}
      >
        {state.closeBehavior === null && <option value="">{t('loading')}</option>}
        <option value="keep-running">{t('keepRunning')}</option>
        <option value="quit">{t('quit')}</option>
      </select>
      {state.status === 'error' && (
        <div className={css.error}>
          <span role="alert">{t('error')}</span>
          <Button variant="outline" size="sm" disabled={state.saving} onClick={() => { void reload() }}>{t('retry')}</Button>
        </div>
      )}
    </div>
  )
}
