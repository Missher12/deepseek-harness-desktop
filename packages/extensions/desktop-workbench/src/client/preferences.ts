import type { ObservableSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ILayout, UtilityMode } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Local preference key for the utility width. */
export const WIDTH_KEY = 'dsh.desktop-workbench.width.v1'
/** Versioned local preference key for the last selected utility mode. */
export const MODE_KEY = 'dsh.desktop-workbench.mode.v1'
/** Stable presentation order for the docked Workbench launcher. */
export const WORKBENCH_MODE_ORDER = ['review', 'terminal', 'browser', 'files'] as const satisfies readonly UtilityMode[]
/** Minimal readable storage contract. */
export interface StorageReader { getItem(key: string): string | null }
/** Minimal writable storage contract. */
export interface StorageWriter extends StorageReader { setItem(key: string, value: string): void }
/** Observable workbench UI state. */
export interface WorkbenchSnapshot { open: boolean; mode: UtilityMode; width: number; sessionId?: SessionId }

/**
 * Restore and clamp the persisted workbench width.
 * @param storage - storage containing the optional preference.
 * @returns a width within the 320-720 px contract.
 */
export function loadWidth(storage: StorageReader): number {
  const stored = storage.getItem(WIDTH_KEY)
  if (stored === null) return 420
  const value = Number(stored)
  return Number.isFinite(value) ? Math.min(720, Math.max(320, Math.round(value))) : 420
}

/**
 * Restore only a closed, currently supported Workbench mode.
 * @param storage - storage containing the optional mode preference.
 * @returns the stored mode, or the existing Terminal default.
 */
export function loadMode(storage: StorageReader): UtilityMode {
  const stored = storage.getItem(MODE_KEY)
  return WORKBENCH_MODE_ORDER.some(mode => mode === stored) ? stored as UtilityMode : 'terminal'
}

/** Coordinates persisted workbench preferences with the generic layout service. */
export class WorkbenchController implements ObservableSnapshot<WorkbenchSnapshot> {
  #listeners = new Set<() => void>()
  #snapshot: WorkbenchSnapshot
  #widthApplied = false

  constructor(private readonly layout: Pick<ILayout, 'openUtility' | 'closeUtility' | 'toggleUtility' | 'setUtilityWidth'>, private readonly storage: StorageWriter) {
    this.#snapshot = { open: false, mode: loadMode(storage), width: loadWidth(storage) }
  }

  getSnapshot = (): WorkbenchSnapshot => this.#snapshot
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }

  /**
   * Toggle the workbench for one session.
   * @param sessionId - current session whose workbench should toggle.
   */
  toggle(sessionId: SessionId): void {
    const open = this.#snapshot.sessionId === sessionId ? !this.#snapshot.open : true
    this.#set({ ...this.#snapshot, sessionId, open })
    if (open) this.#openUtility(this.#snapshot.mode)
    else this.layout.closeUtility()
  }

  /**
   * Open one workbench mode for a session.
   * @param sessionId - current ordinary session.
   * @param mode - requested utility mode.
   */
  open(sessionId: SessionId, mode?: UtilityMode): void {
    const nextMode = mode ?? this.#snapshot.mode
    if (mode !== undefined) this.storage.setItem(MODE_KEY, mode)
    this.#set({ ...this.#snapshot, sessionId, mode: nextMode, open: true })
    this.#openUtility(nextMode)
  }

  /** Close the utility workbench. */
  close(): void { this.#set({ ...this.#snapshot, open: false }); this.layout.closeUtility() }

  /**
   * Select and keep open one utility mode.
   * @param mode - requested utility mode.
   */
  selectMode(mode: UtilityMode): void {
    this.storage.setItem(MODE_KEY, mode)
    this.#set({ ...this.#snapshot, mode, open: true })
    this.#openUtility(mode)
  }

  /**
   * Persist and apply one clamped utility width.
   * @param width - requested utility width in pixels.
   */
  setWidth(width: number): void {
    const next = Math.min(720, Math.max(320, Math.round(width)))
    this.storage.setItem(WIDTH_KEY, String(next))
    this.#set({ ...this.#snapshot, width: next })
    this.layout.setUtilityWidth(next)
    this.#widthApplied = true
  }

  #set(next: WorkbenchSnapshot): void {
    this.#snapshot = next
    for (const listener of this.#listeners) listener()
  }

  #openUtility(mode: UtilityMode): void {
    // Restore the saved preference only on the first open. The layout store
    // owns live drag geometry after that, so switching modes or reopening the
    // panel must not overwrite the user's current width with a stale value.
    if (!this.#widthApplied) {
      this.layout.setUtilityWidth(this.#snapshot.width)
      this.#widthApplied = true
    }
    this.layout.openUtility(mode)
  }
}

/** Workbench services injected into its Client slot entries. */
export interface WorkbenchInjected {
  hooks: { workbench: ObservableSnapshot<WorkbenchSnapshot> }
  toggle(sessionId: SessionId): void
  close(): void
  selectMode(mode: UtilityMode): void
  setWidth(width: number): void
}
