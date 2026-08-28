import type {
  ComputerListResult,
  ComputerStatusResult,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  isDesktopControlUiMutation,
  type DesktopControlUiMutation,
  type DesktopControlUiSnapshot,
} from '../preload-api.ts'
import type { DesktopControlCoordinatorStatus } from './control-coordinator.ts'
import type { ControlSettings } from './settings-store.ts'

/** Optional observation-only native seam. Its absence is a normal unsupported Desktop state. */
export interface ComputerControlUiProvider {
  status(): Promise<ComputerStatusResult>
  list(signal: AbortSignal): Promise<ComputerListResult>
}

export interface ComputerControlUiAuthorityOptions {
  readonly getSettings: () => ControlSettings
  readonly writeSettings: (settings: ControlSettings) => Promise<void>
  readonly getControlStatus: () => DesktopControlCoordinatorStatus
  readonly stopActive: () => Promise<void>
  readonly confirmExpansion: (mutation: DesktopControlUiMutation) => Promise<boolean>
  readonly provider?: ComputerControlUiProvider
}

function actionLabel(kind: string | null): string {
  if (kind === null) return 'Active'
  const action = kind.slice(kind.indexOf('.') + 1).replaceAll('-', ' ')
  return action.replace(/^\w/, value => value.toUpperCase())
}

/** Main-owned projection and settings authority for the zero-authority preload bridge. */
export class ComputerControlUiAuthority {
  readonly #options: ComputerControlUiAuthorityOptions
  #mutationTail: Promise<void> = Promise.resolve()

  constructor(options: ComputerControlUiAuthorityOptions) {
    this.#options = options
  }

  async snapshot(): Promise<DesktopControlUiSnapshot> {
    const settings = this.#options.getSettings()
    const provider = this.#options.provider
    let nativeStatus: ComputerStatusResult = {
      viewing: 'unknown', assistive: 'unknown', supported: false,
    }
    let list: ComputerListResult = { apps: [] }
    if (provider !== undefined) {
      try {
        [nativeStatus, list] = await Promise.all([
          provider.status(),
          provider.list(new AbortController().signal),
        ])
      } catch {
        nativeStatus = { viewing: 'unknown', assistive: 'unknown', supported: false }
        list = { apps: [] }
      }
    }
    const coordinator = this.#options.getControlStatus()
    const apps = list.apps.map(app => Object.freeze({
      appId: app.appId,
      name: app.name,
      allowed: settings.ordinaryAppIds.includes(app.appId),
    }))
    const active = coordinator.active === null ? null : Object.freeze({
      agentName: coordinator.active.agentName,
      appName: coordinator.active.appId === null
        ? coordinator.active.surfaceKind.startsWith('browser-') ? 'Browser' : 'Desktop'
        : apps.find(app => app.appId === coordinator.active?.appId)?.name ?? coordinator.active.appId,
      action: actionLabel(coordinator.action),
    })
    return Object.freeze({
      supported: nativeStatus.supported && coordinator.computerSupported,
      computerEnabled: settings.computerEnabled,
      permissions: Object.freeze({
        screenViewing: nativeStatus.viewing,
        assistiveControl: nativeStatus.assistive,
      }),
      ordinaryApps: Object.freeze(apps),
      emergencyAccelerator: settings.emergencyAccelerator,
      active,
      stopping: coordinator.stopping,
    })
  }

  async mutate(value: unknown): Promise<DesktopControlUiSnapshot> {
    if (!isDesktopControlUiMutation(value)) throw new TypeError('Invalid Desktop control setting intent.')
    let failure: unknown
    const task = this.#mutationTail.then(async () => {
      try { await this.#applyMutation(value) } catch (error) { failure = error }
    })
    this.#mutationTail = task
    await task
    if (failure !== undefined) throw failure
    return await this.snapshot()
  }

  async stop(): Promise<DesktopControlUiSnapshot> {
    await this.#options.stopActive()
    return await this.snapshot()
  }

  async #applyMutation(mutation: DesktopControlUiMutation): Promise<void> {
    const current = this.#options.getSettings()
    if (mutation.kind === 'set-app-allowed' && mutation.allowed) {
      const provider = this.#options.provider
      if (provider === undefined) throw new Error('Computer provider is unavailable.')
      const listed = await provider.list(new AbortController().signal)
      if (!listed.apps.some(app => app.appId === mutation.appId)) {
        throw new Error('Application is not currently enumerated.')
      }
    }
    const expansion = mutation.kind === 'set-computer-enabled' && mutation.enabled
      || mutation.kind === 'set-app-allowed' && mutation.allowed
      || mutation.kind === 'set-emergency-accelerator'
    if (expansion && !await this.#options.confirmExpansion(mutation)) {
      throw new Error('Desktop control setting was not confirmed.')
    }
    const next: ControlSettings = mutation.kind === 'set-computer-enabled'
      ? Object.freeze({ ...current, computerEnabled: mutation.enabled })
      : mutation.kind === 'set-emergency-accelerator'
        ? Object.freeze({ ...current, emergencyAccelerator: mutation.accelerator })
        : Object.freeze({
          ...current,
          ordinaryAppIds: Object.freeze(mutation.allowed
            ? [...new Set([...current.ordinaryAppIds, mutation.appId])]
            : current.ordinaryAppIds.filter(appId => appId !== mutation.appId)),
        })
    await this.#options.writeSettings(next)
  }
}
