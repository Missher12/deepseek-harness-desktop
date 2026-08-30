/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * details open/close from ui-conversation) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLayoutStore } from './stores.ts'
import type { UtilityMode } from './stores.ts'
import { UTILITY_DEFAULT } from './columns.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/** Read-only projection of the utility fields owned by the persisted layout store. */
export interface UtilityLayoutSnapshot {
  open: boolean
  mode: UtilityMode
  width: number
}

/**
 * The outward layout face (`ctx.layout`): the panel transitions other
 * plugins may trigger — and exactly what a test fake must supply. The
 * attachPanels wiring hook stays on the concrete class (root-entry assembly
 * only).
 */
export interface ILayout {
  /** Read the utility projection published by the mounted layout store. */
  getSnapshot(): UtilityLayoutSnapshot
  /** Subscribe to utility projection changes. */
  subscribe(listener: () => void): () => void
  /** Toggle the sidebar panel (closed ⟷ last expanded width). */
  toggleSidebar(): void
  /** Open the details panel (no-op when already open). */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /** Open the utility workbench, optionally selecting a surface. */
  openUtility(mode?: UtilityMode): void
  /** Close the utility workbench. */
  closeUtility(): void
  /** Toggle the current surface, or switch/open another surface. */
  toggleUtility(mode?: UtilityMode): void
  /** Set the preferred utility width. */
  setUtilityWidth(px: number): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined
  #snapshot: UtilityLayoutSnapshot = { open: false, mode: 'terminal', width: UTILITY_DEFAULT }
  #listeners = new Set<() => void>()

  getSnapshot = (): UtilityLayoutSnapshot => this.#snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Adopt the utility projection from the persisted root layout store. */
  publishUtilityLayout = (snapshot: UtilityLayoutSnapshot): void => {
    if (snapshot.open === this.#snapshot.open
      && snapshot.mode === this.#snapshot.mode
      && snapshot.width === this.#snapshot.width) return
    this.#snapshot = snapshot
    for (const listener of this.#listeners) listener()
  }

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel (closed ⟷ last expanded width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  openUtility(mode?: UtilityMode): void {
    this.#require().openUtility(mode)
  }

  closeUtility(): void {
    this.#require().closeUtility()
  }

  toggleUtility(mode?: UtilityMode): void {
    this.#require().toggleUtility(mode)
  }

  setUtilityWidth(px: number): void {
    this.#require().setUtilityWidth(px)
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
