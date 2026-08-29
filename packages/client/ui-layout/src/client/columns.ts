/**
 * Pure concession-chain column solver for the four-column AppFrame.
 * Chain order is fixed by contract: keep center >= CENTER_MIN by shrinking
 * details, then auto-closing it. The utility workbench instead shrinks, then
 * temporarily concedes the rendered sidebar to its rail, and finally becomes
 * the only content surface in a truly small viewport. Preferred widths are
 * never rewritten, so widening the window restores them. Inputs are the layout store's plain width
 * preferences (0 = closed); a closed sidebar resolves to the fixed
 * SIDEBAR_COLLAPSED control rail while closed details resolve to zero width.
 * The SIDEBAR_AUTO_COLLAPSE breakpoint is consumed by AppFrame, which decides
 * the effective sidebar preference before solving; the solver itself stays
 * breakpoint-free.
 */

/** Resolved widths for one frame; utility focus may deliberately set center to zero. */
export interface Columns { sidebar: number; center: number; details: number; utility: number }

// Contract-frozen geometry: the four-column concession chain's fixed points.
/** Center column floor; only the final fallback may go below it. */
export const CENTER_MIN = 640
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 640
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 320
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Details drag clamp floor. */
export const DETAILS_MIN = 300
/** Details drag clamp ceiling. */
export const DETAILS_MAX = 520
/** Details width before any user drag. */
export const DETAILS_DEFAULT = 360
/** Utility workbench drag clamp floor. */
export const UTILITY_MIN = 420
/** Utility workbench drag clamp ceiling. */
export const UTILITY_MAX = 1_600
/** Utility workbench width before any user drag. */
export const UTILITY_DEFAULT = 720

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Solve the four column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param details - details width preference in px (0 = closed).
 * @param utility - utility width preference in px (0 = closed).
 * @returns resolved widths; details 0 means visually closed (never unmounted), while a closed sidebar keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number, details: number, utility = 0): Columns {
  // The preferred sidebar width survives every derived concession.
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  // Only one right surface may participate in the concession chain. The
  // store enforces mutual exclusion; utility wins defensively for stale input.
  const utilityActive = utility !== 0
  const d0 = utilityActive || details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX)
  const u0 = utilityActive ? clampWidth(utility, UTILITY_MIN, UTILITY_MAX) : 0
  const right0 = utilityActive ? u0 : d0
  const rightMin = utilityActive ? UTILITY_MIN : DETAILS_MIN

  if (utilityActive) {
    // 1. Keep all preferred widths when they fit.
    if (s + u0 + CENTER_MIN <= viewport) {
      return { sidebar: s, center: viewport - s - u0, details: 0, utility: u0 }
    }
    // 2. Keep the visible sidebar and shrink the workbench toward its floor.
    const withSidebar = Math.max(UTILITY_MIN, viewport - s - CENTER_MIN)
    if (s + withSidebar + CENTER_MIN <= viewport) {
      return { sidebar: s, center: CENTER_MIN, details: 0, utility: withSidebar }
    }
    // 3. Concede only the rendered sidebar. The stored drag preference is not
    // touched, so the full navigation returns automatically when space does.
    if (SIDEBAR_COLLAPSED + u0 + CENTER_MIN <= viewport) {
      return {
        sidebar: SIDEBAR_COLLAPSED,
        center: viewport - SIDEBAR_COLLAPSED - u0,
        details: 0,
        utility: u0,
      }
    }
    const withRail = Math.max(UTILITY_MIN, viewport - SIDEBAR_COLLAPSED - CENTER_MIN)
    if (SIDEBAR_COLLAPSED + withRail + CENTER_MIN <= viewport) {
      return { sidebar: SIDEBAR_COLLAPSED, center: CENTER_MIN, details: 0, utility: withRail }
    }
    // 4. A genuinely narrow window focuses the workbench in the grid. It
    // never overlays the conversation; the conversation track is explicitly
    // zero and returns as soon as the frame widens or the utility closes.
    return {
      sidebar: SIDEBAR_COLLAPSED,
      center: 0,
      details: 0,
      utility: Math.max(0, viewport - SIDEBAR_COLLAPSED),
    }
  }

  // Step 1: everything fits at preferred widths.
  if (s + right0 + CENTER_MIN <= viewport) return {
    sidebar: s,
    center: viewport - s - right0,
    details: d0,
    utility: u0,
  }

  // Step 2: shrink details toward its minimum.
  const right1 = right0 === 0 ? 0 : Math.max(rightMin, viewport - s - CENTER_MIN)
  if (s + right1 + CENTER_MIN <= viewport) return {
    sidebar: s,
    center: CENTER_MIN,
    details: right1,
    utility: 0,
  }

  // Step 3: auto-close details (derived — preferences untouched); center
  // absorbs any remaining deficit (may drop below CENTER_MIN).
  return { sidebar: s, center: Math.max(0, viewport - s), details: 0, utility: 0 }
}
