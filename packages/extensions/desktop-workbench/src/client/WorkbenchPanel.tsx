import { useId, useRef, type KeyboardEvent } from 'react'
import type { UtilityMode } from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  IconApiOutline14, IconChecklistOutline14, IconCloseOutline16,
  IconFolderOpenOutline16, IconGlobeOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { WORKBENCH_MODE_ORDER, type WorkbenchInjected } from './preferences.ts'
import { NS } from './locales.ts'
import css from './WorkbenchPanel.module.css'
import { FilesMode } from './FilesMode.tsx'
import { ReviewMode } from './ReviewMode.tsx'
import { TerminalMode } from './TerminalMode.tsx'
import { BrowserMode } from './BrowserMode.tsx'

export type WorkbenchPanelProps = PropsRuntime<'layout.utility'> & PropsLocale<typeof NS> & InjectFace<WorkbenchInjected>

function ModeIcon({ mode }: { mode: UtilityMode }) {
  if (mode === 'review') return <IconChecklistOutline14 size={16} />
  if (mode === 'terminal') return <IconApiOutline14 size={16} />
  if (mode === 'browser') return <IconGlobeOutline14 size={16} />
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
      const selected = WORKBENCH_MODE_ORDER[targetIndex]
      if (selected !== undefined) selectMode(selected)
      event.preventDefault()
      return
    }
    let nextIndex: number | undefined
    if (event.key === 'ArrowDown') nextIndex = (targetIndex + 1) % WORKBENCH_MODE_ORDER.length
    else if (event.key === 'ArrowUp') nextIndex = (targetIndex - 1 + WORKBENCH_MODE_ORDER.length) % WORKBENCH_MODE_ORDER.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = WORKBENCH_MODE_ORDER.length - 1
    if (nextIndex === undefined) return
    tabs.current[nextIndex]?.focus()
    event.preventDefault()
  }
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
          {WORKBENCH_MODE_ORDER.map((item, index) => (
            <button key={item} ref={(node) => { tabs.current[index] = node }} type="button" role="tab"
              id={tabId(item)} aria-controls={panelId(item)} aria-selected={item === mode}
              tabIndex={item === mode ? 0 : -1} className={css.tab} data-active={item === mode || undefined}
              onClick={() => { selectMode(item) }}>
              <span className={css.tabIcon} aria-hidden="true"><ModeIcon mode={item} /></span>
              <span className={css.tabLabel}>{t(item)}</span>
            </button>
          ))}
        </div>
      </header>
      <div className={css.body} role="tabpanel" id={panelId(mode)} aria-labelledby={tabId(mode)} tabIndex={0}>
        {mode === 'terminal' ? <TerminalMode {...props} />
          : mode === 'browser' ? <BrowserMode {...props} />
            : mode === 'files' ? <FilesMode {...props} />
              : <ReviewMode {...props} />}
      </div>
    </section>
  )
}
