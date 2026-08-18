/** Commands the native menu may send to the Harness renderer. */
const DESKTOP_COMMANDS = ['new-session', 'open-command-menu', 'open-settings'] as const

/** One validated native menu command. */
export type DesktopCommand = typeof DESKTOP_COMMANDS[number]

/** Actions exposed only for the closed startup failure surface. */
const RECOVERY_ACTIONS = ['retry', 'open-logs', 'quit'] as const

/** One validated failure recovery action. */
export type RecoveryAction = typeof RECOVERY_ACTIONS[number]

/**
 * Check an IPC payload against the desktop command vocabulary.
 * @param value - Untrusted IPC payload.
 * @returns Whether the payload is a desktop command.
 */
export function isDesktopCommand(value: unknown): value is DesktopCommand {
  return typeof value === 'string' && (DESKTOP_COMMANDS as readonly string[]).includes(value)
}

/**
 * Check a renderer value against the recovery action vocabulary.
 * @param value - Untrusted renderer value.
 * @returns Whether the value is a recovery action.
 */
export function isRecoveryAction(value: unknown): value is RecoveryAction {
  return typeof value === 'string' && (RECOVERY_ACTIONS as readonly string[]).includes(value)
}

/** Narrow API exposed through context isolation. */
export interface DesktopApi {
  /** Subscribe to validated native menu commands. */
  onCommand(listener: (command: DesktopCommand) => void): () => void
  /** Request one validated recovery action. */
  recover(action: RecoveryAction): void
}

declare global {
  interface Window {
    dshDesktop?: DesktopApi
  }
}
