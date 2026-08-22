/** Commands the native menu may send to the Harness renderer. */
const DESKTOP_COMMANDS = ['new-session', 'open-command-menu', 'open-settings'] as const

/** One validated native menu command. */
export type DesktopCommand = typeof DESKTOP_COMMANDS[number]

/** Actions exposed only for the closed startup failure surface. */
const RECOVERY_ACTIONS = ['retry', 'open-logs', 'quit'] as const

/** One validated failure recovery action. */
export type RecoveryAction = typeof RECOVERY_ACTIONS[number]

const UPDATE_PHASES = [
  'idle', 'checking', 'current', 'upstream-available', 'desktop-available',
  'downloading', 'verifying', 'ready', 'installing', 'error',
] as const

/** Closed update-state vocabulary emitted by the Electron main process. */
type DesktopUpdatePhase = typeof UPDATE_PHASES[number]

export interface DesktopUpdateSnapshot {
  phase: DesktopUpdatePhase
  runningDesktop: string
  includedHarness: string
  latestOfficialHarness: string | null
  latestDesktop: string | null
  lastCheckedAt: number | null
  downloadProgress: number | null
  message: string | null
}

type DesktopCloseBehavior = 'keep-running' | 'quit'

export interface DesktopPreferencesSnapshot {
  closeBehavior: DesktopCloseBehavior
  tieredPricingEstimates: boolean
}

export type DesktopPreferenceMutation =
  | { key: 'closeBehavior'; value: DesktopCloseBehavior }
  | { key: 'tieredPricingEstimates'; value: boolean }

export function isDesktopPreferencesSnapshot(value: unknown): value is DesktopPreferencesSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return Object.keys(candidate).length === 2
    && (candidate.closeBehavior === 'keep-running' || candidate.closeBehavior === 'quit')
    && typeof candidate.tieredPricingEstimates === 'boolean'
}

export function isDesktopPreferenceMutation(value: unknown): value is DesktopPreferenceMutation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).length !== 2) return false
  return candidate.key === 'closeBehavior'
    ? candidate.value === 'keep-running' || candidate.value === 'quit'
    : candidate.key === 'tieredPricingEstimates' && typeof candidate.value === 'boolean'
}

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

/** Validate an update snapshot before delivering IPC data to page code. */
export function isDesktopUpdateSnapshot(value: unknown): value is DesktopUpdateSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const nullableString = (item: unknown): boolean => item === null || typeof item === 'string'
  const nullableNumber = (item: unknown): boolean => item === null || typeof item === 'number' && Number.isFinite(item)
  return typeof candidate.phase === 'string'
    && (UPDATE_PHASES as readonly string[]).includes(candidate.phase)
    && typeof candidate.runningDesktop === 'string'
    && typeof candidate.includedHarness === 'string'
    && nullableString(candidate.latestOfficialHarness)
    && nullableString(candidate.latestDesktop)
    && nullableNumber(candidate.lastCheckedAt)
    && nullableNumber(candidate.downloadProgress)
    && nullableString(candidate.message)
}

/** Whether this native platform can consume the updater's verified DMG payload. */
export function supportsDesktopUpdates(platform: NodeJS.Platform): boolean {
  return platform === 'darwin'
}

/** Narrow API exposed through context isolation. */
export interface DesktopApi {
  /** Subscribe to validated native menu commands. */
  onCommand(listener: (command: DesktopCommand) => void): () => void
  /** Request one validated recovery action. */
  recover(action: RecoveryAction): void
  /** Read the cached main-process update state. */
  getUpdateStatus?(): Promise<DesktopUpdateSnapshot>
  /** Run a manual fixed-channel update check. */
  checkForUpdates?(): Promise<DesktopUpdateSnapshot>
  /** Download and verify the accepted Desktop release. */
  downloadUpdate?(): Promise<DesktopUpdateSnapshot>
  /** Open the verified native installation payload. */
  installUpdate?(): Promise<{ opened: boolean; message?: string }>
  /** Subscribe to validated update-state transitions. */
  onUpdateStatus?(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void
  showWorkbenchBrowser(bounds: DesktopBrowserBounds): Promise<DesktopBrowserSnapshot>
  hideWorkbenchBrowser(): Promise<void>
  controlWorkbenchBrowser(request: DesktopBrowserRequest): Promise<DesktopBrowserSnapshot>
  onWorkbenchBrowserState(listener: (snapshot: DesktopBrowserSnapshot) => void): () => void
  getDesktopPreferences(): Promise<DesktopPreferencesSnapshot>
  setDesktopPreference(mutation: DesktopPreferenceMutation): Promise<DesktopPreferencesSnapshot>
  onDesktopPreferences(listener: (snapshot: DesktopPreferencesSnapshot) => void): () => void
}

declare global {
  interface Window {
    dshDesktop?: DesktopApi
  }
}
import type { DesktopBrowserBounds, DesktopBrowserRequest, DesktopBrowserSnapshot } from './browser/contracts.ts'
