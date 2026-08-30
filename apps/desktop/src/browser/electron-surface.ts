import { screen, WebContentsView, type BrowserWindow, type Session } from 'electron'
import type { BrowserAdapterWebContents, BrowserViewport } from './cdp-adapter.ts'
import { AgentBrowserError, BROWSER_AGENT_LIMITS } from './contracts.ts'
import { browserZoomFactor } from './layout.ts'
import {
  createBrowserSecurityHandlerOwner,
  type BrowserSecurityHandlerOwner,
} from './policy.ts'
import type {
  BrowserSurfaceResource,
  CreateEphemeralBrowserSurfaceRequest,
} from './surface-manager.ts'

/** Browser resource extension retained only inside Electron main composition. */
export interface ElectronBrowserSurfaceResource extends BrowserSurfaceResource {
  readonly webContents: BrowserAdapterWebContents
  readonly session: Session
  layout(bounds: Electron.Rectangle): void
  setDockVisible(visible: boolean): void
  viewport(): BrowserViewport
}

/** Exact generation resource registry; renderer and protocol payloads never address it. */
export class ElectronBrowserSurfaceRegistry {
  private readonly resources = new Map<string, ElectronBrowserSurfaceResource>()

  register(resource: ElectronBrowserSurfaceResource): () => void {
    if (this.resources.has(resource.surfaceId)) {
      throw new AgentBrowserError('INTERNAL', 'browser surface identity is already registered')
    }
    this.resources.set(resource.surfaceId, resource)
    return () => {
      if (this.resources.get(resource.surfaceId) === resource) this.resources.delete(resource.surfaceId)
    }
  }

  get(surfaceId: string): ElectronBrowserSurfaceResource {
    const resource = this.resources.get(surfaceId)
    if (resource === undefined) throw new AgentBrowserError('STALE_REF', 'browser surface resource is stale')
    return resource
  }

  /** Reflow only resources already mounted by main-process authority. */
  layoutMounted(bounds: Electron.Rectangle): void {
    for (const resource of this.resources.values()) {
      resource.layout(bounds)
      resource.setDockVisible(true)
    }
  }

  /** Hide or reveal only resources with a still-active mount token. */
  setDockVisible(visible: boolean): void {
    for (const resource of this.resources.values()) resource.setDockVisible(visible)
  }
}

function agentNavigationAllowed(value: string): boolean {
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

function viewport(view: WebContentsView, window: BrowserWindow): BrowserViewport {
  const bounds = view.getBounds()
  const scale = screen.getDisplayMatching(window.getBounds()).scaleFactor
  return Object.freeze({
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
    deviceScaleFactor: Number.isFinite(scale) && scale > 0 ? scale : 1,
  })
}

function awaitRendererStartup(load: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.reject(new AgentBrowserError('CANCELLED', 'browser renderer startup was cancelled'))
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: AgentBrowserError): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      if (error === undefined) resolve()
      else reject(error)
    }
    const onAbort = (): void => {
      finish(new AgentBrowserError('CANCELLED', 'browser renderer startup was cancelled'))
    }
    const timeout = setTimeout(() => {
      finish(new AgentBrowserError('TIMEOUT', 'browser renderer startup timed out'))
    }, BROWSER_AGENT_LIMITS.startupMs)
    timeout.unref()
    signal?.addEventListener('abort', onAbort, { once: true })
    void load.then(
      () => { finish() },
      () => { finish(new AgentBrowserError('INTERNAL', 'browser renderer could not be initialized')) },
    )
  })
}

export interface CreateElectronEphemeralSurfaceOptions {
  readonly window: BrowserWindow
  readonly request: CreateEphemeralBrowserSurfaceRequest
  readonly registry: ElectronBrowserSurfaceRegistry
  readonly waitForBounds: (signal?: AbortSignal) => Promise<Electron.Rectangle>
}

/** Create one non-persistent, initially detached Agent WebContentsView owned by a manager generation. */
export function createElectronEphemeralSurface(
  options: CreateElectronEphemeralSurfaceOptions,
): ElectronBrowserSurfaceResource {
  const { request, window } = options
  if (request.partition.startsWith('persist:')) {
    throw new AgentBrowserError('INTERNAL', 'Agent browser partition must be non-persistent')
  }
  const view = new WebContentsView({ webPreferences: {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    partition: request.partition,
  } })
  const session = view.webContents.session
  const owner = createBrowserSecurityHandlerOwner({
    contents: view.webContents,
    session,
    baseWindowOpenHandler: () => ({ action: 'deny' }),
    basePermissionCheckHandler: () => false,
    basePermissionRequestHandler: (_contents, _permission, callback) => { callback(false) },
  })
  let attached = false
  let closed = false
  let mountToken: string | undefined
  let mountActive = false
  let rendererReady: Promise<void> | undefined
  let unregister = (): void => undefined
  const isClosed = (): boolean => closed
  const applyLayout = (bounds: Electron.Rectangle): void => {
    view.setBounds(bounds)
    view.webContents.setZoomFactor(browserZoomFactor(bounds.width))
  }
  const resource: ElectronBrowserSurfaceResource = {
    surfaceId: `agent-browser-${String(view.webContents.id)}-${String(request.generation)}`,
    partition: request.partition,
    kind: 'ephemeral',
    webContents: view.webContents,
    session,
    layout(bounds) {
      if (closed || !attached || mountToken === undefined) return
      applyLayout(bounds)
    },
    setDockVisible(visible) {
      if (closed || !attached) return
      view.setVisible(visible && mountActive)
    },
    viewport: () => viewport(view, window),
    installSecurityHandlers: generation => owner.install({
      generation,
      allowsNavigation: agentNavigationAllowed,
    }),
    async mount(token, signal) {
      if (closed || mountToken !== undefined && mountToken !== token) {
        throw new AgentBrowserError('STALE_REF', 'browser mount token is stale')
      }
      mountToken = token
      const bounds = await options.waitForBounds(signal)
      if (signal?.aborted === true) {
        throw new AgentBrowserError('CANCELLED', 'browser dock wait was cancelled')
      }
      if (isClosed() || view.webContents.isDestroyed()) {
        throw new AgentBrowserError('TARGET_CLOSED', 'browser renderer closed before dock mount')
      }
      if (!attached) {
        window.contentView.addChildView(view)
        attached = true
      }
      applyLayout(bounds)
      mountActive = true
      view.setVisible(true)
      rendererReady ??= awaitRendererStartup(
        view.webContents.loadURL('about:blank').then(() => undefined),
        signal,
      )
      await rendererReady
      if (isClosed() || mountToken !== token || view.webContents.isDestroyed()) {
        throw new AgentBrowserError('TARGET_CLOSED', 'browser renderer closed during initialization')
      }
    },
    hide(token) {
      if (token !== mountToken || closed) return Promise.resolve()
      mountActive = false
      view.setVisible(false)
      return Promise.resolve()
    },
    detachDebugger() {
      // CdpBrowserAdapter is the only owner allowed to detach its debugger.
      return Promise.resolve()
    },
    teardownView() {
      if (closed) return Promise.resolve()
      closed = true
      mountActive = false
      view.setVisible(false)
      if (attached) window.contentView.removeChildView(view)
      attached = false
      unregister()
      view.webContents.close({ waitForBeforeUnload: false })
      return Promise.resolve()
    },
    async clearStorage() {
      await session.clearStorageData()
      await session.clearCache()
      await session.clearAuthCache()
    },
    commitTransfer() { return Promise.resolve() },
    releaseTransfer() { return Promise.resolve() },
  }
  unregister = options.registry.register(resource)
  return resource
}

/** Create a stable single-slot handler owner for a human browser before Agent layers exist. */
export function createHumanBrowserSecurityOwner(
  contents: Electron.WebContents,
  session: Session,
): BrowserSecurityHandlerOwner {
  return createBrowserSecurityHandlerOwner({
    contents,
    session,
    baseWindowOpenHandler: () => ({ action: 'deny' }),
    basePermissionCheckHandler: () => false,
    basePermissionRequestHandler: (_contents, _permission, callback) => { callback(false) },
  })
}

export { agentNavigationAllowed }
