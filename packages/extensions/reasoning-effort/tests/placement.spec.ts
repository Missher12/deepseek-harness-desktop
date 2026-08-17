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
    })
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

describe('usePopupPlacement', () => {
  it('measures in animation frames and releases every browser resource', () => {
    const anchor = document.createElement('button')
    const popup = document.createElement('div')
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 100, 40) as DOMRect)
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 240, 200) as DOMRect)

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

    const observed: Element[] = []
    const disconnect = vi.fn()
    let notifyResize: ResizeObserverCallback | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { notifyResize = callback }
      observe(element: Element): void { observed.push(element) }
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

    const anchorRef = { current: anchor }
    const popupRef = { current: popup }
    const { result, unmount } = renderHook(() => usePopupPlacement({
      anchorRef,
      popupRef,
      open: true,
    }))

    expect(result.current).toBeNull()
    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(addWindowListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(addWindowListener).toHaveBeenCalledWith('scroll', expect.any(Function), true)
    expect(visualViewport.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(visualViewport.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(observed).toEqual([anchor, popup])

    act(() => {
      const callback = frames.get(1)
      frames.delete(1)
      callback?.(0)
    })
    expect(result.current).toEqual({ side: 'below', top: 148, left: 100, maxHeight: 444 })

    act(() => { notifyResize?.([], {} as ResizeObserver) })
    expect(requestFrame).toHaveBeenCalledTimes(2)
    act(() => {
      const callback = frames.get(2)
      frames.delete(2)
      callback?.(0)
    })
    const visualScroll = visualListeners.get('scroll')?.values().next().value
    act(() => {
      if (typeof visualScroll === 'function') visualScroll(new Event('scroll'))
    })
    expect(requestFrame).toHaveBeenCalledTimes(3)

    const windowResize = addWindowListener.mock.calls.find(([type]) => type === 'resize')?.[1]
    const windowScroll = addWindowListener.mock.calls.find(([type]) => type === 'scroll')?.[1]
    const viewportResize = visualViewport.addEventListener.mock.calls.find(([type]) => type === 'resize')?.[1]
    const viewportScroll = visualViewport.addEventListener.mock.calls.find(([type]) => type === 'scroll')?.[1]
    unmount()

    expect(removeWindowListener).toHaveBeenCalledWith('resize', windowResize)
    expect(removeWindowListener).toHaveBeenCalledWith('scroll', windowScroll, true)
    expect(visualViewport.removeEventListener).toHaveBeenCalledWith('resize', viewportResize)
    expect(visualViewport.removeEventListener).toHaveBeenCalledWith('scroll', viewportScroll)
    expect(disconnect).toHaveBeenCalledOnce()
    expect(cancelFrame).toHaveBeenCalledWith(3)
    expect(frames.size).toBe(0)
  })
})
