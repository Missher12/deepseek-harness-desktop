import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  Tray,
  screen,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SessionId } from '@deepseek-ai/dsh-desktop-control-protocol'
import { healProfilesModuleFallbackCached } from '@deepseek-ai/dsh-app-boot'
import {
  DesktopApplication,
  type AppFacade,
  type DesktopWindow,
  type FailureReason,
} from './application.ts'
import { HarnessProcess } from './harness/process.ts'
import { findConflictingHarness } from './harness/ownership.ts'
import { createLifecycleLogger } from './logging.ts'
import {
  isDesktopPreferenceMutation,
  isRecoveryAction,
  supportsDesktopUpdates,
  type DesktopCommand,
  type DesktopPreferenceMutation,
} from './preload-api.ts'
import {
  defaultDesktopPreferences,
  readDesktopPreferences,
  writeDesktopPreferences,
  type DesktopPreferencesSnapshot,
} from './preferences.ts'
import { DesktopUpdateService } from './update/service.ts'
import { WorkbenchBrowserController } from './browser/controller.ts'
import {
  AgentBrowserError,
  isDesktopBrowserBounds,
  isDesktopBrowserRequest,
  type DesktopBrowserBounds,
} from './browser/contracts.ts'
import { CdpBrowserAdapter } from './browser/cdp-adapter.ts'
import { AgentBrowserUrlPolicy } from './browser/policy.ts'
import { BrowserSurfaceManager } from './browser/surface-manager.ts'
import { BrowserDesktopControlAdapter } from './browser/control-adapter.ts'
import { LoopbackPinnedNavigationTransport } from './browser/pinned-transport.ts'
import {
  createElectronEphemeralSurface,
  ElectronBrowserSurfaceRegistry,
} from './browser/electron-surface.ts'
import { BrowserTakeoverAuthority, installBrowserTakeoverIpc } from './browser/takeover.ts'
import { launchDesktopInstaller } from './update/installer.ts'
import { allowRendererPermission, classifyNavigation } from './window/navigation.ts'
import { createMenuTemplate } from './window/menu.ts'
import { createWindowOptions, desktopRendererUrl } from './window/options.ts'
import { desktopPlatformBehavior } from './window/platform.ts'
import { readWindowBounds, writeWindowBounds } from './window/state.ts'
import { readDesktopWindowPrerequisites } from './window/prerequisites.ts'
import { DesktopStartupTimeline } from './startup-timeline.ts'
import {
  DesktopControlBridgeServer,
} from './control/bridge-server.ts'
import { DesktopControlCoordinator } from './control/control-coordinator.ts'
import {
  DEFAULT_CONTROL_SETTINGS,
  readControlSettings,
  type ControlSettings,
} from './control/settings-store.ts'
import type {
  NativeApprovalDialogOptions,
} from './control/native-approval.ts'
import {
  ControlAuditLog,
  loadOrCreateControlAuditSalt,
} from './control/audit.ts'

const PRODUCT_NAME = 'DeepSeek Harness'
const require = createRequire(import.meta.url)
const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const loadingPath = fileURLToPath(new URL('../renderer/loading.html', import.meta.url))
const failurePath = fileURLToPath(new URL('../renderer/failure.html', import.meta.url))
const iconPath = fileURLToPath(new URL('../assets/icon-source.png', import.meta.url))
const desktopPatchPath = fileURLToPath(new URL('../desktop.cordis.patch.yml', import.meta.url))
const desktopInstallAnchorPath = fileURLToPath(new URL('../package.json', import.meta.url))
const updateHelperPath = fileURLToPath(new URL('./update-helper.js', import.meta.url))
const platformBehavior = desktopPlatformBehavior(process.platform)
const desktopUpdatesEnabled = supportsDesktopUpdates(process.platform)

function resolveHarnessVersion(): string {
  const manifest = require('@deepseek-ai/dsh/package.json') as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : 'unknown'
}

function resolveCliPath(): string {
  const packageJson = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(packageJson), 'lib', 'bin.js')
}

function resolveWorkspace(): string {
  const cwd = process.cwd()
  return cwd === '/' ? homedir() : cwd
}

app.setName(PRODUCT_NAME)
const userData = app.getPath('userData')
const logPath = join(userData, 'logs', 'lifecycle.log')
const windowStatePath = join(userData, 'window-state.json')
const preferencesPath = join(userData, 'desktop-preferences.json')
const controlSettingsPath = join(userData, 'desktop-control-settings.json')
const controlAuditPath = join(userData, 'desktop-control-audit.jsonl')
const controlAuditSaltPath = join(userData, 'desktop-control-audit.salt')
const logger = createLifecycleLogger(logPath)
const dshHome = resolveDshHome()

const appFacade: AppFacade = {
  requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
  whenReady: async () => { await app.whenReady() },
  on: (event, listener) => {
    if (event === 'before-quit') {
      app.on('before-quit', (nativeEvent) => { listener(nativeEvent) })
      return
    }
    if (event === 'second-instance') {
      app.on('second-instance', () => { listener() })
      return
    }
    if (event === 'activate') {
      app.on('activate', () => { listener() })
      return
    }
    throw new Error(`Unsupported desktop application event: ${event}`)
  },
  quit: () => { app.quit() },
  exit: (code) => { app.exit(code) },
}

let nativeWindow: BrowserWindow | undefined
let tray: Tray | undefined
let workbenchBrowser: WorkbenchBrowserController | undefined
let workbenchBrowserBounds: DesktopBrowserBounds | undefined
let activeHarnessRoot: string | undefined
const lifecycle: { controller?: DesktopApplication } = {}
let desktopPreferences: DesktopPreferencesSnapshot = defaultDesktopPreferences(process.platform)
let preferencesMutationTail: Promise<void> = Promise.resolve()
const preferencesReady = readDesktopPreferences(preferencesPath, process.platform).then((value) => {
  desktopPreferences = value
  return value
}).catch((error: unknown) => {
  record(`desktop preferences read failed: ${error instanceof Error ? error.message : String(error)}`)
  return desktopPreferences
})
const updateService = new DesktopUpdateService({
  runningDesktop: app.getVersion(),
  includedHarness: resolveHarnessVersion(),
  userData,
})
const startupTimeline = new DesktopStartupTimeline(record)
let controlSettings: ControlSettings = DEFAULT_CONTROL_SETTINGS
let officialControlSession: SessionId | undefined
const controlSettingsReady = readControlSettings(controlSettingsPath).then((settings) => {
  controlSettings = settings
  return settings
}).catch((error: unknown) => {
  record(`desktop control settings read failed: ${error instanceof Error ? error.message : String(error)}`)
  return controlSettings
})
let controlAuditReady: Promise<ControlAuditLog | undefined> | undefined
function getControlAudit(): Promise<ControlAuditLog | undefined> {
  controlAuditReady ??= loadOrCreateControlAuditSalt(controlAuditSaltPath).then((installSalt) => {
    return new ControlAuditLog({
      filename: controlAuditPath,
      clock: { nowUnixMs: Date.now },
      installSalt,
    })
  }).catch((error: unknown) => {
    record(`desktop control audit initialization failed: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  })
  return controlAuditReady
}
const controlLifecycle: { bridge?: DesktopControlBridgeServer } = {}
const browserResources = new ElectronBrowserSurfaceRegistry()
const browserTakeover = new BrowserTakeoverAuthority({
  source: {
    captureVisiblePersistentIntent: () => workbenchBrowser?.captureVisiblePersistentIntent(),
    consumeVisiblePersistentIntent: async (intent) => {
      const browser = workbenchBrowser
      if (browser === undefined) throw new AgentBrowserError('TARGET_CLOSED', 'human browser is unavailable')
      return await browser.consumeVisiblePersistentIntent(intent)
    },
  },
  stopActiveSession: async (sessionId) => {
    const official = officialControlSession
    if (official === undefined || official !== sessionId) {
      throw new AgentBrowserError('STALE_REF', 'browser owner session is stale')
    }
    await controlCoordinator.revokeSession(official, new AbortController().signal)
  },
  emit: (status) => {
    if (nativeWindow !== undefined && !nativeWindow.isDestroyed() && activeHarnessRoot !== undefined) {
      nativeWindow.webContents.send('desktop:browser-takeover-state', status)
    }
  },
})

function agentBrowserBounds(window: BrowserWindow): Electron.Rectangle {
  const area = window.getContentBounds()
  const requested = workbenchBrowserBounds
  if (requested === undefined) {
    const width = Math.min(420, area.width)
    return { x: Math.max(0, area.width - width), y: 0, width: Math.max(1, width), height: Math.max(1, area.height) }
  }
  const x = Math.max(0, Math.min(Math.round(requested.x), area.width - 1))
  const y = Math.max(0, Math.min(Math.round(requested.y), area.height - 1))
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(requested.width), area.width - x)),
    height: Math.max(1, Math.min(Math.round(requested.height), area.height - y)),
  }
}

async function resolveBrowserHost(
  browserSession: Electron.Session,
  hostname: string,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const assertActive = (): void => { if (signal?.aborted === true) throw signal.reason }
  assertActive()
  const attempts = await Promise.allSettled((['A', 'AAAA'] as const).map(async (queryType) => {
    return await browserSession.resolveHost(hostname, {
      queryType,
      source: 'any',
      cacheUsage: 'disallowed',
    })
  }))
  assertActive()
  const addresses = attempts.flatMap(result => result.status === 'fulfilled'
    ? result.value.endpoints.map(endpoint => endpoint.address)
    : [])
  return Object.freeze([...new Set(addresses)])
}

const browserSurfaceManager = new BrowserSurfaceManager({
  coordinator: browserTakeover,
  createEphemeral: (request) => {
    const window = nativeWindow
    if (window === undefined || window.isDestroyed()) {
      throw new AgentBrowserError('TARGET_CLOSED', 'Desktop owner window is unavailable')
    }
    browserTakeover.claimEphemeralOwner(request.sessionId)
    return Promise.resolve(createElectronEphemeralSurface({
      window,
      request,
      registry: browserResources,
      bounds: () => agentBrowserBounds(window),
    }))
  },
})

const browserControlAdapter = new BrowserDesktopControlAdapter({
  surfaceManager: browserSurfaceManager,
  activate: (mount) => {
    const resource = browserResources.get(mount.surfaceId)
    let generationActive = true
    const policy = new AgentBrowserUrlPolicy({
      lookup: async (hostname, signal) => await resolveBrowserHost(resource.session, hostname, signal),
    })
    const transport = new LoopbackPinnedNavigationTransport({
      session: resource.session,
      generation: mount.generation,
      isGenerationActive: generation => generationActive && generation === mount.generation,
    })
    const semantic = new CdpBrowserAdapter({
      webContents: resource.webContents,
      surfaceId: mount.surfaceId,
      surfaceGeneration: mount.generation,
      viewport: () => resource.viewport(),
      urlPolicy: policy,
      pinnedNavigationTransport: transport,
    })
    return Promise.resolve(Object.freeze({
      semantic,
      disposeTransport: async () => {
        generationActive = false
        await transport.dispose()
      },
    }))
  },
})

const controlCoordinator = new DesktopControlCoordinator({
  clock: {
    now: () => performance.now(),
    setTimeout: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      timer.unref()
      return timer
    },
    clearTimeout: (handle) => { clearTimeout(handle as NodeJS.Timeout) },
  },
  mintLeaseId: randomUUID,
  // The Desktop-only Host injects its official session into every strict request.
  // Electron binds the first owned-child session and rejects every different value.
  getOfficialSessionId: () => officialControlSession,
  claimOfficialSession: (sessionId) => {
    officialControlSession ??= sessionId
    return officialControlSession
  },
  releaseOfficialSession: (sessionId) => {
    if (officialControlSession === sessionId) officialControlSession = undefined
  },
  getAgentDisplayName: () => 'Agent',
  getSettings: () => ({ settings: controlSettings, revision: 1 }),
  approval: {
    dialog: {
      async showMessageBox(window, options: NativeApprovalDialogOptions) {
        return await dialog.showMessageBox(window as BrowserWindow, {
          ...options,
          buttons: [...options.buttons],
        })
      },
    },
    getOwnerWindow: () => nativeWindow,
    revalidate: scope => scope.sessionId === officialControlSession,
  },
  shortcuts: {
    register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
    unregister: (accelerator) => { globalShortcut.unregister(accelerator) },
  },
  browser: browserControlAdapter,
  audit: {
    record: async (event) => { await (await getControlAudit())?.record(event) },
    flush: async () => {
      if (controlAuditReady !== undefined) await (await controlAuditReady)?.flush()
    },
  },
  onLeaseRevoked: (event) => {
    controlLifecycle.bridge?.revokeLease({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'lease.revoke',
      sessionId: event.snapshot.sessionId,
      leaseId: event.snapshot.leaseId,
      leaseRevision: event.snapshot.leaseRevision,
    })
  },
})
const controlBridge = new DesktopControlBridgeServer({
  backend: controlCoordinator,
  beforeControlShutdown: signal => controlCoordinator.beforeControlShutdown(signal),
  log: (event) => {
    record(`desktop control ${event.direction} generation=${String(event.generation)} pending=${String(event.pending)} reason=${event.reason}`)
  },
})
controlLifecycle.bridge = controlBridge
void controlSettingsReady

const runtime = new HarnessProcess({
  cli: resolveCliPath(),
  patch: desktopPatchPath,
  prepare: () => {
    const result = healProfilesModuleFallbackCached(desktopInstallAnchorPath, dshHome, app.getVersion())
    record(`module fallback: ${result}`)
  },
  onOutput: (source, output) => {
    record(`Harness ${source}: ${output}`)
  },
  onExit: () => { void lifecycle.controller?.runtimeExited() },
  markStartup: (milestone) => { startupTimeline.mark(milestone) },
  controlLifecycle: controlBridge,
})

function record(message: string): void {
  void logger.write(message)
}

function openExternal(url: string): void {
  void shell.openExternal(url).catch((error: unknown) => {
    record(`external URL failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}

function showDesktopWindow(): void {
  if (nativeWindow === undefined || nativeWindow.isDestroyed()) return
  if (nativeWindow.isMinimized()) nativeWindow.restore()
  nativeWindow.show()
  nativeWindow.focus()
  controlCoordinator.resumeAdmission()
}

function syncWindowsTray(): void {
  if (process.platform !== 'win32' || desktopPreferences.closeBehavior !== 'keep-running') {
    tray?.destroy()
    tray = undefined
    return
  }
  if (tray !== undefined) return
  tray = new Tray(iconPath)
  tray.setToolTip(PRODUCT_NAME)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show DeepSeek Harness', click: showDesktopWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit() } },
  ]))
  tray.on('double-click', showDesktopWindow)
}

async function setDesktopPreference(
  mutation: DesktopPreferenceMutation,
): Promise<DesktopPreferencesSnapshot> {
  let snapshot!: DesktopPreferencesSnapshot
  const task = preferencesMutationTail.then(async () => {
    await preferencesReady
    const next: DesktopPreferencesSnapshot = mutation.key === 'closeBehavior'
      ? { ...desktopPreferences, closeBehavior: mutation.value }
      : { ...desktopPreferences, tieredPricingEstimates: mutation.value }
    await writeDesktopPreferences(preferencesPath, next)
    desktopPreferences = next
    snapshot = next
    syncWindowsTray()
    if (nativeWindow !== undefined && !nativeWindow.isDestroyed() && activeHarnessRoot !== undefined) {
      nativeWindow.webContents.send('desktop:preferences-state', next)
    }
  })
  preferencesMutationTail = task.catch(() => {})
  await task
  return snapshot
}

function installNavigationPolicy(window: BrowserWindow, ownedRoot: () => string | undefined): void {
  const handle = (event: Electron.Event, target: string): void => {
    const root = ownedRoot()
    const decision = root === undefined ? 'blocked' : classifyNavigation(target, root)
    if (decision === 'internal') return
    event.preventDefault()
    if (decision === 'external') openExternal(target)
  }
  window.webContents.on('will-navigate', handle)
  window.webContents.on('will-redirect', handle)
  window.webContents.setWindowOpenHandler(({ url }) => {
    const root = ownedRoot()
    if (root !== undefined && classifyNavigation(url, root) === 'external') openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
  window.webContents.session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    return allowRendererPermission(
      permission,
      details.requestingUrl ?? requestingOrigin,
      details.isMainFrame,
      ownedRoot(),
      contents === window.webContents,
    )
  })
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowRendererPermission(
      permission,
      details.requestingUrl,
      details.isMainFrame,
      ownedRoot(),
      contents === window.webContents,
    ))
  })
}

function createStateWriter(window: BrowserWindow): () => void {
  let timer: NodeJS.Timeout | undefined
  const persist = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (window.isDestroyed()) return
      void writeWindowBounds(windowStatePath, window.getBounds()).catch((error: unknown) => {
        record(`window state write failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }, 250)
    timer.unref()
  }
  window.on('move', persist)
  window.on('resize', persist)
  return persist
}

async function createDesktopWindow(): Promise<DesktopWindow> {
  const displays = screen.getAllDisplays().map(display => display.workArea)
  const bounds = await readDesktopWindowPrerequisites(
    preferencesReady,
    async () => await readWindowBounds(windowStatePath, displays),
  )
  startupTimeline.mark('window-prerequisites')
  const window = new BrowserWindow(createWindowOptions(bounds, preloadPath, process.platform))
  nativeWindow = window
  workbenchBrowser = new WorkbenchBrowserController(window, (snapshot) => {
    if (!window.isDestroyed()) window.webContents.send('desktop:workbench-browser-state', snapshot)
  }, browserResources)
  let ownedRoot: string | undefined
  installNavigationPolicy(window, () => ownedRoot)
  const persistState = createStateWriter(window)

  window.on('close', (event) => {
    event.preventDefault()
    persistState()
    void controller.beforeCloseToTray().then(async () => {
      await workbenchBrowser?.hide()
      if (window.isDestroyed()) return
      if (desktopPreferences.closeBehavior === 'keep-running') {
        window.hide()
        syncWindowsTray()
      } else app.quit()
    }).catch((error: unknown) => {
      record(`close-to-tray control cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  })
  window.webContents.on('render-process-gone', () => { void controller.rendererExited() })
  window.webContents.on('did-fail-load', (_event, errorCode) => {
    if (errorCode !== -3) void controller.rendererExited()
  })

  const desktopWindow: DesktopWindow = {
    async loadLoading() {
      await workbenchBrowser?.hide()
      ownedRoot = undefined
      activeHarnessRoot = undefined
      await window.loadFile(loadingPath)
    },
    async loadHarness(url) {
      ownedRoot = url
      activeHarnessRoot = url
      await window.loadURL(desktopRendererUrl(url, process.platform))
    },
    async loadFailure(reason: FailureReason) {
      await workbenchBrowser?.hide()
      ownedRoot = undefined
      activeHarnessRoot = undefined
      await window.loadFile(failurePath, { query: { reason } })
    },
    show() {
      if (window.isMinimized()) window.restore()
      window.show()
      controlCoordinator.resumeAdmission()
    },
    focus() { window.focus() },
    sendCommand(command: DesktopCommand) { window.webContents.send('desktop:command', command) },
  }
  return desktopWindow
}

const controller = new DesktopApplication({
  app: appFacade,
  createWindow: createDesktopWindow,
  runtime,
  control: controlCoordinator,
  findConflict: () => findConflictingHarness(dshHome),
  workspace: resolveWorkspace(),
  openLogs: () => { shell.showItemInFolder(logPath) },
  log: message => logger.write(message),
  markStartup: (milestone) => { startupTimeline.mark(milestone) },
})
lifecycle.controller = controller

function isFailureSender(event: IpcMainEvent): boolean {
  if (nativeWindow === undefined || event.sender !== nativeWindow.webContents) return false
  try {
    return fileURLToPath(new URL(event.sender.getURL())) === failurePath
  } catch {
    return false
  }
}

function isHarnessSender(event: IpcMainInvokeEvent): boolean {
  if (nativeWindow === undefined || event.sender !== nativeWindow.webContents || activeHarnessRoot === undefined) return false
  if (event.senderFrame !== event.sender.mainFrame) return false
  try {
    return new URL(event.sender.getURL()).origin === new URL(activeHarnessRoot).origin
  } catch {
    return false
  }
}

ipcMain.on('desktop:recovery', (event, value: unknown) => {
  if (isFailureSender(event) && isRecoveryAction(value)) controller.recover(value)
})

ipcMain.handle('desktop:preferences-get', async (event) => {
  if (!isHarnessSender(event)) throw new Error('Untrusted Desktop preferences sender.')
  await preferencesReady
  return desktopPreferences
})

ipcMain.handle('desktop:preferences-set', async (event, value: unknown) => {
  if (!isHarnessSender(event) || !isDesktopPreferenceMutation(value)) {
    throw new Error('Untrusted Desktop preference mutation.')
  }
  return await setDesktopPreference(value)
})

if (desktopUpdatesEnabled) {
  ipcMain.handle('desktop:update-status', (event) => {
    if (!isHarnessSender(event)) throw new Error('Untrusted Desktop update sender.')
    return updateService.getSnapshot()
  })

  ipcMain.handle('desktop:update-check', async (event) => {
    if (!isHarnessSender(event)) throw new Error('Untrusted Desktop update sender.')
    return await updateService.check(true)
  })

  ipcMain.handle('desktop:update-download', async (event) => {
    if (!isHarnessSender(event)) throw new Error('Untrusted Desktop update sender.')
    return await updateService.download()
  })

  ipcMain.handle('desktop:update-install', async (event) => {
    if (!isHarnessSender(event)) throw new Error('Untrusted Desktop update sender.')
    const descriptor = updateService.getInstallDescriptor()
    if (descriptor === null) throw new Error('No verified Desktop update is ready.')
    if (process.platform === 'darwin' && app.isPackaged) {
      launchDesktopInstaller({
        helperSource: updateHelperPath,
        electronExecutable: process.execPath,
        currentAppPath: resolve(dirname(process.execPath), '../..'),
        dmgPath: descriptor.dmgPath,
        expectedDesktopVersion: descriptor.desktopVersion,
        expectedHarnessVersion: descriptor.harnessVersion,
        expectedSha256: descriptor.sha256,
      })
      updateService.beginInstall()
      setImmediate(() => { app.quit() })
      return { opened: true }
    }
    const message = await shell.openPath(descriptor.dmgPath)
    if (message !== '') return { opened: false, message: message.slice(0, 300) }
    updateService.beginInstall()
    return { opened: true }
  })

  updateService.subscribe((snapshot) => {
    if (nativeWindow !== undefined && !nativeWindow.isDestroyed() && activeHarnessRoot !== undefined) {
      nativeWindow.webContents.send('desktop:update-state', snapshot)
    }
  })
}

ipcMain.handle('desktop:workbench-browser-show', async (event, value: unknown) => {
  if (!isHarnessSender(event) || !isDesktopBrowserBounds(value) || workbenchBrowser === undefined) {
    throw new Error('Untrusted workbench Browser request.')
  }
  workbenchBrowserBounds = value
  return await workbenchBrowser.show(value)
})

ipcMain.handle('desktop:workbench-browser-hide', async (event) => {
  if (!isHarnessSender(event) || workbenchBrowser === undefined) throw new Error('Untrusted workbench Browser request.')
  await workbenchBrowser.hide()
})

ipcMain.handle('desktop:workbench-browser-control', async (event, value: unknown) => {
  if (!isHarnessSender(event) || !isDesktopBrowserRequest(value) || workbenchBrowser === undefined) {
    throw new Error('Untrusted workbench Browser request.')
  }
  return await workbenchBrowser.control(value)
})

const removeBrowserTakeoverIpc = installBrowserTakeoverIpc({
  registry: ipcMain,
  authority: browserTakeover,
  isTrustedMainFrame: event => isHarnessSender(event as IpcMainInvokeEvent),
})


app.on('before-quit', () => {
  removeBrowserTakeoverIpc()
  updateService.dispose()
  tray?.destroy()
  tray = undefined
  void workbenchBrowser?.hide()
})

Menu.setApplicationMenu(Menu.buildFromTemplate(
  createMenuTemplate(PRODUCT_NAME, (command) => { controller.sendCommand(command) }, process.platform),
))

void controller.run().then(() => {
  if (platformBehavior.setDockIcon) app.dock?.setIcon(iconPath)
  syncWindowsTray()
  record('desktop application ready')
  if (!desktopUpdatesEnabled) return
  const timer = setTimeout(() => {
    void updateService.check(false).catch((error: unknown) => {
      record(`automatic update check failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }, 1_500)
  timer.unref()
}).catch((error: unknown) => {
  record(`desktop application failed: ${error instanceof Error ? error.message : String(error)}`)
  app.exit(1)
})
