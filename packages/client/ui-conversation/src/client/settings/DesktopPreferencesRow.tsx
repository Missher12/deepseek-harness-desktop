/** Desktop-only close behavior and price-estimate preferences. */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import css from './DesktopPreferencesRow.module.css'

type CloseBehavior = 'keep-running' | 'quit'
interface Snapshot { closeBehavior: CloseBehavior; tieredPricingEstimates: boolean }
interface Bridge {
  getDesktopPreferences(): Promise<Snapshot>
  setDesktopPreference(mutation:
    | { key: 'closeBehavior'; value: CloseBehavior }
    | { key: 'tieredPricingEstimates'; value: boolean }): Promise<Snapshot>
  onDesktopPreferences(listener: (snapshot: Snapshot) => void): () => void
}

export function desktopPreferencesBridge(): Bridge | undefined {
  const candidate = (window as unknown as { dshDesktop?: Partial<Bridge> }).dshDesktop
  return typeof candidate?.getDesktopPreferences === 'function'
    && typeof candidate.setDesktopPreference === 'function'
    && typeof candidate.onDesktopPreferences === 'function'
    ? candidate as Bridge
    : undefined
}

type Props = PropsRuntime<'settings.general.item'> & PropsLocale<'conversation'>

const OPTIONS: readonly { id: CloseBehavior; label: ConversationKey }[] = [
  { id: 'keep-running', label: 'settings.desktop.close.keepRunning' },
  { id: 'quit', label: 'settings.desktop.close.quit' },
]

export function DesktopPreferencesRow({ t }: Props) {
  const bridge = desktopPreferencesBridge()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (bridge === undefined) return
    let disposed = false
    void bridge.getDesktopPreferences().then((value) => { if (!disposed) setSnapshot(value) })
    const unsubscribe = bridge.onDesktopPreferences((value) => { if (!disposed) setSnapshot(value) })
    return () => { disposed = true; unsubscribe() }
  }, [bridge])
  if (bridge === undefined || snapshot === null) return null
  const closeLabel = snapshot.closeBehavior === 'keep-running'
    ? 'settings.desktop.close.keepRunning'
    : 'settings.desktop.close.quit'
  return (
    <div className={css.group}>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('settings.desktop.close.title')}</div>
          <div className={css.desc}>{t('settings.desktop.close.description')}</div>
        </div>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
          selectedId={snapshot.closeBehavior}
          onSelect={(id) => {
            setOpen(false)
            void bridge.setDesktopPreference({ key: 'closeBehavior', value: id as CloseBehavior })
              .then(setSnapshot)
          }}
          align="end"
          portal
          anchor={<button type="button" className={css.selector} onClick={() => { setOpen(value => !value) }}>
            {t(closeLabel)}<IconChevronDownOutline14 />
          </button>}
        />
      </div>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('settings.desktop.pricing.title')}</div>
          <div className={css.desc}>{t('settings.desktop.pricing.description')}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={snapshot.tieredPricingEstimates}
          className={`${css.switch} ${snapshot.tieredPricingEstimates ? css.switchOn : ''}`}
          onClick={() => {
            void bridge.setDesktopPreference({
              key: 'tieredPricingEstimates', value: !snapshot.tieredPricingEstimates,
            }).then(setSnapshot)
          }}
        ><span /></button>
      </div>
    </div>
  )
}
