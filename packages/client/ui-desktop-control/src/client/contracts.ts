export const DESKTOP_CONTROL_PERMISSION_STATES = ['granted', 'denied', 'unknown'] as const
export type DesktopControlPermissionState = typeof DESKTOP_CONTROL_PERMISSION_STATES[number]
export const DESKTOP_CONTROL_AVAILABILITY_STATES = ['available', 'unavailable', 'unknown'] as const
export type DesktopControlAvailability = typeof DESKTOP_CONTROL_AVAILABILITY_STATES[number]

export interface DesktopControlCapabilityState {
  readonly availability: DesktopControlAvailability
  readonly enabled: boolean
}

export type DesktopControlRefreshState =
  | { readonly state: 'ready' | 'checking' }
  | { readonly state: 'failed'; readonly message: string }

export interface DesktopControlUiSnapshot {
  readonly browser: DesktopControlCapabilityState
  readonly computer: DesktopControlCapabilityState
  readonly permissions: {
    readonly screenViewing: DesktopControlPermissionState
    readonly assistiveControl: DesktopControlPermissionState
  }
  readonly refresh: {
    readonly status: DesktopControlRefreshState
    readonly apps: DesktopControlRefreshState
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

export type DesktopControlUiMutation =
  | { readonly kind: 'set-browser-enabled'; readonly enabled: boolean }
  | { readonly kind: 'set-computer-enabled'; readonly enabled: boolean }
  | { readonly kind: 'set-app-allowed'; readonly appId: string; readonly allowed: boolean }
  | { readonly kind: 'set-emergency-accelerator'; readonly accelerator: string }

export interface DesktopControlBridge {
  getComputerControlStatus(): Promise<DesktopControlUiSnapshot>
  stopComputerControl(): Promise<DesktopControlUiSnapshot>
  setComputerControlSetting(mutation: DesktopControlUiMutation): Promise<DesktopControlUiSnapshot>
  onComputerControlStatus(listener: (snapshot: DesktopControlUiSnapshot) => void): () => void
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => 'value' in descriptor)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function shortText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isCapabilityState(value: unknown): value is DesktopControlCapabilityState {
  return plainRecord(value) && exactKeys(value, ['availability', 'enabled'])
    && (DESKTOP_CONTROL_AVAILABILITY_STATES as readonly unknown[]).includes(value.availability)
    && typeof value.enabled === 'boolean'
}

function isRefreshState(value: unknown): value is DesktopControlRefreshState {
  if (!plainRecord(value) || typeof value.state !== 'string') return false
  if (value.state === 'ready' || value.state === 'checking') return exactKeys(value, ['state'])
  return value.state === 'failed' && exactKeys(value, ['state', 'message'])
    && shortText(value.message, 160)
}

export function isDesktopControlUiSnapshot(value: unknown): value is DesktopControlUiSnapshot {
  if (!plainRecord(value) || !exactKeys(value, [
    'browser', 'computer', 'permissions', 'refresh', 'ordinaryApps',
    'emergencyAccelerator', 'active', 'stopping',
  ])) return false
  if (!isCapabilityState(value.browser) || !isCapabilityState(value.computer)
    || typeof value.stopping !== 'boolean' || !shortText(value.emergencyAccelerator, 128)) return false
  if (!plainRecord(value.permissions)
    || !exactKeys(value.permissions, ['screenViewing', 'assistiveControl'])) return false
  const states = DESKTOP_CONTROL_PERMISSION_STATES as readonly unknown[]
  if (!states.includes(value.permissions.screenViewing)
    || !states.includes(value.permissions.assistiveControl)) return false
  if (!plainRecord(value.refresh) || !exactKeys(value.refresh, ['status', 'apps'])
    || !isRefreshState(value.refresh.status) || !isRefreshState(value.refresh.apps)) return false
  if (!Array.isArray(value.ordinaryApps) || value.ordinaryApps.length > 128
    || !value.ordinaryApps.every(app => plainRecord(app)
      && exactKeys(app, ['appId', 'name', 'allowed'])
      && shortText(app.appId, 256) && shortText(app.name, 256)
      && typeof app.allowed === 'boolean')) return false
  return value.active === null || plainRecord(value.active)
    && exactKeys(value.active, ['agentName', 'appName', 'action'])
    && shortText(value.active.agentName, 128)
    && shortText(value.active.appName, 256)
    && shortText(value.active.action, 128)
}

export function isDesktopControlBridge(value: unknown): value is DesktopControlBridge {
  if (typeof value !== 'object' || value === null) return false
  const bridge = value as Record<string, unknown>
  return ['getComputerControlStatus', 'stopComputerControl', 'setComputerControlSetting', 'onComputerControlStatus']
    .every(key => typeof bridge[key] === 'function')
}
