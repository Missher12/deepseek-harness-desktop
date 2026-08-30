import { useEffect } from 'react'
import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchInjected } from './preferences.ts'
import { NS } from './locales.ts'
import css from './WorkbenchPanel.module.css'

export type HeaderButtonProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<typeof NS> & InjectFace<WorkbenchInjected>

function desktopDockApi(): {
  onWorkbenchBrowserDockRequest?(listener: () => void): () => void
  notifyVisibleSessionChanged?(): Promise<void>
} | undefined {
  return (window as unknown as {
    dshDesktop?: {
      onWorkbenchBrowserDockRequest?(listener: () => void): () => void
      notifyVisibleSessionChanged?(): Promise<void>
    }
  }).dshDesktop
}

export function HeaderButton({ sessionId, useWorkbench, toggle, open, t }: HeaderButtonProps) {
  const expanded = useWorkbench(state => state.open && state.sessionId === sessionId)
  useEffect(() => {
    // The no-argument bridge can revoke stale authority but cannot claim or name this Session.
    void desktopDockApi()?.notifyVisibleSessionChanged?.().catch(() => undefined)
  }, [sessionId])
  useEffect(() => desktopDockApi()?.onWorkbenchBrowserDockRequest?.(() => {
    open(sessionId, 'browser')
  }), [open, sessionId])
  return (
    <button type="button" className={css.trigger} aria-label={expanded ? t('close') : t('open')} aria-expanded={expanded}
      onClick={() => { toggle(sessionId) }}>
      <IconPanelLeftOutline16 size={14} />
    </button>
  )
}
