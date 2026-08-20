import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { healProfilesModuleFallback } from '@deepseek-ai/dsh-app-boot'
import {
  DesktopApplication,
  type AppFacade,
  type DesktopWindow,
  type FailureReason,
} from './application.ts'
import { HarnessProcess } from './harness/process.ts'
import { findConflictingHarness } from './harness/ownership.ts'
import { createLifecycleLogger } from './logging.ts'
import { isRecoveryAction, supportsDesktopUpdates, type DesktopCommand } from './preload-api.ts'
import { DesktopUpdateService } from './update/service.ts'
import { launchDesktopInstaller } from './update/installer.ts'
import { allowRendererPermission, classifyNavigation } from './window/navigation.ts'
import { createMenuTemplate } from './window/menu.ts'
import { createWindowOptions } from './window/options.ts'
import { desktopPlatformBehavior } from './window/platform.ts'
import { readWindowBounds, writeWindowBounds } from './window/state.ts'

const PRODUCT_NAME = 'DeepSeek Harness'
const require = createRequire(import.meta.url)
const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const loadingPath = fileURLToPath(new URL(
  process.platform === 'darwin' ? '../renderer/loading-macos.html' : '../renderer/loading.html',
  import.meta.url,
))
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
let activeHarnessRoot: string | undefined
const lifecycle: { controller?: DesktopApplication } = {}
const updateService = new DesktopUpdateService({
  runningDesktop: app.getVersion(),
  includedHarness: resolveHarnessVersion(),
  userData,
})

const runtime = new HarnessProcess({
  cli: resolveCliPath(),
  patch: desktopPatchPath,
  prepare: () => { healProfilesModuleFallback(desktopInstallAnchorPath, dshHome) },
  onOutput: (source, output) => {
    record(`Harness ${source}: ${output}`)
  },
  onExit: () => { void lifecycle.controller?.runtimeExited() },
})

function record(message: string): void {
  void logger.write(message)
}

function openExternal(url: string): void {
  void shell.openExternal(url).catch((error: unknown) => {
    record(`external URL failed: ${error instanceof Error ? error.message : String(error)}`)
  })
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
  const bounds = await readWindowBounds(windowStatePath, displays)
  const window = new BrowserWindow(createWindowOptions(bounds, preloadPath, process.platform))
  nativeWindow = window
  let ownedRoot: string | undefined
  installNavigationPolicy(window, () => ownedRoot)
  const persistState = createStateWriter(window)

  window.on('close', (event) => {
    event.preventDefault()
    persistState()
    if (platformBehavior.hideWindowOnClose) window.hide()
    else app.quit()
  })
  window.webContents.on('render-process-gone', () => { void controller.rendererExited() })
  window.webContents.on('did-fail-load', (_event, errorCode) => {
    if (errorCode !== -3) void controller.rendererExited()
  })

  const desktopWindow: DesktopWindow = {
    async loadLoading() {
      ownedRoot = undefined
      activeHarnessRoot = undefined
      await window.loadFile(loadingPath)
    },
    async loadHarness(url) {
      ownedRoot = url
      activeHarnessRoot = url
      await window.loadURL(url)
    },
    async loadFailure(reason: FailureReason) {
      ownedRoot = undefined
      activeHarnessRoot = undefined
      await window.loadFile(failurePath, { query: { reason } })
    },
    show() {
      if (window.isMinimized()) window.restore()
      window.show()
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
  findConflict: () => findConflictingHarness(dshHome),
  workspace: resolveWorkspace(),
  openLogs: () => { shell.showItemInFolder(logPath) },
  log: message => logger.write(message),
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
  try {
    return new URL(event.sender.getURL()).origin === new URL(activeHarnessRoot).origin
  } catch {
    return false
  }
}

ipcMain.on('desktop:recovery', (event, value: unknown) => {
  if (isFailureSender(event) && isRecoveryAction(value)) controller.recover(value)
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

app.on('before-quit', () => { updateService.dispose() })

Menu.setApplicationMenu(Menu.buildFromTemplate(
  createMenuTemplate(PRODUCT_NAME, (command) => { controller.sendCommand(command) }, process.platform),
))

void controller.run().then(() => {
  if (platformBehavior.setDockIcon) app.dock?.setIcon(iconPath)
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
