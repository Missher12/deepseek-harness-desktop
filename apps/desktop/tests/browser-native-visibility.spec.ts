import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  class FakeSession {
    on(): void {}
    removeListener(): void {}
    setPermissionCheckHandler(): void {}
    setPermissionRequestHandler(): void {}
    async clearStorageData(): Promise<void> {}
    async clearCache(): Promise<void> {}
    async clearAuthCache(): Promise<void> {}
  }

  class FakeWebContents {
    readonly id: number
    readonly session = new FakeSession()
    readonly navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: vi.fn(),
      goForward: vi.fn(),
    }
    readonly loadURL = vi.fn(async (_url: string) => {})
    readonly reload = vi.fn()
    readonly stop = vi.fn()
    readonly close = vi.fn()
    readonly setZoomFactor = vi.fn()
    constructor(id: number) { this.id = id }
    on(): void {}
    setWindowOpenHandler(): void {}
    isDestroyed(): boolean { return false }
    isLoading(): boolean { return false }
    getURL(): string { return 'https://example.test/' }
    getTitle(): string { return 'Example' }
  }

  class FakeWebContentsView {
    readonly webContents: FakeWebContents
    bounds = { x: 0, y: 0, width: 1, height: 1 }
    visible = false
    constructor() {
      this.webContents = new FakeWebContents(views.length + 1)
      views.push(this)
    }
    setBounds(bounds: typeof this.bounds): void { this.bounds = { ...bounds } }
    getBounds(): typeof this.bounds { return { ...this.bounds } }
    setVisible(visible: boolean): void { this.visible = visible }
  }

  const views: FakeWebContentsView[] = []
  return { FakeWebContentsView, views }
})

vi.mock('electron', () => ({
  WebContentsView: electron.FakeWebContentsView,
  screen: { getDisplayMatching: () => ({ scaleFactor: 2 }) },
}))

import { WorkbenchBrowserController } from '../src/browser/controller.ts'
import {
  createElectronEphemeralSurface,
  ElectronBrowserSurfaceRegistry,
} from '../src/browser/electron-surface.ts'

beforeEach(() => { electron.views.length = 0 })

function fakeWindow() {
  return {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentBounds: () => ({ x: 0, y: 0, width: 1800, height: 1000 }),
    getBounds: () => ({ x: 0, y: 0, width: 1800, height: 1000 }),
  }
}

describe('native Browser dock visibility', () => {
  it('keeps the human browser hidden across show and layout until explicitly restored', async () => {
    const controller = new WorkbenchBrowserController(
      fakeWindow() as never,
      () => {},
      new ElectronBrowserSurfaceRegistry(),
    )

    controller.setDockVisible(false)
    await controller.show({ x: 900, y: 100, width: 800, height: 800 })
    const view = electron.views[0]
    if (view === undefined) throw new Error('expected Workbench browser view')
    expect(view.visible).toBe(false)

    await controller.layout({ x: 700, y: 80, width: 1000, height: 820 })
    expect(view.visible).toBe(false)
    expect(view.bounds).toEqual({ x: 700, y: 80, width: 1000, height: 820 })

    controller.setDockVisible(true)
    expect(view.visible).toBe(true)
  })

  it('suspends the human dock without closing or replacing its page', async () => {
    const controller = new WorkbenchBrowserController(
      fakeWindow() as never,
      () => {},
      new ElectronBrowserSurfaceRegistry(),
    )

    await controller.show({ x: 900, y: 100, width: 800, height: 800 })
    const view = electron.views[0]
    if (view === undefined) throw new Error('expected Workbench browser view')
    await view.webContents.loadURL('https://example.test/preserved')

    controller.suspend()
    expect(view.visible).toBe(false)
    expect(view.webContents.close).not.toHaveBeenCalled()

    controller.setDockVisible(true)
    await controller.show({ x: 700, y: 80, width: 1000, height: 820 })
    expect(electron.views).toEqual([view])
    expect(view.webContents.close).not.toHaveBeenCalled()
  })

  it('retains hidden state when a mounted Agent browser is reflowed', () => {
    const registry = new ElectronBrowserSurfaceRegistry()
    const setDockVisible = vi.fn()
    const layout = vi.fn()
    registry.setDockVisible(false)
    registry.register({
      surfaceId: 'agent-surface',
      partition: 'dsh-agent-browser-test',
      kind: 'ephemeral',
      webContents: {},
      session: {},
      layout,
      setDockVisible,
      viewport: () => ({ width: 1, height: 1, deviceScaleFactor: 1 }),
      installSecurityHandlers: () => ({ dispose() {} }),
      mount: async () => {},
      hide: async () => {},
      detachDebugger: async () => {},
      teardownView: async () => {},
      clearStorage: async () => {},
      commitTransfer: async () => {},
      releaseTransfer: async () => {},
    } as never)

    expect(setDockVisible).toHaveBeenLastCalledWith(false)
    registry.layoutMounted({ x: 600, y: 40, width: 1100, height: 860 })
    expect(layout).toHaveBeenLastCalledWith({ x: 600, y: 40, width: 1100, height: 860 })
    expect(setDockVisible).toHaveBeenLastCalledWith(false)
  })

  it('mounts a new ephemeral browser hidden while a modal owns the page', async () => {
    const registry = new ElectronBrowserSurfaceRegistry()
    registry.setDockVisible(false)
    const resource = createElectronEphemeralSurface({
      window: fakeWindow() as never,
      request: { sessionId: 'session', generation: 1, partition: 'dsh-agent-browser-test' },
      registry,
      waitForBounds: async () => ({ x: 900, y: 100, width: 800, height: 800 }),
    })

    await resource.mount('mount-token')
    const view = electron.views[0]
    if (view === undefined) throw new Error('expected Agent browser view')
    expect(view.visible).toBe(false)

    registry.setDockVisible(true)
    expect(view.visible).toBe(true)
  })
})
