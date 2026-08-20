import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { DesktopUpdateSnapshot } from './contracts.ts'

export interface SystemUpdateState {
  snapshot: DesktopUpdateSnapshot
}

type SystemUpdateActions = {
  sync: (draft: SystemUpdateState, snapshot: DesktopUpdateSnapshot) => void
}

export const EMPTY_UPDATE_SNAPSHOT: DesktopUpdateSnapshot = {
  phase: 'idle',
  runningDesktop: '—',
  includedHarness: '—',
  latestOfficialHarness: null,
  latestDesktop: null,
  lastCheckedAt: null,
  downloadProgress: null,
  message: null,
}

export function createSystemUpdateStore(): EngineStoreHandle<SystemUpdateState, SystemUpdateActions> {
  return defineStore({
    init: (): SystemUpdateState => ({ snapshot: { ...EMPTY_UPDATE_SNAPSHOT } }),
    actions: {
      sync: (draft, snapshot) => { draft.snapshot = snapshot },
    },
  })
}
