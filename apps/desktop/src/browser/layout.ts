const BROWSER_LAYOUT_REFERENCE_WIDTH = 1_200
const BROWSER_ZOOM_MINIMUM = 2 / 3

/** Fit desktop-oriented sites into a docked utility panel without upscaling wide panels. */
export function browserZoomFactor(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1
  return Math.min(1, Math.max(BROWSER_ZOOM_MINIMUM, width / BROWSER_LAYOUT_REFERENCE_WIDTH))
}
