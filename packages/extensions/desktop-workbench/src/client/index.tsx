import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { HeaderButton } from './HeaderButton.tsx'
import { WorkbenchPanel } from './WorkbenchPanel.tsx'
import { WorkbenchController, type WorkbenchInjected } from './preferences.ts'
import { en, NS, zh, type DesktopWorkbenchKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { desktopWorkbench: DesktopWorkbenchKey }
}

export const name = 'desktop-workbench-client'
export const inject = ['layout', 'locale', 'slots']

export function apply(ctx: ClientContext): void {
  const controller = new WorkbenchController(ctx.layout, window.localStorage)
  const injected = (_sessionId: SessionId): WorkbenchInjected => ({
    hooks: { workbench: controller },
    toggle: (id) => { controller.toggle(id) },
    close: () => { controller.close() },
    selectMode: (mode) => { controller.selectMode(mode) },
    setWidth: (width) => { controller.setWidth(width) },
  })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-workbench: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'desktop-workbench', order: 10, locale: NS, inject: injected,
  }, HeaderButton))
  ctx.slots.inject('layout.utility', () => ctx.slots.register({
    name: 'layout.utility', locale: NS, inject: injected,
  }, WorkbenchPanel))
}

export { HeaderButton } from './HeaderButton.tsx'
export { WorkbenchPanel } from './WorkbenchPanel.tsx'
export * from './preferences.ts'
