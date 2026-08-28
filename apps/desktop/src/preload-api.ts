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

export interface BrowserTakeoverStatus {
  readonly phase: 'human' | 'given' | 'agent' | 'stopping'
  readonly signedInWarning: true
}

export type DesktopControlPermissionState = 'granted' | 'denied' | 'unknown'

/** Renderer-visible status only; deliberately excludes sessions, leases, refs, and coordinates. */
export interface DesktopControlUiSnapshot {
  readonly supported: boolean
  readonly browserEnabled: boolean
  readonly computerEnabled: boolean
  readonly permissions: {
    readonly screenViewing: DesktopControlPermissionState
    readonly assistiveControl: DesktopControlPermissionState
  }
  readonly ordinaryApps: readonly {
    readonly appId: string
    readonly name: string
    readonly allowed: boolean
  }[]
  readonly emergencyAccelerator: string
  readonly active: null | {
    readonly agentName: string
    readonly appName: string
    readonly action: string
  }
  readonly stopping: boolean
}

/** Non-authoritative renderer intent; main validates and owns every resulting setting. */
export type DesktopControlUiMutation =
  | { readonly kind: 'set-browser-enabled'; readonly enabled: boolean }
  | { readonly kind: 'set-computer-enabled'; readonly enabled: boolean }
  | { readonly kind: 'set-app-allowed'; readonly appId: string; readonly allowed: boolean }
  | { readonly kind: 'set-emergency-accelerator'; readonly accelerator: string }

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

export function isDesktopControlUiSnapshot(value: unknown): value is DesktopControlUiSnapshot {
  if (!plainRecord(value) || !exactKeys(value, [
    'supported', 'browserEnabled', 'computerEnabled', 'permissions', 'ordinaryApps',
    'emergencyAccelerator', 'active', 'stopping',
  ])) return false
  if (typeof value.supported !== 'boolean' || typeof value.browserEnabled !== 'boolean'
    || typeof value.computerEnabled !== 'boolean'
    || typeof value.stopping !== 'boolean' || !boundedText(value.emergencyAccelerator, 128)
    || !plainRecord(value.permissions)
    || !exactKeys(value.permissions, ['screenViewing', 'assistiveControl'])) return false
  const permissionStates: readonly unknown[] = ['granted', 'denied', 'unknown']
  if (!permissionStates.includes(value.permissions.screenViewing)
    || !permissionStates.includes(value.permissions.assistiveControl)) return false
  if (!Array.isArray(value.ordinaryApps) || value.ordinaryApps.length > 128
    || !value.ordinaryApps.every(app => plainRecord(app)
      && exactKeys(app, ['appId', 'name', 'allowed'])
      && boundedText(app.appId, 256) && boundedText(app.name, 256)
      && typeof app.allowed === 'boolean')) return false
  return value.active === null || plainRecord(value.active)
    && exactKeys(value.active, ['agentName', 'appName', 'action'])
    && boundedText(value.active.agentName, 128)
    && boundedText(value.active.appName, 256)
    && boundedText(value.active.action, 128)
}

const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const ACCELERATOR = /^[\x20-\x7e]{1,128}$/

export function isDesktopControlUiMutation(value: unknown): value is DesktopControlUiMutation {
  if (!plainRecord(value)) return false
  if (value.kind === 'set-browser-enabled' || value.kind === 'set-computer-enabled') {
    return exactKeys(value, ['kind', 'enabled']) && typeof value.enabled === 'boolean'
  }
  if (value.kind === 'set-app-allowed') {
    return exactKeys(value, ['kind', 'appId', 'allowed'])
      && typeof value.appId === 'string' && APP_ID.test(value.appId)
      && typeof value.allowed === 'boolean'
  }
  return value.kind === 'set-emergency-accelerator'
    && exactKeys(value, ['kind', 'accelerator'])
    && typeof value.accelerator === 'string' && ACCELERATOR.test(value.accelerator)
}

/** Validate the path-free renderer-visible browser takeover state. */
export function isBrowserTakeoverStatus(value: unknown): value is BrowserTakeoverStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return false
  const candidate = value as Record<string, unknown>
  return Object.keys(candidate).length === 2
    && (candidate.phase === 'human' || candidate.phase === 'given'
      || candidate.phase === 'agent' || candidate.phase === 'stopping')
    && candidate.signedInWarning === true
}

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
  /** Give the exact visible persistent human browser to the next official Agent acquire. */
  giveWorkbenchBrowserToAgent(): Promise<BrowserTakeoverStatus>
  /** Await complete cleanup of the active Agent browser surface. */
  stopAgentBrowser(): Promise<BrowserTakeoverStatus>
  /** Read path-free takeover state without exposing any authority identity. */
  getBrowserTakeoverStatus(): Promise<BrowserTakeoverStatus>
  onBrowserTakeoverStatus(listener: (status: BrowserTakeoverStatus) => void): () => void
  getDesktopPreferences(): Promise<DesktopPreferencesSnapshot>
  setDesktopPreference(mutation: DesktopPreferenceMutation): Promise<DesktopPreferencesSnapshot>
  onDesktopPreferences(listener: (snapshot: DesktopPreferencesSnapshot) => void): () => void
  getComputerControlStatus(): Promise<DesktopControlUiSnapshot>
  stopComputerControl(): Promise<DesktopControlUiSnapshot>
  setComputerControlSetting(mutation: DesktopControlUiMutation): Promise<DesktopControlUiSnapshot>
  onComputerControlStatus(listener: (snapshot: DesktopControlUiSnapshot) => void): () => void
}

declare global {
  interface Window {
    dshDesktop?: DesktopApi
  }
}
import type { DesktopBrowserBounds, DesktopBrowserRequest, DesktopBrowserSnapshot } from './browser/contracts.ts'
