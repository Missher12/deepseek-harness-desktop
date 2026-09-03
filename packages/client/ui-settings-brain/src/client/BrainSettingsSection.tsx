import { useEffect, useState } from 'react'
import type { BrainHubSnapshot, BrainProviderSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './BrainSettingsSection.module.css'

export interface BrainSettingsInjected { load: () => Promise<BrainHubSnapshot> }
export type BrainSettingsProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.brain'>
  & BrainSettingsInjected

type Row = {
  id: 'memory' | 'evolution'
  title: string
  description: string
}

function statusKey(status: BrainProviderSnapshot['state'] | undefined): 'ready' | 'disabled' | 'unavailable' {
  return status ?? 'unavailable'
}

export function BrainSettingsSection({ t, load }: BrainSettingsProps) {
  const [snapshot, setSnapshot] = useState<BrainHubSnapshot | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let disposed = false
    void load().then((value) => {
      if (!disposed) { setSnapshot(value); setFailed(false) }
    }).catch(() => { if (!disposed) setFailed(true) })
    return () => { disposed = true }
  }, [load])

  const providers = new Map(snapshot?.providers.map(provider => [provider.id, provider]) ?? [])
  const memory = providers.get('memory')
  const evolution = providers.get('evolution')
  const rows: Row[] = [
    { id: 'memory', title: t('projectMemory'), description: t('projectMemoryDescription') },
    { id: 'evolution', title: t('evolution'), description: t('evolutionDescription') },
  ]

  const badge = (id: Row['id']): string => {
    if (snapshot === null) return '—'
    const provider = id === 'memory' ? memory : evolution
    if (provider?.state !== 'ready') return t(statusKey(provider?.state))
    return id === 'memory' ? t('items', { count: provider.count }) : t('rules', { count: provider.count })
  }

  const limits = snapshot?.limits
  return (
    <section className={css.root} data-brain-settings>
      <header><h2>{t('title')}</h2><p>{t('subtitle')}</p></header>
      <div className={css.sources}>
        {rows.map(row => (
          <div className={css.source} data-brain-source={row.id} key={row.id}>
            <span className={css.mark} aria-hidden="true" />
            <span className={css.copy}><strong>{row.title}</strong><small>{row.description}</small></span>
            <span className={css.badge}>{badge(row.id)}</span>
          </div>
        ))}
      </div>
      <div className={css.details}>
        <div><strong>{t('recallTitle')}</strong><p>{t('recallDescription')}</p>
          <span>{limits === undefined ? '—' : t('limits', {
            items: limits.maxItems, kilobytes: Math.round(limits.maxBytes / 1_000), timeout: limits.timeoutMs,
          })}</span>
        </div>
        <div><strong>{t('consolidationTitle')}</strong><p>{t('consolidationDescription')}</p></div>
      </div>
      {failed && <div className={css.error} role="alert">{t('error')}</div>}
      <footer><span>{t('localOnly')}</span><span>{t('compatibilityNote')}</span></footer>
    </section>
  )
}
