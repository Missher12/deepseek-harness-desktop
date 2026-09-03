/** One side of the trigger on which the popup may be placed. */
export type PopupSide = 'below' | 'above'

/** Rectangle fields used by the placement calculation. */
export interface PlacementRect {
  readonly top: number
  readonly left: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

/** Visible browser viewport expressed in layout-viewport coordinates. */
export interface PopupViewport {
  readonly width: number
  readonly height: number
  readonly offsetTop: number
  readonly offsetLeft: number
}

/** Inputs for deterministic popup placement. */
export interface PlacementInput {
  readonly anchor: PlacementRect
  readonly popup: PlacementRect
  readonly viewport: PopupViewport
  readonly preferred?: PopupSide
  readonly currentSide?: PopupSide
}

/** Fixed-position geometry for the portaled popup. */
export interface PopupPlacement {
  readonly side: PopupSide
  readonly top: number
  readonly left: number
  readonly maxHeight: number
  readonly maxWidth: number
}

const GAP = 8
const MARGIN = 8
const SIDE_HYSTERESIS_HEIGHT = 120

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
)

/**
 * Place a portaled popup inside the current visual viewport.
 *
 * The preferred side wins when it fits. While a popup is already open, its
 * current side remains stable until that side has less than 120px available.
 * @param input - Actual anchor, popup, and visual-viewport measurements.
 * @returns Fixed-position coordinates and the available vertical height.
 */
export function placePopup(input: PlacementInput): PopupPlacement {
  const { anchor, popup, viewport } = input
  const preferred = input.preferred ?? 'below'
  const viewportTop = viewport.offsetTop + MARGIN
  const viewportBottom = viewport.offsetTop + viewport.height - MARGIN
  const viewportLeft = viewport.offsetLeft + MARGIN
  const viewportRight = viewport.offsetLeft + viewport.width - MARGIN
  const maxWidth = Math.max(0, viewport.width - MARGIN * 2)
  const belowTop = clamp(anchor.bottom + GAP, viewportTop, viewportBottom)
  const aboveBottom = clamp(anchor.top - GAP, viewportTop, viewportBottom)
  const available = {
    below: Math.max(0, viewportBottom - belowTop),
    above: Math.max(0, aboveBottom - viewportTop),
  } satisfies Record<PopupSide, number>

  let side: PopupSide
  if (input.currentSide !== undefined && available[input.currentSide] >= SIDE_HYSTERESIS_HEIGHT) {
    side = input.currentSide
  } else {
    const alternate: PopupSide = preferred === 'below' ? 'above' : 'below'
    if (available[preferred] >= popup.height) {
      side = preferred
    } else if (available[alternate] >= popup.height) {
      side = alternate
    } else {
      side = available[alternate] > available[preferred] ? alternate : preferred
    }
  }

  const maxHeight = available[side]
  const top = side === 'below'
    ? belowTop
    : aboveBottom - Math.min(popup.height, maxHeight)
  const effectiveWidth = Math.min(Math.max(0, popup.width), maxWidth)
  const left = clamp(anchor.left, viewportLeft, viewportRight - effectiveWidth)

  return { side, top, left, maxHeight, maxWidth }
}
