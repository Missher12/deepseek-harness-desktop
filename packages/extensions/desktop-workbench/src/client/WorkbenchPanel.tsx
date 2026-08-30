import { useId, useRef, type KeyboardEvent } from 'react'
import type { UtilityMode } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchInjected } from './preferences.ts'
import { NS } from './locales.ts'
import css from './WorkbenchPanel.module.css'
import { FilesMode } from './FilesMode.tsx'
import { ReviewMode } from './ReviewMode.tsx'
import { TerminalMode } from './TerminalMode.tsx'
import { BrowserMode } from './BrowserMode.tsx'

const MODES: UtilityMode[] = ['terminal', 'browser', 'files', 'review']
export type WorkbenchPanelProps = PropsRuntime<'layout.utility'> & PropsLocale<typeof NS> & InjectFace<WorkbenchInjected>

export function WorkbenchPanel(props: WorkbenchPanelProps) {
  const { mode, close, selectMode, t } = props
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const panelId = `${useId()}-panel`
  const tabId = (item: UtilityMode): string => `${panelId}-${item}-tab`
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') close()
  }
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, item: UtilityMode) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const current = MODES.indexOf(item)
    const offset = event.key === 'ArrowRight' ? 1 : -1
    const next = MODES[(current + offset + MODES.length) % MODES.length] ?? mode
    selectMode(next)
    tabs.current[MODES.indexOf(next)]?.focus()
    event.preventDefault()
  }
  return (
    <section className={css.panel} aria-label={t(mode)} data-desktop-workbench-panel onKeyDown={onKeyDown}>
      <header className={css.header}>
        <div className={css.tabs} role="tablist">
          {MODES.map((item, index) => (
            <button key={item} ref={(node) => { tabs.current[index] = node }} type="button" role="tab"
              id={tabId(item)} aria-controls={panelId} aria-selected={item === mode} tabIndex={item === mode ? 0 : -1}
              className={css.tab} data-active={item === mode || undefined}
              onKeyDown={(event) => { onTabKeyDown(event, item) }}
              onClick={() => { selectMode(item) }}>{t(item)}</button>
          ))}
        </div>
        <button type="button" className={css.close} aria-label={t('close')} onClick={close}>×</button>
      </header>
      <div id={panelId} className={css.body} role="tabpanel" aria-labelledby={tabId(mode)}>
        {mode === 'terminal' ? <TerminalMode {...props} />
          : mode === 'browser' ? <BrowserMode {...props} />
            : mode === 'files' ? <FilesMode {...props} />
              : <ReviewMode {...props} />}
      </div>
    </section>
  )
}
