import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { DesktopControlUiSnapshot } from './contracts.ts'

/** Reactive client state for the latest validated Desktop control snapshot. */
export interface DesktopControlUiState { snapshot: DesktopControlUiSnapshot }
type DesktopControlUiActions = { sync: (draft: DesktopControlUiState, snapshot: DesktopControlUiSnapshot) => void }

/** Fail-closed snapshot used before the optional preload bridge settles. */
export const EMPTY_DESKTOP_CONTROL_SNAPSHOT: DesktopControlUiSnapshot = {
  browser: { availability: 'unknown', enabled: false },
  computer: { availability: 'unknown', enabled: false },
  permissions: { screenViewing: 'unknown', assistiveControl: 'unknown' },
  refresh: { status: { state: 'checking' }, apps: { state: 'checking' } },
  ordinaryApps: [],
  emergencyAccelerator: 'CommandOrControl+Shift+F12',
  active: null,
  stopping: false,
}

/**
 * Create the isolated Desktop control client store.
 * @returns a store whose only mutation replaces the validated snapshot.
 */
export function createDesktopControlStore(): EngineStoreHandle<DesktopControlUiState, DesktopControlUiActions> {
  return defineStore({
    init: () => ({ snapshot: EMPTY_DESKTOP_CONTROL_SNAPSHOT }),
    actions: { sync: (draft, snapshot) => { draft.snapshot = snapshot } },
  })
}
