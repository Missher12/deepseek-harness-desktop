import { screen, WebContentsView, type BrowserWindow, type Session } from 'electron'
import type { BrowserAdapterWebContents, BrowserViewport } from './cdp-adapter.ts'
import { AgentBrowserError } from './contracts.ts'
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

export interface CreateElectronEphemeralSurfaceOptions {
  readonly window: BrowserWindow
  readonly request: CreateEphemeralBrowserSurfaceRequest
  readonly registry: ElectronBrowserSurfaceRegistry
  readonly bounds: () => Electron.Rectangle
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
  let unregister = (): void => undefined
  const resource: ElectronBrowserSurfaceResource = {
    surfaceId: `agent-browser-${String(view.webContents.id)}-${String(request.generation)}`,
    partition: request.partition,
    kind: 'ephemeral',
    webContents: view.webContents,
    session,
    viewport: () => viewport(view, window),
    installSecurityHandlers: generation => owner.install({
      generation,
      allowsNavigation: agentNavigationAllowed,
    }),
    mount(token) {
      if (closed || mountToken !== undefined && mountToken !== token) {
        throw new AgentBrowserError('STALE_REF', 'browser mount token is stale')
      }
      mountToken = token
      if (!attached) {
        window.contentView.addChildView(view)
        attached = true
      }
      view.setBounds(options.bounds())
      view.setVisible(true)
      return Promise.resolve()
    },
    hide(token) {
      if (token !== mountToken || closed) return Promise.resolve()
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
