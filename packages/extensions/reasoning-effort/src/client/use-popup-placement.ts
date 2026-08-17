import { useLayoutEffect, useRef, useState } from 'react'
import { placePopup, type PopupPlacement, type PopupSide } from './placement.ts'

/** Reactive inputs for a portaled popup's browser measurements. */
export interface UsePopupPlacementInput {
  readonly anchor: HTMLElement | null
  readonly popup: HTMLElement | null
  readonly open: boolean
  readonly preferred?: PopupSide
}

const LAYOUT_SHIFT_EPSILON = 0.5
const INTERSECTION_THRESHOLD = 0.999

const samePlacement = (left: PopupPlacement | null, right: PopupPlacement): boolean => (
  left !== null
  && left.side === right.side
  && left.top === right.top
  && left.left === right.left
  && left.maxHeight === right.maxHeight
  && left.maxWidth === right.maxWidth
)

const movedFrom = (current: DOMRect, baseline: DOMRect): boolean => (
  Math.abs(current.top - baseline.top) > LAYOUT_SHIFT_EPSILON
  || Math.abs(current.left - baseline.left) > LAYOUT_SHIFT_EPSILON
  || Math.abs(current.right - baseline.right) > LAYOUT_SHIFT_EPSILON
  || Math.abs(current.bottom - baseline.bottom) > LAYOUT_SHIFT_EPSILON
)

const clippedRootMargin = (rect: DOMRect): string | null => {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const top = Math.min(Math.max(rect.top, 0), viewportHeight)
  const left = Math.min(Math.max(rect.left, 0), viewportWidth)
  const right = Math.min(Math.max(rect.right, 0), viewportWidth)
  const bottom = Math.min(Math.max(rect.bottom, 0), viewportHeight)
  if (right - left <= LAYOUT_SHIFT_EPSILON || bottom - top <= LAYOUT_SHIFT_EPSILON) return null
  return `${-top}px ${-(viewportWidth - right)}px ${-(viewportHeight - bottom)}px ${-left}px`
}

/**
 * Measure an open popup from browser geometry events.
 *
 * The layout-shift sensor clips an IntersectionObserver root to the measured
 * anchor. Its 0.999 threshold notices same-size movement without polling;
 * differences up to half a CSS pixel are ignored to prevent subpixel loops.
 * @param input - Actual popup nodes, open state, and optional side preference.
 * @returns The latest placement, or null while closed or awaiting measurement.
 */
export function usePopupPlacement(input: UsePopupPlacementInput): PopupPlacement | null {
  const { anchor, popup, open, preferred = 'below' } = input
  const [placement, setPlacement] = useState<PopupPlacement | null>(null)
  const placementRef = useRef<PopupPlacement | null>(null)
  const currentSideRef = useRef<PopupSide | undefined>(undefined)

  useLayoutEffect(() => {
    if (!open) {
      currentSideRef.current = undefined
      if (placementRef.current !== null) {
        placementRef.current = null
        setPlacement(null)
      }
      return
    }

    let active = true
    let animationFrame: number | null = null
    let layoutObserver: IntersectionObserver | null = null
    const visualViewport = window.visualViewport

    const publish = (next: PopupPlacement | null): void => {
      if (next === null) {
        if (placementRef.current === null) return
        placementRef.current = null
        setPlacement(null)
        return
      }
      if (samePlacement(placementRef.current, next)) return
      placementRef.current = next
      setPlacement(next)
    }
    function scheduleMeasurement(): void {
      if (!active || animationFrame !== null) return
      animationFrame = requestAnimationFrame(measure)
    }
    function armLayoutShiftSensor(anchorRect: DOMRect): void {
      layoutObserver?.disconnect()
      layoutObserver = null
      if (typeof IntersectionObserver === 'undefined' || anchor === null) return
      const rootMargin = clippedRootMargin(anchorRect)
      if (rootMargin === null) return

      const baseline = anchorRect
      const observer = new IntersectionObserver(() => {
        if (!active || layoutObserver !== observer) return
        if (movedFrom(anchor.getBoundingClientRect(), baseline)) scheduleMeasurement()
      }, { rootMargin, threshold: INTERSECTION_THRESHOLD })
      layoutObserver = observer
      observer.observe(anchor)
    }
    function measure(): void {
      animationFrame = null
      if (!active) return
      if (anchor === null || popup === null) {
        publish(null)
        return
      }

      const anchorRect = anchor.getBoundingClientRect()
      const currentSide = currentSideRef.current
      const next = placePopup({
        anchor: anchorRect,
        popup: popup.getBoundingClientRect(),
        viewport: {
          width: visualViewport?.width ?? window.innerWidth,
          height: visualViewport?.height ?? window.innerHeight,
          offsetLeft: visualViewport?.offsetLeft ?? 0,
          offsetTop: visualViewport?.offsetTop ?? 0,
        },
        preferred,
        ...(currentSide === undefined ? {} : { currentSide }),
      })
      currentSideRef.current = next.side
      publish(next)
      armLayoutShiftSensor(anchorRect)
    }

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMeasurement)
    if (resizeObserver !== null) {
      if (anchor !== null) resizeObserver.observe(anchor)
      if (popup !== null) resizeObserver.observe(popup)
    }
    scheduleMeasurement()
    window.addEventListener('resize', scheduleMeasurement)
    window.addEventListener('scroll', scheduleMeasurement, true)
    visualViewport?.addEventListener('resize', scheduleMeasurement)
    visualViewport?.addEventListener('scroll', scheduleMeasurement)

    return () => {
      active = false
      window.removeEventListener('resize', scheduleMeasurement)
      window.removeEventListener('scroll', scheduleMeasurement, true)
      visualViewport?.removeEventListener('resize', scheduleMeasurement)
      visualViewport?.removeEventListener('scroll', scheduleMeasurement)
      resizeObserver?.disconnect()
      layoutObserver?.disconnect()
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
        animationFrame = null
      }
    }
  }, [anchor, open, popup, preferred])

  return placement
}
