import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchInjected } from './preferences.ts'
import { NS } from './locales.ts'
import css from './WorkbenchPanel.module.css'

export type HeaderButtonProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<typeof NS> & InjectFace<WorkbenchInjected>

export function HeaderButton({ sessionId, useWorkbench, toggle, t }: HeaderButtonProps) {
  const open = useWorkbench(state => state.open && state.sessionId === sessionId)
  return (
    <button type="button" className={css.trigger} aria-label={open ? t('close') : t('open')} aria-expanded={open}
      onClick={() => { toggle(sessionId) }}>
      <IconPanelLeftOutline16 size={14} />
    </button>
  )
}
