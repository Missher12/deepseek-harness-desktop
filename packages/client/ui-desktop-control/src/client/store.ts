import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { DesktopControlUiSnapshot } from './contracts.ts'

export interface DesktopControlUiState { snapshot: DesktopControlUiSnapshot }
type DesktopControlUiActions = { sync: (draft: DesktopControlUiState, snapshot: DesktopControlUiSnapshot) => void }

export const EMPTY_DESKTOP_CONTROL_SNAPSHOT: DesktopControlUiSnapshot = {
  supported: false,
  computerEnabled: false,
  permissions: { screenViewing: 'unknown', assistiveControl: 'unknown' },
  ordinaryApps: [],
  emergencyAccelerator: 'CommandOrControl+Shift+F12',
  active: null,
  stopping: false,
}

export function createDesktopControlStore(): EngineStoreHandle<DesktopControlUiState, DesktopControlUiActions> {
  return defineStore({
    init: () => ({ snapshot: EMPTY_DESKTOP_CONTROL_SNAPSHOT }),
    actions: { sync: (draft, snapshot) => { draft.snapshot = snapshot } },
  })
}
