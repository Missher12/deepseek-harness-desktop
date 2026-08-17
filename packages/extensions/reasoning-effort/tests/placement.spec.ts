// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  const observed = new Set<Element>()
  const disconnect = vi.fn(() => { observed.clear() })
  let notifyResize: ResizeObserverCallback | undefined
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notifyResize = callback }
    observe(element: Element): void { observed.add(element) }
    disconnect(): void { disconnect() }
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
    if (typeof listener === 'function') listener(new Event(type))
    else listener?.handleEvent(new Event(type))
  }

  return {
    addWindowListener,
    cancelFrame,
    disconnect,
    dispatchVisual,
    flushNextFrame,
    frames,
    notifyResize: (): void => { notifyResize?.([], {} as ResizeObserver) },
    observed,
    removeWindowListener,
    requestFrame,
    visualViewport,
  }
}

describe('usePopupPlacement', () => {
  it('tracks same-size anchor movement on the next open-state frame', () => {
    const browser = installBrowserHarness()
    const anchor = document.createElement('button')
    const popup = document.createElement('div')
    let anchorRect = rect(100, 100, 100, 40)
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => anchorRect as DOMRect)
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 240, 200) as DOMRect)
    const anchorRef = { current: anchor }
    const popupRef = { current: popup }
    const { result, unmount } = renderHook(() => usePopupPlacement({
      anchorRef,
      popupRef,
      open: true,
    }))

    browser.flushNextFrame()
    expect(result.current).toMatchObject({ side: 'below', top: 148, left: 100 })

    anchorRect = rect(240, 160, 100, 40)
    browser.flushNextFrame()
    expect(result.current).toMatchObject({ side: 'below', top: 208, left: 240 })
    expect(browser.frames.size).toBe(1)
    unmount()
  })

  it('recovers from null refs and rebinds observation when current nodes are replaced', () => {
    const browser = installBrowserHarness()
    const firstAnchor = document.createElement('button')
    const firstPopup = document.createElement('div')
    const nextAnchor = document.createElement('button')
    const nextPopup = document.createElement('div')
    vi.spyOn(firstAnchor, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 100, 40) as DOMRect)
    vi.spyOn(firstPopup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 240, 200) as DOMRect)
    vi.spyOn(nextAnchor, 'getBoundingClientRect').mockReturnValue(rect(300, 260, 100, 40) as DOMRect)
    vi.spyOn(nextPopup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 180, 160) as DOMRect)
    const anchorRef = { current: null as HTMLElement | null }
    const popupRef = { current: null as HTMLElement | null }
    const { result, unmount } = renderHook(() => usePopupPlacement({ anchorRef, popupRef, open: true }))

    browser.flushNextFrame()
    expect(result.current).toBeNull()
    expect(browser.observed.size).toBe(0)

    anchorRef.current = firstAnchor
    popupRef.current = firstPopup
    browser.flushNextFrame()
    expect(browser.observed).toEqual(new Set([firstAnchor, firstPopup]))
    expect(result.current).toMatchObject({ top: 148, left: 100 })

    anchorRef.current = nextAnchor
    popupRef.current = nextPopup
    browser.flushNextFrame()
    expect(browser.observed).toEqual(new Set([nextAnchor, nextPopup]))
    expect(browser.observed.has(firstAnchor)).toBe(false)
    expect(browser.observed.has(firstPopup)).toBe(false)
    expect(result.current).toMatchObject({ top: 308, left: 300 })
    expect(browser.frames.size).toBe(1)
    unmount()
  })

  it('coalesces geometry events and releases the single tracking frame and every browser resource', () => {
    const browser = installBrowserHarness()
    const anchor = document.createElement('button')
    const popup = document.createElement('div')
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 100, 40) as DOMRect)
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 240, 200) as DOMRect)
    const anchorRef = { current: anchor }
    const popupRef = { current: popup }
    const { result, unmount } = renderHook(() => usePopupPlacement({ anchorRef, popupRef, open: true }))

    expect(browser.requestFrame).toHaveBeenCalledTimes(1)
    expect(browser.addWindowListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(browser.addWindowListener).toHaveBeenCalledWith('scroll', expect.any(Function), true)
    expect(browser.visualViewport.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(browser.visualViewport.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function))
    browser.flushNextFrame()
    expect(result.current).toEqual({
      side: 'below', top: 148, left: 100, maxHeight: 444, maxWidth: 784,
    })
    expect(browser.observed).toEqual(new Set([anchor, popup]))
    expect(browser.frames.size).toBe(1)
    const stablePlacement = result.current
    browser.flushNextFrame()
    expect(result.current).toBe(stablePlacement)
    expect(browser.frames.size).toBe(1)

    act(() => {
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('scroll'))
      browser.notifyResize()
      browser.dispatchVisual('resize')
      browser.dispatchVisual('scroll')
    })
    expect(browser.requestFrame).toHaveBeenCalledTimes(3)
    expect(browser.frames.size).toBe(1)

    const windowResize = browser.addWindowListener.mock.calls.find(([type]) => type === 'resize')?.[1]
    const windowScroll = browser.addWindowListener.mock.calls.find(([type]) => type === 'scroll')?.[1]
    const viewportResize = browser.visualViewport.addEventListener.mock.calls.find(([type]) => type === 'resize')?.[1]
    const viewportScroll = browser.visualViewport.addEventListener.mock.calls.find(([type]) => type === 'scroll')?.[1]
    const pendingFrame = browser.frames.keys().next().value
    unmount()

    expect(browser.removeWindowListener).toHaveBeenCalledWith('resize', windowResize)
    expect(browser.removeWindowListener).toHaveBeenCalledWith('scroll', windowScroll, true)
    expect(browser.visualViewport.removeEventListener).toHaveBeenCalledWith('resize', viewportResize)
    expect(browser.visualViewport.removeEventListener).toHaveBeenCalledWith('scroll', viewportScroll)
    expect(browser.disconnect).toHaveBeenCalled()
    expect(browser.cancelFrame).toHaveBeenCalledWith(pendingFrame)
    expect(browser.frames.size).toBe(0)
  })
})
