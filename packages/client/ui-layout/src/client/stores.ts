/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
  UTILITY_DEFAULT, UTILITY_MAX, UTILITY_MIN,
} from './columns.ts'

/** Workbench surfaces supported by the generic utility column. */
export const UTILITY_MODES = ['terminal', 'browser', 'files', 'review', 'browserSkill'] as const
/** One workbench surface identifier. */
export type UtilityMode = typeof UTILITY_MODES[number]

/**
 * Layout store state: panel width preferences in px (0 = closed), plus the
 * narrow-viewport pair — `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 */
export type LayoutState = {
  sidebar: number
  details: number
  utilityOpen: boolean
  utilityMode: UtilityMode
  utilityWidth: number
  narrow: boolean
  narrowExpanded: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  openUtility: (draft: LayoutState, mode?: UtilityMode) => void
  closeUtility: (draft: LayoutState) => void
  toggleUtility: (draft: LayoutState, mode?: UtilityMode) => void
  setUtilityWidth: (draft: LayoutState, px: number) => void
}

/**
 * Create the layout panel store handle. The preference IS the width, so
 * closing a panel forgets its drag width — reopening restores the contract
 * default. Actions are the complete write set: drag writes clamp
 * into the panel's contract range and never cross the open/closed line;
 * open/close transitions write 0 / the default explicitly. Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the preference.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      utilityOpen: false,
      utilityMode: 'terminal',
      utilityWidth: UTILITY_DEFAULT,
      narrow: false,
      narrowExpanded: false,
    }),
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      setUtilityWidth: (d, px: number) => { d.utilityWidth = clampWidth(px, UTILITY_MIN, UTILITY_MAX) },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => {
        d.utilityOpen = false
        if (d.details === 0) d.details = DETAILS_DEFAULT
      },
      closeDetails: (d) => { d.details = 0 },
      openUtility: (d, mode?: UtilityMode) => {
        if (mode !== undefined) d.utilityMode = mode
        d.details = 0
        d.utilityOpen = true
      },
      closeUtility: (d) => { d.utilityOpen = false },
      toggleUtility: (d, mode?: UtilityMode) => {
        if (mode !== undefined && mode !== d.utilityMode) {
          d.utilityMode = mode
          d.details = 0
          d.utilityOpen = true
          return
        }
        d.utilityOpen = !d.utilityOpen
        if (d.utilityOpen) d.details = 0
      },
    },
  })
  return handle
}
