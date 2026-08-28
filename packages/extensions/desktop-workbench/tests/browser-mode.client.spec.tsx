// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {} from '../src/client/index.tsx'
import { BrowserMode } from '../src/client/BrowserMode.tsx'
import { en, type DesktopWorkbenchKey } from '../src/client/locales.ts'

class ResizeObserverStub {
  constructor(private readonly callback: () => void) {}
  observe(): void { this.callback() }
  disconnect(): void {}
}

const snapshot = {
  url: 'https://example.test/', title: 'Example', loading: false,
  canGoBack: false, canGoForward: false, error: null,
}
const translate = (key: DesktopWorkbenchKey): string => en[key]

function setup() {
  let takeoverListener: ((value: { phase: 'human' | 'given' | 'agent' | 'stopping'; signedInWarning: true }) => void) | undefined
  const api = {
    showWorkbenchBrowser: vi.fn(async () => snapshot),
    hideWorkbenchBrowser: vi.fn(async () => {}),
    controlWorkbenchBrowser: vi.fn(async () => snapshot),
    onWorkbenchBrowserState: vi.fn(() => () => {}),
    giveWorkbenchBrowserToAgent: vi.fn(async () => ({ phase: 'given' as const, signedInWarning: true as const })),
    stopAgentBrowser: vi.fn(async () => ({ phase: 'human' as const, signedInWarning: true as const })),
    getBrowserTakeoverStatus: vi.fn(async () => ({ phase: 'human' as const, signedInWarning: true as const })),
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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'dshDesktop')
})

describe('Workbench Browser takeover controls', () => {
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
