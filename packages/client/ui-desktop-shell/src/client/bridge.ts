/** Native presentation and fixed-version adapters for official UI commands. */

/** Presentation supplied by the context-isolated preload. */
export interface DesktopPresentation {
  readonly titlebar: 'native' | 'hidden-inset'
}

/** Callbacks to the official workspace service and rendered settings trigger. */
export interface DesktopCommands {
  startSession(): void
  settingsButton(): HTMLButtonElement | null
  searchLabel(): string
}

/**
 * Reserve the native traffic-light strip without importing the official frame's CSS module.
 * @param document - renderer document.
 * @param presentation - validated preload presentation.
 * @returns disposer restoring prior body attributes and removing the owned stylesheet.
 */
export function installPresentation(document: Document, presentation: DesktopPresentation): () => void {
  const body = document.body
  const previousSurface = body.getAttribute('data-dsh-surface')
  const previousTitlebar = body.getAttribute('data-dsh-titlebar')
  body.dataset.dshSurface = 'desktop'
  body.dataset.dshTitlebar = presentation.titlebar
  const style = presentation.titlebar === 'hidden-inset' ? document.createElement('style') : undefined
  if (style) {
    style.dataset.dshNativeShell = ''
    style.textContent = `
body[data-dsh-surface='desktop'][data-dsh-titlebar='hidden-inset'] #root {
  box-sizing: border-box;
  padding-top: 38px;
}
body[data-dsh-surface='desktop'][data-dsh-titlebar='hidden-inset']::before {
  content: '';
  position: fixed;
  inset: 0 0 auto;
  height: 38px;
  z-index: 3;
  background: var(--dsw-specific-sidebar-fill);
  -webkit-app-region: drag;
}`
    document.head.append(style)
  }
  return () => {
    style?.remove()
    if (previousSurface === null) body.removeAttribute('data-dsh-surface')
    else body.setAttribute('data-dsh-surface', previousSurface)
    if (previousTitlebar === null) body.removeAttribute('data-dsh-titlebar')
    else body.setAttribute('data-dsh-titlebar', previousTitlebar)
  }
}

/**
 * Dispatch only the fixed native command vocabulary; search requires exactly one current localized button.
 * @param command - untrusted native command.
 * @param document - renderer document.
 * @param actions - official navigation and mounted trigger callbacks.
 * @returns whether an available official action was invoked.
 */
export function dispatchDesktopCommand(command: unknown, document: Document, actions: DesktopCommands): boolean {
  if (command === 'new-session') {
    actions.startSession()
    return true
  }
  if (command === 'open-settings') {
    const button = actions.settingsButton()
    if (!button?.isConnected || button.disabled) return false
    button.click()
    return true
  }
  if (command === 'open-command-menu') {
    const label = actions.searchLabel()
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
      .filter(button => button.getAttribute('aria-label') === label)
    const [button] = buttons
    if (buttons.length !== 1 || !button || button.disabled) return false
    button.click()
    return true
  }
  return false
}
