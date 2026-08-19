/** Harness Client plugin: cross-session relays are ordinary chat content. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionMessengerKey } from './locales.ts'

export { MessengerStatus } from './MessengerStatus.tsx'
export type { MessengerStatusInjected, MessengerStatusProps } from './MessengerStatus.tsx'
export { MessengerDrawer } from './MessengerDrawer.tsx'
export type { MessengerDrawerProps } from './MessengerDrawer.tsx'
export { MessengerHeaderButton } from './MessengerHeaderButton.tsx'
export type { MessengerHeaderButtonProps } from './MessengerHeaderButton.tsx'
export * from './MessengerUiController.ts'
export * from './store.ts'
export { en, NS, zh } from './locales.ts'
export type { SessionMessengerKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy owned by the removable session messenger Client plugin. */
    sessionMessenger: SessionMessengerKey
  }
}

/** Cordis Client plugin name. */
export const name = 'session-messenger-client'
/** The standard global session hook is renderer-supplied; only locale and slots are injected. */
export const inject = ['locale', 'slots']

/**
 * No client-side notification surface: cross-session relay messages are
 * ordinary user/message records and render as chat cards in the conversation
 * timeline (`ui-conversation`), so the plugin mounts nothing in the browser.
 */
export function apply(_ctx: ClientContext): void {}
