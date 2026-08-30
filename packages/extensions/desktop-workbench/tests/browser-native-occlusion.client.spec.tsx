// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../src/client/index.tsx'
import { BrowserMode } from '../src/client/BrowserMode.tsx'
import { en, NS, type DesktopWorkbenchKey } from '../src/client/locales.ts'

let rafId = 0
let rafCallbacks = new Map<number, FrameRequestCallback>()

function flushAnimationFrame(): void {
  const callbacks = [...rafCallbacks.values()]
  rafCallbacks.clear()
  for (const callback of callbacks) callback(0)
}

const translate: PropsLocale<typeof NS>['t'] = key => Object.hasOwn(en, key)
  ? en[key as DesktopWorkbenchKey]
  : key

function setup() {
  const snapshot = {
    url: 'https://example.test/', title: 'Example', loading: false,
    canGoBack: false, canGoForward: false, error: null,
  }
  const api = {
    showWorkbenchBrowser: vi.fn(async () => snapshot),
    layoutWorkbenchBrowser: vi.fn(async () => {}),
    setWorkbenchBrowserDockVisibility: vi.fn(async () => {}),
    hideWorkbenchBrowser: vi.fn(async () => {}),
    controlWorkbenchBrowser: vi.fn(async () => snapshot),
    onWorkbenchBrowserState: vi.fn(() => () => {}),
    getBrowserTakeoverStatus: vi.fn(async () => ({ phase: 'human' as const, signedInWarning: true as const })),
    onBrowserTakeoverStatus: vi.fn(() => () => {}),
  }
  Object.defineProperty(window, 'dshDesktop', { configurable: true, value: api })
  return api
}

beforeEach(() => {
  rafId = 0
  rafCallbacks = new Map()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    rafId += 1
    rafCallbacks.set(rafId, callback)
    return rafId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafCallbacks.delete(id) })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'elementFromPoint')
  Reflect.deleteProperty(window, 'dshDesktop')
})

describe('native Browser dock occlusion', () => {
  it('hides for every modal layer and restores only after the layer closes', async () => {
    const api = setup()
    render(<BrowserMode t={translate} />)
    const host = document.querySelector<HTMLElement>('[data-native-browser-host]')
    if (host === null) throw new Error('native browser host missing')
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => ({
      x: 800, y: 100, width: 720, height: 700,
      top: 100, right: 1520, bottom: 800, left: 800,
      toJSON: () => ({}),
    }))
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => host),
    })

    await waitFor(() => { expect(api.getBrowserTakeoverStatus).toHaveBeenCalledOnce() })
    await Promise.resolve()
    flushAnimationFrame()
    await waitFor(() => {
      expect(api.setWorkbenchBrowserDockVisibility).toHaveBeenLastCalledWith(true)
      expect(api.showWorkbenchBrowser).toHaveBeenCalledOnce()
    })

    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    flushAnimationFrame()
    await waitFor(() => {
      expect(api.setWorkbenchBrowserDockVisibility).toHaveBeenLastCalledWith(false)
    })

    modal.remove()
    flushAnimationFrame()
    await waitFor(() => {
      expect(api.setWorkbenchBrowserDockVisibility).toHaveBeenLastCalledWith(true)
    })
    expect(api.setWorkbenchBrowserDockVisibility.mock.calls).toEqual([[true], [false], [true]])
  })

  it('hides when another page surface crosses any part of the native host', async () => {
    const api = setup()
    render(<BrowserMode t={translate} />)
    const host = document.querySelector<HTMLElement>('[data-native-browser-host]')
    if (host === null) throw new Error('native browser host missing')
    const overlay = document.createElement('div')
    document.body.append(overlay)
    let top: Element = host
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => ({
      x: 800, y: 100, width: 720, height: 700,
      top: 100, right: 1520, bottom: 800, left: 800,
      toJSON: () => ({}),
    }))
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => top),
    })

    await waitFor(() => { expect(api.getBrowserTakeoverStatus).toHaveBeenCalledOnce() })
    await Promise.resolve()
    flushAnimationFrame()
    await waitFor(() => {
      expect(api.setWorkbenchBrowserDockVisibility).toHaveBeenLastCalledWith(true)
    })

    top = overlay
    flushAnimationFrame()
    await waitFor(() => {
      expect(api.setWorkbenchBrowserDockVisibility).toHaveBeenLastCalledWith(false)
    })

    top = host
    flushAnimationFrame()
    await waitFor(() => {
      expect(api.setWorkbenchBrowserDockVisibility).toHaveBeenLastCalledWith(true)
    })
    overlay.remove()
  })
})
