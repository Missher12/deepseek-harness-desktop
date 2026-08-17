import { useLayoutEffect, useRef, useState } from 'react'
import { placePopup, type PopupPlacement, type PopupSide } from './placement.ts'

/** Reactive inputs for a portaled popup's browser measurements. */
export interface UsePopupPlacementInput {
  readonly anchor: HTMLElement | null
  readonly popup: HTMLElement | null
  readonly open: boolean
  readonly preferred?: PopupSide
}

const MIN_LAYOUT_SENSOR_SIZE = 0.5
const INITIAL_INTERSECTION_THRESHOLD = 1
const MIN_INTERSECTION_THRESHOLD = 1e-7
const INTERSECTION_RATIO_TOLERANCE = 1e-6

const samePlacement = (left: PopupPlacement | null, right: PopupPlacement): boolean => (
  left !== null
  && left.side === right.side
  && left.top === right.top
  && left.left === right.left
  && left.maxHeight === right.maxHeight
  && left.maxWidth === right.maxWidth
)

const sameAnchorRect = (current: DOMRect, baseline: DOMRect): boolean => (
  current.top === baseline.top
  && current.left === baseline.left
  && current.right === baseline.right
  && current.bottom === baseline.bottom
)

const fullAnchorRootMargin = (rect: DOMRect): string | null => {
  if (rect.width <= MIN_LAYOUT_SENSOR_SIZE || rect.height <= MIN_LAYOUT_SENSOR_SIZE) return null
  return `${-rect.top}px ${-(window.innerWidth - rect.right)}px ${-(window.innerHeight - rect.bottom)}px ${-rect.left}px`
}

const calibratedThreshold = (ratio: number): number => {
  if (!Number.isFinite(ratio)) return INITIAL_INTERSECTION_THRESHOLD
  return Math.min(INITIAL_INTERSECTION_THRESHOLD, Math.max(MIN_INTERSECTION_THRESHOLD, ratio))
}

/**
 * Measure an open popup from browser geometry events.
 *
 * The layout-shift sensor clips an IntersectionObserver root to the measured
 * anchor. Each sensor settles one unchanged browser baseline callback, first
 * calibrating to the browser's quantized intersection ratio when necessary,
 * then treats every subsequent threshold notification as movement.
 * Effectively zero anchors (at most half a CSS pixel) are not observed.
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
    function armLayoutShiftSensor(
      anchorRect: DOMRect,
      requestedThreshold = INITIAL_INTERSECTION_THRESHOLD,
      calibrated = false,
    ): void {
      layoutObserver?.disconnect()
      layoutObserver = null
      if (typeof IntersectionObserver === 'undefined' || anchor === null) return
      const rootMargin = fullAnchorRootMargin(anchorRect)
      if (rootMargin === null) return

      const baseline = anchorRect
      const threshold = calibratedThreshold(requestedThreshold)
      let awaitingBaseline = true
      const observer = new IntersectionObserver((entries) => {
        if (!active || layoutObserver !== observer) return
        const entry = entries.at(-1)
        if (entry === undefined) return
        if (awaitingBaseline) {
          awaitingBaseline = false
          if (!sameAnchorRect(anchor.getBoundingClientRect(), baseline)) {
            scheduleMeasurement()
            return
          }
          const actualThreshold = calibratedThreshold(entry.intersectionRatio)
          if (!calibrated && Math.abs(actualThreshold - threshold) > INTERSECTION_RATIO_TOLERANCE) {
            armLayoutShiftSensor(baseline, actualThreshold, true)
          }
          return
        }
        scheduleMeasurement()
      }, { rootMargin, threshold })
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
