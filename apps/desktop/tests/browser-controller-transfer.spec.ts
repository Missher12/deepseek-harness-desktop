import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  class FakeEventEmitter {
    readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    on(event: string, listener: (...args: unknown[]) => void): void {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
    }
    removeListener(event: string, listener: (...args: unknown[]) => void): void {
      this.listeners.get(event)?.delete(listener)
    }
  }

  class FakeSession extends FakeEventEmitter {
    readonly clearStorageData = vi.fn(async () => {})
    readonly clearCache = vi.fn(async () => {})
    readonly clearAuthCache = vi.fn(async () => {})
    permissionCheckHandler: ((...args: unknown[]) => boolean) | null = null
    permissionRequestHandler: ((...args: unknown[]) => void) | null = null
    setPermissionCheckHandler(handler: ((...args: unknown[]) => boolean) | null): void {
      this.permissionCheckHandler = handler
    }
    setPermissionRequestHandler(handler: ((...args: unknown[]) => void) | null): void {
      this.permissionRequestHandler = handler
    }
  }

  class FakeWebContents extends FakeEventEmitter {
    readonly id: number
    readonly session = new FakeSession()
    readonly reload = vi.fn()
    readonly stop = vi.fn()
    readonly loadURL = vi.fn(async (url: string) => { this.url = url })
    readonly close = vi.fn(() => { this.destroyed = true })
    readonly navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: vi.fn(),
      goForward: vi.fn(),
    }
    url = 'https://signed-in.example/account'
    title = 'Signed in account'
    destroyed = false
    windowOpenHandler: ((details: { url: string }) => { action: string }) | undefined
    constructor(id: number) { super(); this.id = id }
    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
      this.windowOpenHandler = handler
    }
    isDestroyed(): boolean { return this.destroyed }
    isLoading(): boolean { return false }
    getURL(): string { return this.url }
    getTitle(): string { return this.title }
  }

  class FakeWebContentsView {
    readonly webContents: FakeWebContents
    bounds = { x: 20, y: 30, width: 640, height: 480 }
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
import { BrowserSurfaceManager } from '../src/browser/surface-manager.ts'

beforeEach(() => { electron.views.length = 0 })

describe('persistent Workbench browser transfer', () => {
  it('starts and awaits an about:blank renderer before an ephemeral mount becomes usable', async () => {
    const added: unknown[] = []
    const window = {
      contentView: {
        addChildView: (view: unknown) => { added.push(view) },
        removeChildView: vi.fn(),
      },
      getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    }
    const resource = createElectronEphemeralSurface({
      window: window as never,
      request: {
        sessionId: 'renderer-ready-session',
        generation: 1,
        partition: 'dsh-agent-browser-1-renderer-ready',
      },
      registry: new ElectronBrowserSurfaceRegistry(),
      bounds: () => ({ x: 10, y: 20, width: 900, height: 600 }),
    })
    const view = electron.views.at(-1)
    if (view === undefined) throw new Error('expected ephemeral view')
    let finishLoad: (() => void) | undefined
    view.webContents.loadURL.mockImplementationOnce(async (url: string) => {
      await new Promise<void>((resolve) => { finishLoad = resolve })
      view.webContents.url = url
    })
    const guards = resource.installSecurityHandlers(1)
    const mounting = resource.mount('mount-token')

    await vi.waitFor(() => { expect(view.webContents.loadURL).toHaveBeenCalledWith('about:blank') })
    expect(added).toEqual([view])
    let settled = false
    void mounting.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    finishLoad?.()
    await mounting
    expect(view.visible).toBe(true)
    guards.dispose()
  })

  it('cancels a stuck renderer mount, releases the pending generation, and permits a fresh acquire', async () => {
    const removed: unknown[] = []
    const window = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: (view: unknown) => { removed.push(view) },
      },
      getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    }
    const registry = new ElectronBrowserSurfaceRegistry()
    let creation = 0
    const manager = new BrowserSurfaceManager({
      coordinator: {
        consumeVerifiedPersistentGiveIntent: async () => undefined,
        revoke: async () => false,
        release: async () => {},
      },
      createNonce: () => `renderer-${String(creation)}`,
      createMountToken: generation => `mount-${String(generation)}`,
      createEphemeral: async (request) => {
        creation += 1
        const resource = createElectronEphemeralSurface({
          window: window as never,
          request,
          registry,
          bounds: () => ({ x: 10, y: 20, width: 900, height: 600 }),
        })
        if (creation === 1) {
          electron.views.at(-1)?.webContents.loadURL.mockImplementationOnce(
            () => new Promise<void>(() => {}),
          )
        }
        return resource
      },
    })
    const controller = new AbortController()
    const first = manager.acquire({ sessionId: 'renderer-abort-session', signal: controller.signal })

    await vi.waitFor(() => {
      expect(electron.views[0]?.webContents.loadURL).toHaveBeenCalledWith('about:blank')
    })
    controller.abort()
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(electron.views[0]?.webContents.close).toHaveBeenCalledOnce()
    expect(removed).toEqual([electron.views[0]])

    await expect(manager.acquire({ sessionId: 'renderer-abort-session' })).resolves.toMatchObject({
      generation: 2,
      visible: true,
    })
  })

  it('bounds a renderer that never becomes ready to the shared startup deadline', async () => {
    vi.useFakeTimers()
    try {
      const window = {
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
        getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      }
      const resource = createElectronEphemeralSurface({
        window: window as never,
        request: {
          sessionId: 'renderer-timeout-session',
          generation: 1,
          partition: 'dsh-agent-browser-1-renderer-timeout',
        },
        registry: new ElectronBrowserSurfaceRegistry(),
        bounds: () => ({ x: 10, y: 20, width: 900, height: 600 }),
      })
      electron.views.at(-1)?.webContents.loadURL.mockImplementationOnce(
        () => new Promise<void>(() => {}),
      )
      const mounting = resource.mount('mount-timeout')
      const rejected = expect(mounting).rejects.toMatchObject({ code: 'TIMEOUT' })

      await vi.advanceTimersByTimeAsync(9_999)
      await expect(Promise.race([
        mounting.then(() => 'settled', () => 'settled'),
        Promise.resolve('pending'),
      ])).resolves.toBe('pending')
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      await resource.teardownView()
    } finally {
      vi.useRealTimers()
    }
  })

  it('blocks renderer operations and restores the exact reserved tab when mount fails before commit', async () => {
    const added: unknown[] = []
    const removed: unknown[] = []
    const window = {
      contentView: {
        addChildView: (view: unknown) => { added.push(view) },
        removeChildView: (view: unknown) => { removed.push(view) },
      },
      getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    }
    const registry = new ElectronBrowserSurfaceRegistry()
    const controller = new WorkbenchBrowserController(window as never, () => {}, registry)
    const originalBounds = { x: 20, y: 30, width: 640, height: 480 }
    await controller.show(originalBounds)
    const view = electron.views[0]
    if (view === undefined) throw new Error('expected Workbench view')
    const intent = controller.captureVisiblePersistentIntent()
    if (intent === undefined) throw new Error('expected visible transfer intent')

    const reserved = await controller.consumeVisiblePersistentIntent(intent)
    await expect(controller.show({ x: 0, y: 0, width: 100, height: 100 }))
      .rejects.toMatchObject({ code: 'BUSY' })
    await expect(controller.control({ kind: 'reload' })).rejects.toMatchObject({ code: 'BUSY' })
    await expect(controller.hide()).rejects.toMatchObject({ code: 'BUSY' })
    expect(electron.views).toHaveLength(1)
    expect(view.bounds).toEqual(originalBounds)
    expect(view.webContents.reload).not.toHaveBeenCalled()

    await reserved.teardownView()
    await expect(controller.control({ kind: 'reload' })).rejects.toMatchObject({ code: 'BUSY' })
    await reserved.releaseTransfer()

    expect(controller.captureVisiblePersistentIntent()).toEqual(intent)
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(view.visible).toBe(true)
    expect(view.webContents.getURL()).toBe('https://signed-in.example/account')
    expect(view.webContents.getTitle()).toBe('Signed in account')
    expect(removed).toEqual([])
    expect(added).toHaveLength(1)
    await expect(controller.control({ kind: 'reload' })).resolves.toMatchObject({
      url: 'https://signed-in.example/account', title: 'Signed in account',
    })
    expect(view.webContents.reload).toHaveBeenCalledOnce()
  })

  it('keeps renderer operations blocked after commit until exact cleanup releases the view', async () => {
    const window = {
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
      getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    }
    const controller = new WorkbenchBrowserController(
      window as never,
      () => {},
      new ElectronBrowserSurfaceRegistry(),
    )
    await controller.show({ x: 10, y: 10, width: 700, height: 500 })
    const intent = controller.captureVisiblePersistentIntent()
    if (intent === undefined) throw new Error('expected visible transfer intent')
    const transferred = await controller.consumeVisiblePersistentIntent(intent)

    await transferred.mount('main-owned-token')
    await transferred.commitTransfer()
    await expect(controller.control({ kind: 'back' })).rejects.toMatchObject({ code: 'BUSY' })
    await expect(controller.hide()).rejects.toMatchObject({ code: 'BUSY' })

    await transferred.teardownView()
    await expect(controller.hide()).rejects.toMatchObject({ code: 'BUSY' })
    await transferred.releaseTransfer()
    await expect(controller.hide()).resolves.toBeUndefined()
  })
})
