/** Reactive projection of the native close preference; native storage remains authoritative. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DesktopCloseBehavior, DesktopShellBridge } from './contracts.ts'

/** Serializable view state for the native close preference row. */
export interface DesktopPreferenceState {
  closeBehavior: DesktopCloseBehavior | null
  status: 'loading' | 'ready' | 'error'
  saving: boolean
}

/** Scoped native preference subscription and operations. */
export interface DesktopPreferences {
  source: SnapshotStore<DesktopPreferenceState>
  /** Start one subscription and initial read; the disposer invalidates pending responses. */
  start: () => () => void
  /** Retry a failed read while this plugin is active. */
  reload: () => Promise<void>
  /** Write only closeBehavior, ignoring concurrent gestures until the native response settles. */
  setCloseBehavior: (value: DesktopCloseBehavior) => Promise<void>
}

function closeBehavior(snapshot: unknown): DesktopCloseBehavior {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) throw new Error('Invalid native preference.')
  const value = (snapshot as Record<string, unknown>).closeBehavior
  if (value !== 'keep-running' && value !== 'quit') throw new Error('Invalid native close preference.')
  return value
}

/**
 * Project validated native close behavior without retaining unrelated preference fields.
 * @param bridge - restricted native preference operations.
 * @returns one plugin-lifetime controller with a framework-bindable observable source.
 */
export function createDesktopPreferences(bridge: DesktopShellBridge): DesktopPreferences {
  const source = createSnapshotStore<DesktopPreferenceState>({ closeBehavior: null, status: 'loading', saving: false })
  let active = false
  let revision = 0
  const isActive = (): boolean => active
  const sync = (snapshot: unknown): void => {
    const value = closeBehavior(snapshot)
    source.update((state) => { state.closeBehavior = value; state.status = 'ready' })
  }
  const fail = (): void => { source.update((state) => { state.status = 'error' }) }
  const reload = async (): Promise<void> => {
    if (!isActive() || source.getSnapshot().saving) return
    const request = ++revision
    source.update((state) => { state.status = 'loading' })
    try {
      const snapshot = await bridge.getDesktopPreferences()
      if (isActive() && request === revision) sync(snapshot)
    } catch {
      if (isActive() && request === revision) fail()
    }
  }
  return {
    source,
    reload,
    start() {
      active = true
      const unsubscribe = bridge.onDesktopPreferences((snapshot) => {
        if (!isActive()) return
        revision += 1
        try { sync(snapshot) } catch { fail() }
      })
      void reload()
      return () => {
        active = false
        revision += 1
        unsubscribe()
      }
    },
    async setCloseBehavior(value) {
      if (!isActive() || source.getSnapshot().saving || source.getSnapshot().closeBehavior === null) return
      const request = ++revision
      source.update((state) => { state.saving = true })
      try {
        const snapshot = await bridge.setDesktopPreference({ key: 'closeBehavior', value })
        if (isActive() && request === revision) sync(snapshot)
      } catch {
        if (isActive() && request === revision) fail()
      } finally {
        if (isActive()) source.update((state) => { state.saving = false })
      }
    },
  }
}
