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
)

/**
 * Measure an open popup in animation frames and track every geometry source.
 * @param input - Popup refs, open state, and optional initial side preference.
 * @returns The latest placement, or null while closed or awaiting measurement.
 */
export function usePopupPlacement(input: UsePopupPlacementInput): PopupPlacement | null {
  const { anchorRef, popupRef, open, preferred = 'below' } = input
  const [placement, setPlacement] = useState<PopupPlacement | null>(null)
  const currentSideRef = useRef<PopupSide | undefined>(undefined)

  useLayoutEffect(() => {
    if (!open) {
      currentSideRef.current = undefined
      setPlacement(previous => previous === null ? previous : null)
      return
    }

    let animationFrame: number | null = null
    const visualViewport = window.visualViewport
    const measure = (): void => {
      animationFrame = null
      const anchor = anchorRef.current
      const popup = popupRef.current
      if (anchor === null || popup === null) return

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
      setPlacement(previous => samePlacement(previous, next) ? previous : next)
    }
    const scheduleMeasurement = (): void => {
      if (animationFrame !== null) return
      animationFrame = requestAnimationFrame(measure)
    }

    scheduleMeasurement()
    window.addEventListener('resize', scheduleMeasurement)
    window.addEventListener('scroll', scheduleMeasurement, true)
    visualViewport?.addEventListener('resize', scheduleMeasurement)
    visualViewport?.addEventListener('scroll', scheduleMeasurement)
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMeasurement)
    const anchor = anchorRef.current
    const popup = popupRef.current
    if (resizeObserver !== null && anchor !== null && popup !== null) {
      resizeObserver.observe(anchor)
      resizeObserver.observe(popup)
    }

    return () => {
      window.removeEventListener('resize', scheduleMeasurement)
      window.removeEventListener('scroll', scheduleMeasurement, true)
      visualViewport?.removeEventListener('resize', scheduleMeasurement)
      visualViewport?.removeEventListener('scroll', scheduleMeasurement)
      resizeObserver?.disconnect()
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    }
  }, [anchorRef, open, popupRef, preferred])

  return placement
}
