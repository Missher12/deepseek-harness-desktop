import { useRef, type KeyboardEvent } from 'react'
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
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { close(); return }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const current = MODES.indexOf(mode)
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
              aria-selected={item === mode} className={css.tab} data-active={item === mode || undefined}
              onClick={() => { selectMode(item) }}>{t(item)}</button>
          ))}
        </div>
        <button type="button" className={css.close} aria-label={t('close')} onClick={close}>×</button>
      </header>
      <div className={css.body} role="tabpanel">
        {mode === 'terminal' ? <TerminalMode {...props} />
          : mode === 'browser' ? <BrowserMode {...props} />
            : mode === 'files' ? <FilesMode {...props} />
              : <ReviewMode {...props} />}
      </div>
    </section>
  )
}
