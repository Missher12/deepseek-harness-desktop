import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { placePopup, type PopupPlacement, type PopupSide } from './placement.ts'

/** Reactive inputs for a portaled popup's browser measurements. */
export interface UsePopupPlacementInput {
  readonly anchorRef: RefObject<HTMLElement>
  readonly popupRef: RefObject<HTMLElement>
  readonly open: boolean
  readonly preferred?: PopupSide
}

const samePlacement = (left: PopupPlacement | null, right: PopupPlacement): boolean => (
  left !== null
  && left.side === right.side
  && left.top === right.top
  && left.left === right.left
  && left.maxHeight === right.maxHeight
  && left.maxWidth === right.maxWidth
)

/**
 * Measure an open popup in animation frames and track every geometry source.
 * @param input - Popup refs, open state, and optional initial side preference.
 * @returns The latest placement, or null while closed or awaiting measurement.
 */
export function usePopupPlacement(input: UsePopupPlacementInput): PopupPlacement | null {
  const { anchorRef, popupRef, open, preferred = 'below' } = input
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
    const visualViewport = window.visualViewport
    let resizeObserver: ResizeObserver | null = null
    let observedAnchor: HTMLElement | null = null
    let observedPopup: HTMLElement | null = null

    const syncObserverTargets = (
      anchor: HTMLElement | null,
      popup: HTMLElement | null,
    ): void => {
      if (anchor === observedAnchor && popup === observedPopup) return
      resizeObserver?.disconnect()
      if (resizeObserver !== null) {
        if (anchor !== null) resizeObserver.observe(anchor)
        if (popup !== null) resizeObserver.observe(popup)
      }
      observedAnchor = anchor
      observedPopup = popup
    }
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
    function measure(): void {
      animationFrame = null
      const anchor = anchorRef.current
      const popup = popupRef.current
      syncObserverTargets(anchor, popup)
      if (anchor === null || popup === null) {
        publish(null)
        scheduleMeasurement()
        return
      }

      const currentSide = currentSideRef.current
      const next = placePopup({
        anchor: anchor.getBoundingClientRect(),
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
      scheduleMeasurement()
    }

    resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMeasurement)
    syncObserverTargets(anchorRef.current, popupRef.current)
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
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
        animationFrame = null
      }
    }
  }, [anchorRef, open, popupRef, preferred])

  return placement
}
