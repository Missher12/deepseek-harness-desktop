import { useId, useRef, type KeyboardEvent } from 'react'
import type { UtilityMode } from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  IconApiOutline14, IconChecklistOutline14, IconCloseOutline16, IconCordisPluginOutline14,
  IconFolderOpenOutline16, IconGlobeOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { workbenchModeDefinitions } from './modes.ts'
import type { WorkbenchInjected } from './preferences.ts'
import { NS } from './locales.ts'
import css from './WorkbenchPanel.module.css'

export type WorkbenchPanelProps = PropsRuntime<'layout.utility'> & PropsLocale<typeof NS> & InjectFace<WorkbenchInjected>

function ModeIcon({ mode }: { mode: UtilityMode }) {
  if (mode === 'review') return <IconChecklistOutline14 size={16} />
  if (mode === 'terminal') return <IconApiOutline14 size={16} />
  if (mode === 'browser') return <IconGlobeOutline14 size={16} />
  if (mode === 'browserSkill') return <IconCordisPluginOutline14 size={16} />
  return <IconFolderOpenOutline16 size={16} />
}

export function WorkbenchPanel(props: WorkbenchPanelProps) {
  const { mode, close, selectMode, t } = props
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const identity = useId()
  const tabId = (item: UtilityMode) => `${identity}-${item}-tab`
  const panelId = (item: UtilityMode) => `${identity}-${item}-panel`
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const targetIndex = tabs.current.findIndex(tab => tab === event.target)
    if (targetIndex === -1) return
    if (event.key === 'Enter' || event.key === ' ') {
      const selected = workbenchModeDefinitions[targetIndex]
      if (selected !== undefined) selectMode(selected.id)
      event.preventDefault()
      return
    }
    let nextIndex: number | undefined
    if (event.key === 'ArrowDown') nextIndex = (targetIndex + 1) % workbenchModeDefinitions.length
    else if (event.key === 'ArrowUp') nextIndex = (targetIndex - 1 + workbenchModeDefinitions.length) % workbenchModeDefinitions.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = workbenchModeDefinitions.length - 1
    if (nextIndex === undefined) return
    tabs.current[nextIndex]?.focus()
    event.preventDefault()
  }
  const selectedDefinition = workbenchModeDefinitions.find(definition => definition.id === mode)
    ?? workbenchModeDefinitions[0]
  if (selectedDefinition === undefined) return null
  return (
    <section className={css.panel} aria-label={t('workbench')} data-desktop-workbench-panel
      onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
      <header className={css.launcher}>
        <div className={css.launcherTop}>
          <strong className={css.launcherTitle}>{t('workbench')}</strong>
          <button type="button" className={css.close} aria-label={t('close')} onClick={close}>
            <IconCloseOutline16 size={14} />
          </button>
        </div>
        <div className={css.tabs} role="tablist" aria-label={t('modes')} aria-orientation="vertical"
          onKeyDown={onTabsKeyDown}>
          {workbenchModeDefinitions.map((definition, index) => (
            <button key={definition.id} ref={(node) => { tabs.current[index] = node }} type="button" role="tab"
              id={tabId(definition.id)} aria-controls={panelId(definition.id)} aria-selected={definition.id === mode}
              tabIndex={definition.id === mode ? 0 : -1} className={css.tab} data-active={definition.id === mode || undefined}
              onClick={() => { selectMode(definition.id) }}>
              <span className={css.tabIcon} aria-hidden="true"><ModeIcon mode={definition.id} /></span>
              <span className={css.tabLabel}>{t(definition.id)}</span>
            </button>
          ))}
        </div>
      </header>
      <div className={css.body} role="tabpanel" id={panelId(selectedDefinition.id)} aria-labelledby={tabId(selectedDefinition.id)} tabIndex={0}>
        <selectedDefinition.Component {...props} />
      </div>
    </section>
  )
}
