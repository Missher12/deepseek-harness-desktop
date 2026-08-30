// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../src/client/index.tsx'
import { BrowserMode } from '../src/client/BrowserMode.tsx'
import { en, NS, type DesktopWorkbenchKey } from '../src/client/locales.ts'

class ResizeObserverStub {
  constructor(private readonly callback: () => void) {}
  observe(): void { this.callback() }
  disconnect(): void {}
}

let rafId = 0
let rafCallbacks = new Map<number, FrameRequestCallback>()

function flushAnimationFrame(): void {
  const callbacks = [...rafCallbacks.values()]
  rafCallbacks.clear()
  for (const callback of callbacks) callback(0)
}

const snapshot = {
  url: 'https://example.test/', title: 'Example', loading: false,
  canGoBack: false, canGoForward: false, error: null,
}
const translate: PropsLocale<typeof NS>['t'] = key => Object.hasOwn(en, key)
  ? en[key as DesktopWorkbenchKey]
  : key
type TakeoverStatus = Readonly<{
  phase: 'human' | 'given' | 'agent' | 'stopping'
  signedInWarning: true
}>

function setup() {
  let takeoverListener: ((value: TakeoverStatus) => void) | undefined
  const api = {
    showWorkbenchBrowser: vi.fn(async () => snapshot),
    layoutWorkbenchBrowser: vi.fn(async () => {}),
    hideWorkbenchBrowser: vi.fn(async () => {}),
    controlWorkbenchBrowser: vi.fn(async () => snapshot),
    onWorkbenchBrowserState: vi.fn(() => () => {}),
    giveWorkbenchBrowserToAgent: vi.fn(async () => ({ phase: 'given' as const, signedInWarning: true as const })),
    setComputerControlSetting: vi.fn(async () => undefined),
    stopAgentBrowser: vi.fn(async () => ({ phase: 'human' as const, signedInWarning: true as const })),
    getBrowserTakeoverStatus: vi.fn<() => Promise<TakeoverStatus>>(async () => ({
      phase: 'human', signedInWarning: true,
    })),
    onBrowserTakeoverStatus: vi.fn((listener: typeof takeoverListener) => {
      takeoverListener = listener
      return () => { takeoverListener = undefined }
    }),
  }
  Object.defineProperty(window, 'dshDesktop', { configurable: true, value: api })
  return { api, emit: (status: Parameters<NonNullable<typeof takeoverListener>>[0]) => { takeoverListener?.(status) } }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
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
  Reflect.deleteProperty(window, 'dshDesktop')
})

describe('Workbench Browser takeover controls', () => {
  it('sizes the Browser root to the padded utility body and clips the native page host', () => {
    const source = readFileSync(resolve(
      process.cwd(),
      'packages/extensions/desktop-workbench/src/client/BrowserMode.module.css',
    ), 'utf8')

    expect(source).toMatch(/\.browser\s*\{[^}]*height:\s*calc\(100% \+ 36px\)/su)
    expect(source).toMatch(/\.browser\s*\{[^}]*overflow:\s*hidden/su)
    expect(source).toMatch(/\.host\s*\{[^}]*overflow:\s*hidden/su)
  })

  it('resynchronizes native bounds when the host moves without changing size', async () => {
    const { api } = setup()
    render(<BrowserMode t={translate} />)
    const host = document.querySelector<HTMLElement>('[data-native-browser-host]')
    if (host === null) throw new Error('native browser host missing')
    let x = 900
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => ({
      x, y: 120, width: 640, height: 720,
      top: 120, right: x + 640, bottom: 840, left: x,
      toJSON: () => ({}),
    }))

    await waitFor(() => { expect(api.getBrowserTakeoverStatus).toHaveBeenCalledOnce() })
    await Promise.resolve()
    flushAnimationFrame()
    await waitFor(() => {
      expect(api.showWorkbenchBrowser).toHaveBeenLastCalledWith({ x: 900, y: 120, width: 640, height: 720 })
    })

    x = 640
    flushAnimationFrame()
    await waitFor(() => {
      expect(api.showWorkbenchBrowser).toHaveBeenLastCalledWith({ x: 640, y: 120, width: 640, height: 720 })
    })
    expect(api.showWorkbenchBrowser).toHaveBeenCalledTimes(2)
  })

  it('keeps the exact Agent browser fitted while the utility panel is resized', async () => {
    const { api, emit } = setup()
    render(<BrowserMode t={translate} />)
    const host = document.querySelector<HTMLElement>('[data-native-browser-host]')
    if (host === null) throw new Error('native browser host missing')
    let width = 720
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => ({
      x: 800, y: 100, width, height: 700,
      top: 100, right: 800 + width, bottom: 800, left: 800,
      toJSON: () => ({}),
    }))
    await waitFor(() => { expect(api.onBrowserTakeoverStatus).toHaveBeenCalledOnce() })
    emit({ phase: 'agent', signedInWarning: true })
    await screen.findByRole('button', { name: en.browserStopAgent })

    flushAnimationFrame()
    await waitFor(() => {
      expect(api.layoutWorkbenchBrowser).toHaveBeenLastCalledWith({ x: 800, y: 100, width: 720, height: 700 })
    })
    width = 1080
    flushAnimationFrame()
    await waitFor(() => {
      expect(api.layoutWorkbenchBrowser).toHaveBeenLastCalledWith({ x: 800, y: 100, width: 1080, height: 700 })
    })
    expect(api.showWorkbenchBrowser).not.toHaveBeenCalled()
  })

  it('waits for takeover status before choosing the human or Agent layout path', async () => {
    const { api } = setup()
    let resolveStatus: ((status: TakeoverStatus) => void) | undefined
    api.getBrowserTakeoverStatus.mockImplementationOnce(async () => await new Promise((resolve) => {
      resolveStatus = resolve
    }))
    render(<BrowserMode t={translate} />)
    const host = document.querySelector<HTMLElement>('[data-native-browser-host]')
    if (host === null) throw new Error('native browser host missing')
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => ({
      x: 800, y: 100, width: 720, height: 700,
      top: 100, right: 1520, bottom: 800, left: 800,
      toJSON: () => ({}),
    }))

    flushAnimationFrame()
    await Promise.resolve()
    expect(api.showWorkbenchBrowser).not.toHaveBeenCalled()
    expect(api.layoutWorkbenchBrowser).not.toHaveBeenCalled()

    resolveStatus?.({ phase: 'agent', signedInWarning: true })
    await screen.findByRole('button', { name: en.browserStopAgent })
    flushAnimationFrame()
    await waitFor(() => {
      expect(api.layoutWorkbenchBrowser).toHaveBeenCalledWith({ x: 800, y: 100, width: 720, height: 700 })
    })
    expect(api.showWorkbenchBrowser).not.toHaveBeenCalled()
  })

  it('warns about the signed-in persistent browser before recording Give intent', async () => {
    const { api } = setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<BrowserMode t={translate} />)
    const give = await screen.findByRole('button', { name: en.browserGive })

    fireEvent.click(give)
    expect(confirm).toHaveBeenCalledWith(en.browserGiveWarning)
    expect(api.giveWorkbenchBrowserToAgent).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.click(give)
    await waitFor(() => { expect(api.giveWorkbenchBrowserToAgent).toHaveBeenCalledOnce() })
    expect(api.setComputerControlSetting).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: en.browserStopAgent })).toBeDefined()
  })

  it('shows an awaited pending Stop state until main reports cleanup complete', async () => {
    const { api, emit } = setup()
    let finish!: () => void
    api.stopAgentBrowser.mockImplementation(async () => {
      await new Promise<void>((resolve) => { finish = resolve })
      return { phase: 'human', signedInWarning: true }
    })
    render(<BrowserMode t={translate} />)
    await waitFor(() => { expect(api.onBrowserTakeoverStatus).toHaveBeenCalledOnce() })
    emit({ phase: 'agent', signedInWarning: true })
    const stop = await screen.findByRole('button', { name: en.browserStopAgent })

    fireEvent.click(stop)
    const pending = await screen.findByRole('button', { name: en.browserStopping })
    expect(pending).toHaveProperty('disabled', true)
    expect(api.stopAgentBrowser).toHaveBeenCalledOnce()
    finish()
    expect(await screen.findByRole('button', { name: en.browserGive })).toBeDefined()
  })
})
