import { WebContentsView, type BrowserWindow, type Session } from 'electron'
import {
  normalizeBrowserTarget, type DesktopBrowserBounds, type DesktopBrowserRequest, type DesktopBrowserSnapshot,
} from './contracts.ts'

export class WorkbenchBrowserController {
  private view: WebContentsView | undefined
  private error: string | null = null
  private partition: Session | undefined
  private readonly denyDownload = (event: Electron.Event): void => { event.preventDefault() }

  constructor(
    private readonly window: BrowserWindow,
    private readonly emit: (snapshot: DesktopBrowserSnapshot) => void,
  ) {}

  show(bounds: DesktopBrowserBounds): Promise<DesktopBrowserSnapshot> {
    const view = this.ensureView()
    view.setBounds(this.clip(bounds))
    view.setVisible(true)
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
    view.setVisible(false)
    this.window.contentView.removeChildView(view)
    view.webContents.close({ waitForBeforeUnload: false })
    this.partition?.removeListener('will-download', this.denyDownload)
    this.partition?.setPermissionCheckHandler(null)
    this.partition?.setPermissionRequestHandler(null)
    this.partition = undefined
    this.error = null
    return Promise.resolve()
  }

  private ensureView(): WebContentsView {
    if (this.view !== undefined && !this.view.webContents.isDestroyed()) return this.view
    const view = new WebContentsView({ webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      partition: 'persist:dsh-workbench-browser',
    } })
    this.view = view
    this.window.contentView.addChildView(view)
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
    partition.setPermissionCheckHandler(() => false)
    partition.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    partition.on('will-download', this.denyDownload)
    return view
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
