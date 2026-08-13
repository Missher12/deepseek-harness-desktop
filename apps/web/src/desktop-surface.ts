const DESKTOP_COMMANDS = ['new-session', 'open-command-menu', 'open-settings'] as const

type DesktopCommand = typeof DESKTOP_COMMANDS[number]

interface DesktopBridge {
  onCommand(listener: (command: unknown) => void): () => void
}

function isDesktopCommand(value: unknown): value is DesktopCommand {
  return typeof value === 'string' && (DESKTOP_COMMANDS as readonly string[]).includes(value)
}

/**
 * Opt the web shell into native-window presentation and bridge menu commands.
 * The ordinary browser surface remains byte-for-byte inactive without the
 * explicit query marker added by the desktop host.
 * @param url - Current renderer URL.
 * @param bridge - Optional context-isolated preload API.
 * @returns Cleanup for navigation or test teardown.
 */
export function installDesktopSurface(url: URL, bridge?: DesktopBridge): () => void {
  if (url.searchParams.get('surface') !== 'desktop') return () => undefined

  document.body.dataset.dshSurface = 'desktop'
  const unsubscribe = bridge?.onCommand((command) => {
    if (!isDesktopCommand(command)) return
    document.querySelector<HTMLButtonElement>(`[data-dsh-desktop-command="${command}"]`)?.click()
  })

  return () => {
    unsubscribe?.()
    delete document.body.dataset.dshSurface
  }
}
