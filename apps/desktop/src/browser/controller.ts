import { screen, WebContentsView, type BrowserWindow, type Session } from 'electron'
import {
  AgentBrowserError, normalizeBrowserTarget, WORKBENCH_BROWSER_PARTITION,
  type DesktopBrowserBounds, type DesktopBrowserRequest, type DesktopBrowserSnapshot,
} from './contracts.ts'
import type { BrowserPersistentGiveIntent, BrowserPersistentTakeoverSource } from './takeover.ts'
import {
  createHumanBrowserSecurityOwner,
  type ElectronBrowserSurfaceResource,
  type ElectronBrowserSurfaceRegistry,
} from './electron-surface.ts'
import type { BrowserSecurityHandlerOwner } from './policy.ts'

export class WorkbenchBrowserController implements BrowserPersistentTakeoverSource {
  private view: WebContentsView | undefined
  private error: string | null = null
  private partition: Session | undefined
  private securityOwner: BrowserSecurityHandlerOwner | undefined
  private viewGeneration = 0
  private viewIdentity: string | undefined
  private visible = false
  private readonly denyDownload = (event: Electron.Event): void => { event.preventDefault() }

  constructor(
    private readonly window: BrowserWindow,
    private readonly emit: (snapshot: DesktopBrowserSnapshot) => void,
    private readonly registry: ElectronBrowserSurfaceRegistry,
  ) {}

  show(bounds: DesktopBrowserBounds): Promise<DesktopBrowserSnapshot> {
    const view = this.ensureView()
    view.setBounds(this.clip(bounds))
    view.setVisible(true)
    this.visible = true
    return Promise.resolve(this.snapshot())
  }

  async control(request: DesktopBrowserRequest): Promise<DesktopBrowserSnapshot> {
    const contents = this.ensureView().webContents
    if (request.kind === 'navigate') {
      const target = normalizeBrowserTarget(request.value)
      if (target === undefined) throw new Error('Only HTTP(S) addresses are allowed.')
      this.error = null
      await contents.loadURL(target).catch((error: unknown) => {
        this.error = error instanceof Error ? error.message : String(error)
      })
    } else if (request.kind === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
    else if (request.kind === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
    else if (request.kind === 'reload') contents.reload()
    else if (request.kind === 'stop') contents.stop()
    return this.snapshot()
  }

  hide(): Promise<void> {
    const view = this.view
    if (view === undefined) return Promise.resolve()
    this.view = undefined
    this.visible = false
    view.setVisible(false)
    this.window.contentView.removeChildView(view)
    view.webContents.close({ waitForBeforeUnload: false })
    this.partition?.removeListener('will-download', this.denyDownload)
    this.partition?.setPermissionCheckHandler(null)
    this.partition?.setPermissionRequestHandler(null)
    this.partition = undefined
    this.securityOwner = undefined
    this.viewIdentity = undefined
    this.error = null
    return Promise.resolve()
  }

  private ensureView(): WebContentsView {
    if (this.view !== undefined && !this.view.webContents.isDestroyed()) return this.view
    const view = new WebContentsView({ webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      partition: WORKBENCH_BROWSER_PARTITION,
    } })
    this.view = view
    this.viewGeneration += 1
    this.viewIdentity = `workbench-browser-${String(view.webContents.id)}-${String(this.viewGeneration)}`
    this.window.contentView.addChildView(view)
    const guard = (event: Electron.Event, url: string): void => {
      if (normalizeBrowserTarget(url) === undefined) event.preventDefault()
    }
    view.webContents.on('will-navigate', guard)
    view.webContents.on('will-redirect', guard)
    view.webContents.on('did-start-loading', () => { this.publish() })
    view.webContents.on('did-stop-loading', () => { this.publish() })
    view.webContents.on('did-navigate', () => { this.publish() })
    view.webContents.on('page-title-updated', () => { this.publish() })
    view.webContents.on('did-fail-load', (_event, code, message) => {
      if (code !== -3) this.error = message.slice(0, 300)
      this.publish()
    })
    view.webContents.on('render-process-gone', () => {
      this.error = 'Browser renderer stopped.'
      this.publish()
    })
    const partition = view.webContents.session
    this.partition = partition
    this.securityOwner = createHumanBrowserSecurityOwner(view.webContents, partition)
    partition.on('will-download', this.denyDownload)
    return view
  }

  /** Capture only the opaque identity of the exact currently visible persistent human view. */
  captureVisiblePersistentIntent(): BrowserPersistentGiveIntent | undefined {
    const view = this.view
    const instanceId = this.viewIdentity
    if (!this.visible || view === undefined || view.webContents.isDestroyed() || instanceId === undefined) return undefined
    return Object.freeze({ instanceId, generation: this.viewGeneration })
  }

  /** Transfer the exact captured human view without accepting any renderer-selected identity. */
  consumeVisiblePersistentIntent(intent: BrowserPersistentGiveIntent): Promise<ElectronBrowserSurfaceResource> {
    const view = this.view
    const partition = this.partition
    const owner = this.securityOwner
    if (!this.visible || view === undefined || partition === undefined || owner === undefined
      || view.webContents.isDestroyed() || intent.instanceId !== this.viewIdentity
      || intent.generation !== this.viewGeneration) {
      throw new AgentBrowserError('STALE_REF', 'visible persistent browser changed before transfer')
    }
    const surfaceId = intent.instanceId
    this.view = undefined
    this.partition = undefined
    this.securityOwner = undefined
    this.viewIdentity = undefined
    this.visible = false
    const window = this.window
    const denyDownload = this.denyDownload
    let mountToken: string | undefined
    let closed = false
    let unregister = (): void => undefined
    const resource: ElectronBrowserSurfaceResource = {
      surfaceId,
      partition: WORKBENCH_BROWSER_PARTITION,
      kind: 'human-persistent',
      webContents: view.webContents,
      session: partition,
      viewport: () => {
        const bounds = view.getBounds()
        const scale = screen.getDisplayMatching(window.getBounds()).scaleFactor
        return Object.freeze({
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
          deviceScaleFactor: Number.isFinite(scale) && scale > 0 ? scale : 1,
        })
      },
      installSecurityHandlers: generation => owner.install({
        generation,
        allowsNavigation: (value) => {
          try { return new URL(value).protocol === 'https:' } catch { return false }
        },
      }),
      mount(token) {
        if (closed || mountToken !== undefined && mountToken !== token) {
          throw new AgentBrowserError('STALE_REF', 'browser mount token is stale')
        }
        mountToken = token
        view.setVisible(true)
        return Promise.resolve()
      },
      hide(token) {
        if (!closed && token === mountToken) view.setVisible(false)
        return Promise.resolve()
      },
      detachDebugger() {
        // CdpBrowserAdapter is the only owner allowed to detach its debugger.
        return Promise.resolve()
      },
      teardownView() {
        if (closed) return Promise.resolve()
        closed = true
        view.setVisible(false)
        window.contentView.removeChildView(view)
        partition.removeListener('will-download', denyDownload)
        unregister()
        view.webContents.close({ waitForBeforeUnload: false })
        return Promise.resolve()
      },
      async clearStorage() {
        // Persistent human state is intentionally retained across Stop.
      },
    }
    unregister = this.registry.register(resource)
    return Promise.resolve(resource)
  }

  private publish(): void {
    if (this.view !== undefined && !this.view.webContents.isDestroyed()) this.emit(this.snapshot())
  }

  private snapshot(): DesktopBrowserSnapshot {
    const contents = this.view?.webContents
    if (contents === undefined || contents.isDestroyed()) {
      return { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: this.error }
    }
    return {
      url: contents.getURL(), title: contents.getTitle(), loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(), error: this.error,
    }
  }

  private clip(bounds: DesktopBrowserBounds): Electron.Rectangle {
    const area = this.window.getContentBounds()
    const x = Math.max(0, Math.min(Math.round(bounds.x), area.width - 1))
    const y = Math.max(0, Math.min(Math.round(bounds.y), area.height - 1))
    return {
      x, y,
      width: Math.max(1, Math.min(Math.round(bounds.width), area.width - x)),
      height: Math.max(1, Math.min(Math.round(bounds.height), area.height - y)),
    }
  }
}
