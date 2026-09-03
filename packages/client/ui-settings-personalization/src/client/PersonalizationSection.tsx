import { useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PersonalizationSection.module.css'

const MAX_BYTES = 48 * 1024

export type PersonalizationStyle = 'default' | 'concise' | 'friendly' | 'professional'

export interface PersonalizationView {
  instructions: string
  style: PersonalizationStyle
  revision: string
  hasExternalContent: boolean
  writable: boolean
}

export interface PersonalizationWrite {
  instructions: string
  style: PersonalizationStyle
  expectedRevision: string
}

export interface PersonalizationSectionInjected {
  load: () => Promise<PersonalizationView>
  save: (input: PersonalizationWrite) => Promise<PersonalizationView>
}

export type PersonalizationSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.personalization'>
  & PersonalizationSectionInjected

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function PersonalizationSection({ t, load, save }: PersonalizationSectionProps) {
  const [saved, setSaved] = useState<PersonalizationView | null>(null)
  const [instructions, setInstructions] = useState('')
  const [style, setStyle] = useState<PersonalizationStyle>('default')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'load-error' | 'save-error'>('loading')

  useEffect(() => {
    let disposed = false
    void load().then((value) => {
      if (disposed) return
      setSaved(value)
      setInstructions(value.instructions)
      setStyle(value.style)
      setPhase('ready')
    }).catch(() => {
      if (!disposed) setPhase('load-error')
    })
    return () => { disposed = true }
  }, [load])

  const used = useMemo(() => bytes(instructions), [instructions])
  const dirty = saved !== null
    && (instructions !== saved.instructions || style !== saved.style)
  const disabled = saved === null || !saved.writable || phase === 'saving'
  const saveDisabled = disabled || !dirty || used > MAX_BYTES

  const submit = (): void => {
    if (saved === null || saveDisabled) return
    setPhase('saving')
    void save({ instructions, style, expectedRevision: saved.revision }).then((value) => {
      setSaved(value)
      setInstructions(value.instructions)
      setStyle(value.style)
      setPhase('saved')
    }).catch(() => { setPhase('save-error') })
  }

  const status = phase === 'loading' ? t('loading')
    : phase === 'load-error' ? t('loadFailed')
      : phase === 'save-error' ? t('saveFailed')
        : phase === 'saved' ? t('saved')
          : ''

  return (
    <section className={css.root} data-personalization-section>
      <header className={css.header}>
        <div><h2>{t('title')}</h2><p>{t('subtitle')}</p></div>
        <Button variant="primary" size="sm" disabled={saveDisabled} onClick={submit}>{t('save')}</Button>
      </header>

      <div className={css.editorBlock}>
        <div className={css.labelRow}>
          <label htmlFor="dsh-personalization-instructions">{t('customTitle')}</label>
          <span>{t('customCount', { used, limit: MAX_BYTES })}</span>
        </div>
        <p>{t('customDescription')}</p>
        <textarea
          id="dsh-personalization-instructions"
          value={instructions}
          disabled={disabled}
          placeholder={t('customPlaceholder')}
          onChange={(event) => { setInstructions(event.target.value); setPhase('ready') }}
        />
        {saved?.hasExternalContent === true && <div className={css.notice}>{t('externalNotice')}</div>}
        {saved?.writable === false && <div className={`${css.notice} ${css.warning}`}>{t('readOnlyNotice')}</div>}
        <div className={css.projectNotice}>{t('projectNotice')}</div>
      </div>

      <div className={css.styleRow}>
        <label htmlFor="dsh-personalization-style">
          <strong>{t('styleTitle')}</strong>
          <span>{t('styleDescription')}</span>
        </label>
        <select
          id="dsh-personalization-style"
          value={style}
          disabled={disabled}
          onChange={(event) => {
            setStyle(event.target.value as PersonalizationStyle)
            setPhase('ready')
          }}
        >
          <option value="default">{t('styleDefault')}</option>
          <option value="concise">{t('styleConcise')}</option>
          <option value="friendly">{t('styleFriendly')}</option>
          <option value="professional">{t('styleProfessional')}</option>
        </select>
      </div>

      <div className={phase.endsWith('error') ? `${css.status} ${css.error}` : css.status} role="status" aria-live="polite">{status}</div>
    </section>
  )
}
