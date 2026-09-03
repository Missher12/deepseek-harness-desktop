import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { DesktopUpdateSnapshot } from './contracts.ts'

/** Reactive state owned by the System Update settings contribution. */
export interface SystemUpdateState {
  snapshot: DesktopUpdateSnapshot
}

type SystemUpdateActions = {
  sync: (draft: SystemUpdateState, snapshot: DesktopUpdateSnapshot) => void
}

/** Initial status shown before the Desktop preload bridge responds. */
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

/**
 * Create one isolated store for a mounted System Update settings section.
 * @returns A store handle whose snapshot is updated only from sanitized bridge values.
 */
export function createSystemUpdateStore(): EngineStoreHandle<SystemUpdateState, SystemUpdateActions> {
  return defineStore({
    init: (): SystemUpdateState => ({ snapshot: { ...EMPTY_UPDATE_SNAPSHOT } }),
    actions: {
      sync: (draft, snapshot) => { draft.snapshot = snapshot },
    },
  })
}
