export const DESKTOP_CONTROL_PERMISSION_STATES = ['granted', 'denied', 'unknown'] as const
export type DesktopControlPermissionState = typeof DESKTOP_CONTROL_PERMISSION_STATES[number]

export interface DesktopControlUiSnapshot {
  readonly supported: boolean
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

export type DesktopControlUiMutation =
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
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function shortText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

export function isDesktopControlUiSnapshot(value: unknown): value is DesktopControlUiSnapshot {
  if (!plainRecord(value) || !exactKeys(value, [
    'supported', 'computerEnabled', 'permissions', 'ordinaryApps',
    'emergencyAccelerator', 'active', 'stopping',
  ])) return false
  if (typeof value.supported !== 'boolean' || typeof value.computerEnabled !== 'boolean'
    || typeof value.stopping !== 'boolean' || !shortText(value.emergencyAccelerator, 128)) return false
  if (!plainRecord(value.permissions)
    || !exactKeys(value.permissions, ['screenViewing', 'assistiveControl'])) return false
  const states = DESKTOP_CONTROL_PERMISSION_STATES as readonly unknown[]
  if (!states.includes(value.permissions.screenViewing)
    || !states.includes(value.permissions.assistiveControl)) return false
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
