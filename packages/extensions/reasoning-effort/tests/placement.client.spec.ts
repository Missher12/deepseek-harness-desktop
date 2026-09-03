// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest'
import { placePopup, type PlacementRect, type PopupViewport } from '../src/client/placement.ts'
import { usePopupPlacement } from '../src/client/use-popup-placement.ts'

const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
): PlacementRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
})

const viewport = (
  width: number,
  height: number,
  offsetLeft = 0,
  offsetTop = 0,
): PopupViewport => ({ width, height, offsetLeft, offsetTop })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('placePopup', () => {
  it('places the popup below by default when the full popup fits', () => {
    expect(placePopup({
      anchor: rect(100, 100, 100, 40),
      popup: rect(0, 0, 240, 200),
      viewport: viewport(800, 600),
    })).toEqual({
      side: 'below',
      top: 148,
      left: 100,
      maxHeight: 444,
      maxWidth: 784,
    })
  })

  it('flips above when below is constrained and above fits completely', () => {
    expect(placePopup({
      anchor: rect(100, 520, 100, 40),
      popup: rect(0, 0, 240, 200),
      viewport: viewport(800, 600),
      preferred: 'below',
    })).toEqual({
      side: 'above',
      top: 312,
      left: 100,
      maxHeight: 504,
      maxWidth: 784,
    })
  })

  it('uses the side with more space and constrains height when neither side fits', () => {
    expect(placePopup({
      anchor: rect(100, 190, 100, 40),
      popup: rect(0, 0, 240, 300),
      viewport: viewport(800, 400),
    })).toEqual({
      side: 'above',
      top: 8,
      left: 100,
      maxHeight: 174,
      maxWidth: 784,
    })
  })

  it.each([
    ['left', -20, 48],
    ['right', 300, 172],
  ])('clamps an overflowing %s edge to the visual viewport margin', (_edge, anchorLeft, expectedLeft) => {
    expect(placePopup({
      anchor: rect(anchorLeft, 160, 40, 32),
      popup: rect(0, 0, 160, 120),
      viewport: viewport(300, 500, 40, 100),
    }).left).toBe(expectedLeft)
  })

  it('accounts for non-zero visual viewport offsets on both axes', () => {
    expect(placePopup({
      anchor: rect(30, 250, 100, 40),
      popup: rect(0, 0, 200, 100),
      viewport: viewport(500, 400, 50, 100),
    })).toEqual({
      side: 'below',
      top: 298,
      left: 58,
      maxHeight: 194,
      maxWidth: 484,
    })
  })

  it('caps an oversized popup to the offset visual viewport and clamps its effective box', () => {
    const placement = placePopup({
      anchor: rect(360, 160, 40, 32),
      popup: rect(0, 0, 500, 120),
      viewport: viewport(300, 500, 40, 100),
    })

    expect(placement).toMatchObject({ left: 48, maxWidth: 284 })
    expect(placement.left + Math.min(500, placement.maxWidth)).toBe(332)
  })

  it('retains the current side while it has 120 pixels of usable height', () => {
    const stable = placePopup({
      anchor: rect(100, 160, 100, 40),
      popup: rect(0, 0, 240, 300),
      viewport: viewport(800, 600),
      preferred: 'below',
      currentSide: 'above',
    })
    const released = placePopup({
      anchor: rect(100, 130, 100, 40),
      popup: rect(0, 0, 240, 300),
      viewport: viewport(800, 600),
      preferred: 'below',
      currentSide: 'above',
    })

    expect(stable).toMatchObject({ side: 'above', top: 8, maxHeight: 144 })
    expect(released.side).toBe('below')
  })
})

interface ResizeObserverRecord {
  readonly callback: ResizeObserverCallback
  readonly observed: Set<Element>
  readonly disconnect: Mock<() => void>
}

interface IntersectionObserverRecord {
  readonly callback: IntersectionObserverCallback
  readonly observed: Set<Element>
  readonly disconnect: Mock<() => void>
  readonly options: IntersectionObserverInit | undefined
}

const invokeListener = (
  listener: EventListenerOrEventListenerObject | undefined,
  event: Event,
): void => {
  if (typeof listener === 'function') listener(event)
  else listener?.handleEvent(event)
}

function installBrowserHarness() {
  const visualListeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  const visualViewport = {
    width: 800,
    height: 600,
    offsetLeft: 0,
    offsetTop: 0,
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      const listeners = visualListeners.get(type) ?? new Set()
      listeners.add(listener)
      visualListeners.set(type, listeners)
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      visualListeners.get(type)?.delete(listener)
    }),
  }
  vi.stubGlobal('visualViewport', visualViewport)

  const resizeObservers: ResizeObserverRecord[] = []
  vi.stubGlobal('ResizeObserver', class {
    readonly record: ResizeObserverRecord
    constructor(callback: ResizeObserverCallback) {
      const observed = new Set<Element>()
      this.record = {
        callback,
        observed,
        disconnect: vi.fn(() => { observed.clear() }),
      }
      resizeObservers.push(this.record)
    }
    observe(element: Element): void { this.record.observed.add(element) }
    disconnect(): void { this.record.disconnect() }
  })

  const intersectionObservers: IntersectionObserverRecord[] = []
  vi.stubGlobal('IntersectionObserver', class {
    readonly record: IntersectionObserverRecord
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      const observed = new Set<Element>()
      this.record = {
        callback,
        observed,
        disconnect: vi.fn(() => { observed.clear() }),
        options,
      }
      intersectionObservers.push(this.record)
    }
    observe(element: Element): void { this.record.observed.add(element) }
    disconnect(): void { this.record.disconnect() }
  })

  let nextFrame = 1
  const frames = new Map<number, FrameRequestCallback>()
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, callback)
    return id
  })
  const cancelFrame = vi.fn((id: number) => { frames.delete(id) })
  vi.stubGlobal('requestAnimationFrame', requestFrame)
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)
  const addWindowListener = vi.spyOn(window, 'addEventListener')
  const removeWindowListener = vi.spyOn(window, 'removeEventListener')

  const flushNextFrame = (): number => {
    const next = frames.entries().next()
    if (next.done) throw new Error('Expected a pending animation frame')
    const [id, callback] = next.value
    frames.delete(id)
    act(() => { callback(0) })
    return id
  }
  const dispatchVisual = (type: string): void => {
    const listener = visualListeners.get(type)?.values().next().value
    invokeListener(listener, new Event(type))
  }
  const latestResizeObserver = (): ResizeObserverRecord | undefined => resizeObservers.at(-1)
  const latestIntersectionObserver = (): IntersectionObserverRecord | undefined => intersectionObservers.at(-1)
  const notifyResize = (record = latestResizeObserver()): void => {
    record?.callback([], {} as ResizeObserver)
  }
  const notifyLayoutShift = (record = latestIntersectionObserver(), intersectionRatio = 1): void => {
    record?.callback([{ intersectionRatio } as IntersectionObserverEntry], {} as IntersectionObserver)
  }

  return {
    addWindowListener,
    cancelFrame,
    dispatchVisual,
    flushNextFrame,
    frames,
    intersectionObservers,
    latestIntersectionObserver,
    latestResizeObserver,
    notifyLayoutShift,
    notifyResize,
    removeWindowListener,
    requestFrame,
    resizeObservers,
    visualViewport,
    visualListener: (type: string): EventListenerOrEventListenerObject | undefined => (
      visualListeners.get(type)?.values().next().value
    ),
  }
}

const fullAnchorRootMargin = (anchor: PlacementRect): string => (
  `${-anchor.top}px ${-(window.innerWidth - anchor.right)}px ${-(window.innerHeight - anchor.bottom)}px ${-anchor.left}px`
)

describe('usePopupPlacement', () => {
  it('stays idle after initial measurement and coalesces a burst of geometry events', () => {
    const browser = installBrowserHarness()
    const anchor = document.createElement('button')
    const popup = document.createElement('div')
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 100, 40) as DOMRect)
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 240, 200) as DOMRect)
    const { result, unmount } = renderHook(() => usePopupPlacement({ anchor, popup, open: true }))

    expect(browser.requestFrame).toHaveBeenCalledTimes(1)
    browser.flushNextFrame()
    expect(result.current).toEqual({
      side: 'below', top: 148, left: 100, maxHeight: 444, maxWidth: 784,
    })
    expect(browser.frames.size).toBe(0)
    expect(browser.latestResizeObserver()?.observed).toEqual(new Set([anchor, popup]))
    const layoutObserver = browser.latestIntersectionObserver()
    expect(layoutObserver?.observed).toEqual(new Set([anchor]))
    expect(layoutObserver?.options?.threshold).toBe(1)
    const stablePlacement = result.current

    act(() => { browser.notifyLayoutShift(layoutObserver) })
    expect(browser.frames.size).toBe(0)

    act(() => {
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('scroll'))
      browser.notifyResize()
      browser.dispatchVisual('resize')
      browser.dispatchVisual('scroll')
    })
    expect(browser.requestFrame).toHaveBeenCalledTimes(2)
    expect(browser.frames.size).toBe(1)
    browser.flushNextFrame()
    expect(result.current).toBe(stablePlacement)
    expect(browser.frames.size).toBe(0)
    unmount()
  })

  it.each([
    ['left', -20, 100, 100, 40],
    ['top', 100, -20, 100, 40],
    ['right', window.innerWidth - 80, 100, 100, 40],
    ['bottom', 100, window.innerHeight - 20, 100, 40],
  ])('preserves the full anchor rectangle when it is clipped at the %s edge', (
    _edge,
    left,
    top,
    width,
    height,
  ) => {
    const browser = installBrowserHarness()
    const anchor = document.createElement('button')
    const popup = document.createElement('div')
    const anchorRect = rect(left, top, width, height)
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(anchorRect as DOMRect)
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 240, 200) as DOMRect)
    const { unmount } = renderHook(() => usePopupPlacement({ anchor, popup, open: true }))

    browser.flushNextFrame()
    expect(browser.latestIntersectionObserver()?.options?.rootMargin).toBe(fullAnchorRootMargin(anchorRect))
    expect(browser.frames.size).toBe(0)
    unmount()
  })

  it('detects same-size movement from a partially offscreen anchor without polling', () => {
    const browser = installBrowserHarness()
    const anchor = document.createElement('button')
    const popup = document.createElement('div')
    let anchorRect = rect(-20, 100, 100, 40)
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => anchorRect as DOMRect)
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 240, 200) as DOMRect)
    const { result, unmount } = renderHook(() => usePopupPlacement({ anchor, popup, open: true }))

    browser.flushNextFrame()
    const partiallyOffscreenSensor = browser.latestIntersectionObserver()
    expect(partiallyOffscreenSensor?.options?.rootMargin).toBe(fullAnchorRootMargin(anchorRect))
    expect(partiallyOffscreenSensor?.options?.rootMargin).toMatch(/ 20px$/)
    act(() => { browser.notifyLayoutShift(partiallyOffscreenSensor) })
    expect(browser.frames.size).toBe(0)

    anchorRect = rect(20, 100, 100, 40)
    act(() => {
      browser.notifyLayoutShift(partiallyOffscreenSensor)
      browser.notifyLayoutShift(partiallyOffscreenSensor)
    })
    expect(browser.frames.size).toBe(1)
    browser.flushNextFrame()
    expect(result.current).toMatchObject({ left: 20, top: 148 })
    expect(browser.frames.size).toBe(0)
    unmount()
  })

  it('keeps required event tracking when IntersectionObserver is unavailable', () => {
    const browser = installBrowserHarness()
    vi.stubGlobal('IntersectionObserver', undefined)
    const anchor = document.createElement('button')
    const popup = document.createElement('div')
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 100, 40) as DOMRect)
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 240, 200) as DOMRect)
    const { result, unmount } = renderHook(() => usePopupPlacement({ anchor, popup, open: true }))

    browser.flushNextFrame()
    expect(result.current).toMatchObject({ top: 148, left: 100 })
    expect(browser.intersectionObservers).toHaveLength(0)
    expect(browser.frames.size).toBe(0)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(browser.frames.size).toBe(1)
    browser.flushNextFrame()
    expect(browser.frames.size).toBe(0)
    unmount()
  })

  it('calibrates fractional baselines before rearming later layout shifts', () => {
    const browser = installBrowserHarness()
    const anchor = document.createElement('button')
    const popup = document.createElement('div')
    let anchorRect = rect(100, 100, 100, 40)
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => anchorRect as DOMRect)
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 240, 200) as DOMRect)
    const { result, unmount } = renderHook(() => usePopupPlacement({ anchor, popup, open: true }))

    browser.flushNextFrame()
    const armedAtInitialRect = browser.latestIntersectionObserver()
    expect(armedAtInitialRect?.options?.threshold).toBe(1)
    expect(browser.frames.size).toBe(0)
    act(() => { browser.notifyLayoutShift(armedAtInitialRect, 1) })
    expect(browser.frames.size).toBe(0)

    anchorRect = rect(100.5, 100, 100, 40)
    act(() => {
      browser.notifyLayoutShift(armedAtInitialRect, 0.995)
      browser.notifyLayoutShift(armedAtInitialRect, 0.995)
    })
    expect(browser.frames.size).toBe(1)
    browser.flushNextFrame()
    expect(result.current).toMatchObject({ side: 'below', top: 148, left: 100.5 })
    expect(browser.frames.size).toBe(0)
    expect(armedAtInitialRect?.observed.size).toBe(0)
    const quantizedAtHalfPixel = browser.latestIntersectionObserver()
    expect(quantizedAtHalfPixel?.options?.threshold).toBe(1)
    expect(quantizedAtHalfPixel?.observed).toEqual(new Set([anchor]))

    act(() => { browser.notifyLayoutShift(armedAtInitialRect) })
    expect(browser.frames.size).toBe(0)
    act(() => { browser.notifyLayoutShift(quantizedAtHalfPixel, 0.99) })
    expect(browser.frames.size).toBe(0)
    expect(quantizedAtHalfPixel?.observed.size).toBe(0)
    const calibratedAtHalfPixel = browser.latestIntersectionObserver()
    expect(calibratedAtHalfPixel).not.toBe(quantizedAtHalfPixel)
    expect(calibratedAtHalfPixel?.options?.threshold).toBeCloseTo(0.99)
    expect(calibratedAtHalfPixel?.observed).toEqual(new Set([anchor]))
    act(() => { browser.notifyLayoutShift(calibratedAtHalfPixel, 0.99) })
    expect(browser.frames.size).toBe(0)

    anchorRect = rect(110.5, 100, 100, 40)
    act(() => { browser.notifyLayoutShift(calibratedAtHalfPixel, 0.9) })
    expect(browser.frames.size).toBe(1)
    browser.flushNextFrame()
    expect(result.current).toMatchObject({ side: 'below', top: 148, left: 110.5 })
    expect(browser.frames.size).toBe(0)

    const movedBeforeBaseline = browser.latestIntersectionObserver()
    expect(movedBeforeBaseline?.options?.threshold).toBe(1)
    anchorRect = rect(120.5, 100, 100, 40)
    act(() => { browser.notifyLayoutShift(movedBeforeBaseline, 0.9) })
    expect(browser.frames.size).toBe(1)
    browser.flushNextFrame()
    expect(result.current).toMatchObject({ side: 'below', top: 148, left: 120.5 })
    expect(browser.frames.size).toBe(0)
    act(() => {
      browser.notifyLayoutShift(quantizedAtHalfPixel, 0.9)
      browser.notifyLayoutShift(calibratedAtHalfPixel, 0.9)
    })
    expect(browser.frames.size).toBe(0)
    unmount()
  })

  it('rebinds both observers when actual node inputs appear and are replaced', () => {
    const browser = installBrowserHarness()
    const firstAnchor = document.createElement('button')
    const firstPopup = document.createElement('div')
    const nextAnchor = document.createElement('button')
    const nextPopup = document.createElement('div')
    vi.spyOn(firstAnchor, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 100, 40) as DOMRect)
    vi.spyOn(firstPopup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 240, 200) as DOMRect)
    vi.spyOn(nextAnchor, 'getBoundingClientRect').mockReturnValue(rect(300, 260, 100, 40) as DOMRect)
    vi.spyOn(nextPopup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 180, 160) as DOMRect)
    interface HookProps {
      readonly anchor: HTMLElement | null
      readonly popup: HTMLElement | null
      readonly open: boolean
    }
    const initialProps: HookProps = { anchor: null, popup: null, open: true }
    const { result, rerender, unmount } = renderHook(
      (props: HookProps) => usePopupPlacement(props),
      { initialProps },
    )

    browser.flushNextFrame()
    expect(result.current).toBeNull()
    expect(browser.latestResizeObserver()?.observed.size).toBe(0)
    expect(browser.latestIntersectionObserver()).toBeUndefined()

    const nullResizeObserver = browser.latestResizeObserver()
    rerender({ anchor: firstAnchor, popup: firstPopup, open: true })
    expect(nullResizeObserver?.observed.size).toBe(0)
    expect(browser.latestResizeObserver()?.observed).toEqual(new Set([firstAnchor, firstPopup]))
    browser.flushNextFrame()
    expect(result.current).toMatchObject({ top: 148, left: 100 })
    const firstResizeObserver = browser.latestResizeObserver()
    const firstLayoutObserver = browser.latestIntersectionObserver()
    expect(firstLayoutObserver?.observed).toEqual(new Set([firstAnchor]))

    rerender({ anchor: nextAnchor, popup: nextPopup, open: true })
    expect(firstResizeObserver?.observed.size).toBe(0)
    expect(firstLayoutObserver?.observed.size).toBe(0)
    expect(browser.latestResizeObserver()?.observed).toEqual(new Set([nextAnchor, nextPopup]))
    browser.flushNextFrame()
    expect(result.current).toMatchObject({ top: 308, left: 300 })
    expect(browser.latestIntersectionObserver()?.observed).toEqual(new Set([nextAnchor]))
    expect(browser.frames.size).toBe(0)
    unmount()
  })

  it('disconnects exactly on close and unmount, and stale callbacks stay inert', () => {
    const browser = installBrowserHarness()
    const anchor = document.createElement('button')
    const popup = document.createElement('div')
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 100, 40) as DOMRect)
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 240, 200) as DOMRect)
    const { rerender, unmount } = renderHook(
      ({ open }: { open: boolean }) => usePopupPlacement({ anchor, popup, open }),
      { initialProps: { open: true } },
    )

    browser.flushNextFrame()
    const closeResizeObserver = browser.latestResizeObserver()
    const closeLayoutObserver = browser.latestIntersectionObserver()
    const staleWindowResize = browser.addWindowListener.mock.calls.find(([type]) => type === 'resize')?.[1]
    const staleWindowScroll = browser.addWindowListener.mock.calls.find(([type]) => type === 'scroll')?.[1]
    const staleVisualResize = browser.visualListener('resize')
    const staleVisualScroll = browser.visualListener('scroll')
    const resizeDisconnectsBeforeClose = closeResizeObserver?.disconnect.mock.calls.length ?? 0
    const layoutDisconnectsBeforeClose = closeLayoutObserver?.disconnect.mock.calls.length ?? 0
    rerender({ open: false })

    expect(closeResizeObserver?.disconnect).toHaveBeenCalledTimes(resizeDisconnectsBeforeClose + 1)
    expect(closeLayoutObserver?.disconnect).toHaveBeenCalledTimes(layoutDisconnectsBeforeClose + 1)
    expect(closeResizeObserver?.observed.size).toBe(0)
    expect(closeLayoutObserver?.observed.size).toBe(0)
    expect(browser.removeWindowListener).toHaveBeenCalledWith('resize', staleWindowResize)
    expect(browser.removeWindowListener).toHaveBeenCalledWith('scroll', staleWindowScroll, true)
    expect(browser.visualViewport.removeEventListener).toHaveBeenCalledWith('resize', staleVisualResize)
    expect(browser.visualViewport.removeEventListener).toHaveBeenCalledWith('scroll', staleVisualScroll)
    expect(browser.frames.size).toBe(0)
    act(() => {
      browser.notifyResize(closeResizeObserver)
      browser.notifyLayoutShift(closeLayoutObserver)
      invokeListener(staleWindowResize, new Event('resize'))
      invokeListener(staleVisualScroll, new Event('scroll'))
    })
    expect(browser.frames.size).toBe(0)

    rerender({ open: true })
    browser.flushNextFrame()
    const unmountResizeObserver = browser.latestResizeObserver()
    const unmountLayoutObserver = browser.latestIntersectionObserver()
    const resizeDisconnectsBeforeUnmount = unmountResizeObserver?.disconnect.mock.calls.length ?? 0
    const layoutDisconnectsBeforeUnmount = unmountLayoutObserver?.disconnect.mock.calls.length ?? 0
    act(() => { window.dispatchEvent(new Event('resize')) })
    const pendingFrame = browser.frames.keys().next().value
    unmount()

    expect(unmountResizeObserver?.disconnect).toHaveBeenCalledTimes(resizeDisconnectsBeforeUnmount + 1)
    expect(unmountLayoutObserver?.disconnect).toHaveBeenCalledTimes(layoutDisconnectsBeforeUnmount + 1)
    expect(unmountResizeObserver?.observed.size).toBe(0)
    expect(unmountLayoutObserver?.observed.size).toBe(0)
    expect(browser.cancelFrame).toHaveBeenCalledWith(pendingFrame)
    expect(browser.frames.size).toBe(0)
    act(() => {
      browser.notifyResize(unmountResizeObserver)
      browser.notifyLayoutShift(unmountLayoutObserver)
    })
    expect(browser.frames.size).toBe(0)
  })
})
