import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  screen,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  DesktopApplication,
  type AppFacade,
  type DesktopWindow,
  type FailureReason,
} from './application.ts'
import { HarnessProcess } from './harness/process.ts'
import { resolveDesktopRuntime } from './harness/composition.ts'
import { DesktopCompatibilityService } from './compatibility/service.ts'
import { isDesktopPluginMutation } from './compatibility/contracts.ts'
import { findConflictingHarness } from './harness/ownership.ts'
import { createLifecycleLogger } from './logging.ts'
import { nativeDesktopCopy } from './locales.ts'
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
import { launchDesktopInstaller } from './update/installer.ts'
import { readRestartRequest, writeRestartReady } from './update/restart-receipt.ts'
import { DesktopUpdateInstaller } from './update/install.ts'
import { launchWindowsDesktopInstaller } from './update/windows-installer.ts'
import { detectLinuxPackageFormat, revealLinuxUpdatePackage } from './update/linux-installer.ts'
import { allowRendererPermission, classifyNavigation } from './window/navigation.ts'
import { createMenuTemplate } from './window/menu.ts'
import {
  createWindowOptions,
  desktopRendererUrl,
  selectWindowsTrayIconSize,
  type WindowsTrayIconSize,
} from './window/options.ts'
import { desktopPlatformBehavior } from './window/platform.ts'
import { readWindowBounds, writeWindowBounds } from './window/state.ts'
import { readDesktopWindowPrerequisites } from './window/prerequisites.ts'
import { DesktopStartupTimeline } from './startup-timeline.ts'
import { createNativeVisualTrayEvidenceController } from './native-visual-tray-evidence.ts'

const PRODUCT_NAME = 'DeepSeek Harness'
const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const loadingPath = fileURLToPath(new URL('../renderer/loading.html', import.meta.url))
const failurePath = fileURLToPath(new URL('../renderer/failure.html', import.meta.url))
const compatibilityPath = fileURLToPath(new URL('../renderer/compatibility.html', import.meta.url))
const applicationIconPath = fileURLToPath(new URL('../assets/icon-source.png', import.meta.url))
const windowsIconPath = fileURLToPath(new URL('../assets/icon-windows.ico', import.meta.url))
const windowsTrayIconPaths: Record<WindowsTrayIconSize, string> = {
  16: fileURLToPath(new URL('../assets/tray-windows-16.png', import.meta.url)),
  20: fileURLToPath(new URL('../assets/tray-windows-20.png', import.meta.url)),
  24: fileURLToPath(new URL('../assets/tray-windows-24.png', import.meta.url)),
  32: fileURLToPath(new URL('../assets/tray-windows-32.png', import.meta.url)),
}
const desktopInstallAnchorPath = fileURLToPath(new URL('../package.json', import.meta.url))
const desktopRuntime = resolveDesktopRuntime(desktopInstallAnchorPath)
// The full composition alone owns the fork's cached fallback helper.
const legacyBoot = desktopRuntime.kind === 'full' ? await import('@deepseek-ai/dsh-app-boot') : undefined
const legacyFallback: unknown = legacyBoot === undefined ? undefined : Reflect.get(legacyBoot, 'healProfilesModuleFallbackCached')
if (desktopRuntime.kind === 'full' && typeof legacyFallback !== 'function') {
  throw new Error('The full Desktop composition requires its cached module fallback helper.')
}
const healLegacyModuleFallback = legacyFallback as ((anchor: string, home: string, version: string) => unknown) | undefined
const updateHelperPath = fileURLToPath(new URL('./update-helper.js', import.meta.url))
const platformBehavior = desktopPlatformBehavior(process.platform)
const desktopUpdatesEnabled = supportsDesktopUpdates(process.platform)

function resolveWorkspace(): string {
  const cwd = process.cwd()
  return cwd === '/' ? homedir() : cwd
}

app.setName(PRODUCT_NAME)
const userData = app.getPath('userData')
const logPath = join(userData, 'logs', 'lifecycle.log')
const windowStatePath = join(userData, 'window-state.json')
const preferencesPath = join(userData, 'desktop-preferences.json')
const nativeVisualTrayEvidencePath = join(userData, 'native-visual-tray.json')
const nativeVisualTrayEvidenceEnabled = process.platform === 'win32'
  && process.env.DSH_DESKTOP_NATIVE_VISUAL_EVIDENCE === '1'
const nativeVisualTrayEvidence = createNativeVisualTrayEvidenceController({
  enabled: nativeVisualTrayEvidenceEnabled,
  write: async (evidence) => {
    await writeFileAtomic(
      nativeVisualTrayEvidencePath,
      `${JSON.stringify(evidence)}\n`,
      { mode: 0o600, dirMode: 0o700 },
    )
  },
})
const logger = createLifecycleLogger(logPath)
const dshHome = resolveDshHome()
const restartFacts = { desktopVersion: app.getVersion(), harnessVersion: desktopRuntime.harnessVersion,
  executablePath: process.execPath, home: homedir(), dshHome, userData }
const restartRequest = await readRestartRequest(process.env.DSH_DESKTOP_RESTART_REQUEST, restartFacts)
delete process.env.DSH_DESKTOP_RESTART_REQUEST

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
let compatibilityWindow: BrowserWindow | undefined
let tray: Tray | undefined
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
  platform: process.platform,
  arch: process.arch,
  resolveLinuxFormat: () => detectLinuxPackageFormat({
    platform: process.platform, arch: process.arch, isPackaged: app.isPackaged,
    executablePath: process.execPath,
    ...(process.env.APPIMAGE === undefined ? {} : { appImagePath: process.env.APPIMAGE }),
    ...(process.env.APPDIR === undefined ? {} : { appDir: process.env.APPDIR }),
  }),
  runningDesktop: app.getVersion(),
  includedHarness: desktopRuntime.harnessVersion,
  userData,
})
const updateInstaller = new DesktopUpdateInstaller(updateService, {
  isPackaged: app.isPackaged,
  confirmSetup: async () => {
    if (nativeWindow === undefined || nativeWindow.isDestroyed()) return false
    const copy = nativeDesktopCopy(app.getLocale())
    const result = await dialog.showMessageBox(nativeWindow, {
      type: 'question', title: PRODUCT_NAME,
      message: copy.setupMessage,
      detail: copy.setupDetail,
      buttons: [copy.cancel, copy.openSetup],
      defaultId: 0, cancelId: 0, noLink: true,
    })
    return result.response === 1
  },
  launchMac: async (descriptor) => {
    await launchDesktopInstaller({
      helperSource: updateHelperPath,
      helperNodePath: join(process.resourcesPath, 'desktop-helper', 'node'),
      helperSourceManifest: join(process.resourcesPath, 'desktop-helper', 'source.json'),
      verifiedDownloadDirectory: descriptor.stagingDirectory,
      currentAppPath: resolve(dirname(process.execPath), '../..'), dmgPath: descriptor.localPath,
      expectedDesktopVersion: descriptor.desktopVersion, expectedHarnessVersion: descriptor.harnessVersion,
      expectedSha256: descriptor.sha256,
      restart: { home: homedir(), dshHome, userData },
    })
  },
  launchWindows: async (descriptor) => { await launchWindowsDesktopInstaller(descriptor) },
  revealLinux: async (descriptor) => {
    if (descriptor.target.platform !== 'linux') throw new Error('Invalid Linux update target.')
    await revealLinuxUpdatePackage({
      platform: 'linux', arch: descriptor.target.arch, packageFormat: descriptor.target.packageFormat,
      desktopVersion: descriptor.desktopVersion, assetName: descriptor.assetName,
      filePath: descriptor.localPath, stagingDirectory: descriptor.stagingDirectory,
      bytes: descriptor.bytes, sha256: descriptor.sha256,
    }, directory => shell.openPath(directory))
  },
  quit: () => { setImmediate(() => { app.quit() }) },
})
const startupTimeline = new DesktopStartupTimeline(record)
let compatibility: Promise<DesktopCompatibilityService> | undefined

function getCompatibilityService(): Promise<DesktopCompatibilityService> {
  if (desktopRuntime.kind !== 'base') return Promise.reject(new Error('Native compatibility management requires the base composition.'))
  compatibility ??= (async () => {
    const resolver = createRequire(desktopRuntime.cli)
    const boot = await import(pathToFileURL(resolver.resolve('@deepseek-ai/dsh-app-boot')).href) as typeof import('@deepseek-ai/dsh-app-boot')
    const include = await import(pathToFileURL(resolver.resolve('@deepseek-ai/cordis-plugin-include')).href) as typeof import('@deepseek-ai/cordis-plugin-include')
    const yaml = await import(pathToFileURL(resolver.resolve('js-yaml')).href) as typeof import('js-yaml')
    const canonicalDirectory = join(dshHome, 'profiles', 'web')
    const configured = process.env.DSH_DESKTOP_PLUGIN_FAILURE_CONFIRMATIONS ?? '2'
    if (!/^(?:[1-9]|[1-5][0-9]|6[0-4])$/.test(configured)) throw new Error('Invalid native plugin confirmation policy.')
    return new DesktopCompatibilityService({
      dshHome, canonicalDirectory, effectiveDirectory: join(dshHome, 'profiles', 'desktop-base'),
      directory: join(dshHome, '.desktop-compatibility'), officialAnchor: resolve(dirname(desktopRuntime.cli), '../package.json'),
      harnessVersion: desktopRuntime.harnessVersion, policy: { failureConfirmations: Number(configured) },
      official: {
        sourceSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203',
        loadOverlayPatches: boot.loadOverlayPatches, resolveBundleDir: boot.resolveBundleDir,
        entryListSchema: include.entryListSchema,
        yaml: { load: (text, options) => yaml.load(text, { schema: options.schema as import('js-yaml').Schema }),
          dump: (value, options) => yaml.dump(value, { schema: options.schema as import('js-yaml').Schema, noRefs: true }) },
      },
      initializeCanonical: () => {
        const template = boot.PROFILE_TEMPLATES.web
        if (template === undefined) throw new Error('Official Web profile template is missing.')
        boot.initProfile(canonicalDirectory, template.bundles, template.patchReload)
      },
      requestedBundles: () => {
        const names = boot.readProfileManifest('dsh', canonicalDirectory).dsh?.profile?.bundles
        if (!Array.isArray(names)) throw new Error('Canonical Web profile has no Bundle list.')
        return names
      },
      validateHost: async (signal) => {
        signal.throwIfAborted()
        if (await findConflictingHarness(dshHome) !== undefined) throw new Error('Another Harness writer prevents validation.')
        const candidate = new HarnessProcess({ cli: desktopRuntime.cli, patch: desktopRuntime.patch, profile: 'desktop-base', requireHostReady: true,
          onOutput: (source, output) => { record(`Compatibility candidate ${source}: ${output}`) } })
        const stop = (): void => { void candidate.stop().catch(() => { record('Candidate cancellation could not stop the owned process.') }) }
        signal.addEventListener('abort', stop, { once: true })
        try {
          signal.throwIfAborted()
          await candidate.start(resolveWorkspace())
          signal.throwIfAborted()
        } finally { signal.removeEventListener('abort', stop); await candidate.stop() }
      },
    })
  })()
  return compatibility
}

const runtime = new HarnessProcess({
  cli: desktopRuntime.cli,
  patch: desktopRuntime.patch,
  ...(desktopRuntime.kind === 'base' ? {
    profile: desktopRuntime.profile,
    requireHostReady: true,
    fromDefaultProfile: () => existsSync(join(dshHome, 'profiles', desktopRuntime.profile, 'package.json')) ? undefined : 'web' as const,
  } : {}),
  prepare: () => {
    if (desktopRuntime.kind === 'base') {
      return (async () => {
        const resolver = createRequire(desktopRuntime.cli)
        const imported: unknown = await import(pathToFileURL(resolver.resolve('@deepseek-ai/dsh-app-boot')).href)
        const boot = imported as typeof import('@deepseek-ai/dsh-app-boot')
        await (await getCompatibilityService()).prepare()
        await boot.healProfilesModuleFallback({
          installAnchor: resolve(dirname(desktopRuntime.cli), '../../../../desktop-native.json'), home: dshHome,
        })
      })()
    }
    if (healLegacyModuleFallback !== undefined) {
      const result = healLegacyModuleFallback(desktopInstallAnchorPath, dshHome, app.getVersion())
      record(`module fallback: ${String(result)}`)
    }
  },
  onOutput: (source, output) => {
    record(`Harness ${source}: ${output}`)
  },
  onStartupTiming: (phase, milliseconds) => {
    record(`runtime ${phase}: ${String(milliseconds)}ms`)
  },
  onExit: () => { void lifecycle.controller?.runtimeExited() },
  markStartup: (milestone) => { startupTimeline.mark(milestone) },
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
}

function loadNativeIcon(path: string, label: string): Electron.NativeImage {
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) throw new Error(`${label} icon is missing or invalid.`)
  return image
}

function syncWindowsTray(): void {
  if (process.platform !== 'win32' || desktopPreferences.closeBehavior !== 'keep-running') {
    nativeVisualTrayEvidence.stop()
    tray?.destroy()
    tray = undefined
    return
  }
  if (tray !== undefined) return
  const size = selectWindowsTrayIconSize(screen.getPrimaryDisplay().scaleFactor)
  const activeTray = new Tray(loadNativeIcon(windowsTrayIconPaths[size], `Windows ${String(size)}px tray`))
  tray = activeTray
  activeTray.setToolTip(PRODUCT_NAME)
  const copy = nativeDesktopCopy(app.getLocale())
  activeTray.setContextMenu(Menu.buildFromTemplate([
    { label: copy.show, click: showDesktopWindow },
    { type: 'separator' },
    { label: copy.quit, click: () => { app.quit() } },
  ]))
  activeTray.on('double-click', showDesktopWindow)
  nativeVisualTrayEvidence.start({
    iconSize: size,
    getBounds: () => activeTray.getBounds(),
    dipToScreenPoint: point => screen.dipToScreenPoint(point),
  })
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
  const primaryDisplay = screen.getPrimaryDisplay()
  const displays = [
    primaryDisplay,
    ...screen.getAllDisplays().filter(display => display.id !== primaryDisplay.id),
  ].map(display => ({ ...display.workArea, scaleFactor: display.scaleFactor }))
  const bounds = await readDesktopWindowPrerequisites(
    preferencesReady,
    async () => await readWindowBounds(windowStatePath, displays),
  )
  startupTimeline.mark('window-prerequisites')
  const nativeIconPath = process.platform === 'win32'
    ? windowsIconPath
    : process.platform === 'linux' ? applicationIconPath : undefined
  if (nativeIconPath !== undefined) loadNativeIcon(nativeIconPath, 'Application')
  const window = new BrowserWindow(createWindowOptions(
    bounds,
    preloadPath,
    process.platform,
    nativeIconPath,
  ))
  // Electron's Windows constructor repeatedly reads and rewrites native size
  // while centering and positioning, accumulating fractional-DPI rounding.
  // Apply the original full rectangle once before observing or showing it.
  if (process.platform === 'win32') window.setBounds(bounds)
  nativeWindow = window
  let ownedRoot: string | undefined
  installNavigationPolicy(window, () => ownedRoot)
  const persistState = createStateWriter(window)

  window.on('close', (event) => {
    event.preventDefault()
    persistState()
    if (desktopPreferences.closeBehavior === 'keep-running') {
      window.hide()
      syncWindowsTray()
    } else app.quit()
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
      await window.loadURL(desktopRendererUrl(url, process.platform))
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
  markStartup: (milestone) => {
    startupTimeline.mark(milestone)
    if (milestone === 'desktop-running' && restartRequest !== null && runtime.pid !== undefined) {
      void writeRestartReady(restartRequest, { ...restartFacts, ownedHostPid: runtime.pid })
        .catch(() => { record('Updated application could not publish its bound Host readiness receipt.') })
    }
  },
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

function isNativeRecoverySender(event: IpcMainInvokeEvent): boolean {
  if (event.senderFrame !== event.sender.mainFrame) return false
  try {
    const filename = fileURLToPath(new URL(event.sender.getURL()))
    return (event.sender === nativeWindow?.webContents && filename === failurePath)
      || (event.sender === compatibilityWindow?.webContents && filename === compatibilityPath)
  } catch { return false }
}

function isUpdateSender(event: IpcMainInvokeEvent): boolean {
  return isHarnessSender(event) || isNativeRecoverySender(event)
}

async function openCompatibilityWindow(): Promise<void> {
  await app.whenReady()
  if (desktopRuntime.kind !== 'base') throw new Error('Native recovery requires the base composition.')
  if (compatibilityWindow !== undefined && !compatibilityWindow.isDestroyed()) {
    compatibilityWindow.show()
    compatibilityWindow.focus()
    return
  }
  const area = screen.getPrimaryDisplay().workArea
  const window = new BrowserWindow({ width: Math.min(760, area.width), height: Math.min(650, area.height),
    show: false, ...(nativeWindow === undefined ? {} : { parent: nativeWindow }),
    title: PRODUCT_NAME, webPreferences: { preload: preloadPath, nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, partition: 'desktop-native-recovery' } })
  compatibilityWindow = window
  installNavigationPolicy(window, () => undefined)
  window.once('closed', () => { if (compatibilityWindow === window) compatibilityWindow = undefined })
  await window.loadFile(compatibilityPath)
  window.show()
}

ipcMain.handle('desktop:compatibility-open', async (event, ...args: unknown[]) => {
  if (!isUpdateSender(event) || args.length !== 0) throw new Error('Untrusted native recovery request.')
  await openCompatibilityWindow()
})

ipcMain.handle('desktop:compatibility-get', async (event, ...args: unknown[]) => {
  if (!isUpdateSender(event) || args.length !== 0) throw new Error('Untrusted native compatibility request.')
  return await (await getCompatibilityService()).getSnapshot()
})

ipcMain.handle('desktop:compatibility-mutate', async (event, value: unknown, ...args: unknown[]) => {
  if (!isNativeRecoverySender(event) || !isDesktopPluginMutation(value) || args.length !== 0) throw new Error('Untrusted native plugin choice.')
  const owner = compatibilityWindow ?? nativeWindow
  if (owner === undefined) throw new Error('Native recovery window is unavailable.')
  const copy = nativeDesktopCopy(app.getLocale())
  const answer = await dialog.showMessageBox(owner, { type: 'question', title: PRODUCT_NAME,
    message: copy.pluginMessage,
    detail: copy.pluginDetail,
    buttons: [copy.cancel, copy.pluginApply], cancelId: 0, defaultId: 0, noLink: true })
  const service = await getCompatibilityService()
  if (answer.response !== 1) return await service.getSnapshot()
  await controller.restartWith(async (signal) => { await service.mutate(value, signal) })
  return await service.getSnapshot()
})

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
  if (desktopRuntime.kind === 'base' && value.key !== 'closeBehavior') {
    throw new Error('This preference belongs to the optional enhancement composition.')
  }
  return await setDesktopPreference(value)
})

if (desktopUpdatesEnabled) {
  ipcMain.handle('desktop:update-status', (event, ...args: unknown[]) => {
    if (!isUpdateSender(event) || args.length !== 0) throw new Error('Untrusted Desktop update sender.')
    return updateService.getSnapshot()
  })

  ipcMain.handle('desktop:update-check', async (event, ...args: unknown[]) => {
    if (!isUpdateSender(event) || args.length !== 0) throw new Error('Untrusted Desktop update sender.')
    return await updateService.check(true)
  })

  ipcMain.handle('desktop:update-download', async (event, ...args: unknown[]) => {
    if (!isUpdateSender(event) || args.length !== 0) throw new Error('Untrusted Desktop update sender.')
    return await updateService.download()
  })

  ipcMain.handle('desktop:update-cancel-download', async (event, ...args: unknown[]) => {
    if (!isUpdateSender(event) || args.length !== 0) throw new Error('Untrusted Desktop update sender.')
    return await updateService.cancelDownload()
  })

  ipcMain.handle('desktop:update-install', async (event, ...args: unknown[]) => {
    if (!isUpdateSender(event) || args.length !== 0) throw new Error('Untrusted Desktop update sender.')
    return await updateInstaller.install()
  })

  updateService.subscribe((snapshot) => {
    if (nativeWindow !== undefined && !nativeWindow.isDestroyed()) {
      nativeWindow.webContents.send('desktop:update-state', snapshot)
    }
    if (compatibilityWindow !== undefined && !compatibilityWindow.isDestroyed()) compatibilityWindow.webContents.send('desktop:update-state', snapshot)
  })
}

app.on('before-quit', () => {
  nativeVisualTrayEvidence.stop()
  updateService.dispose()
  tray?.destroy()
  tray = undefined
})

const nativeMenu = createMenuTemplate(PRODUCT_NAME, (command) => { controller.sendCommand(command) }, process.platform)
if (desktopRuntime.kind === 'base') {
  const copy = nativeDesktopCopy(app.getLocale())
  nativeMenu.push({ label: copy.recoveryMenu, submenu: [{ label: copy.recoveryOpen,
    click: () => { void openCompatibilityWindow().catch(() => { record('Native recovery window could not open.') }) },
  }] })
}
Menu.setApplicationMenu(Menu.buildFromTemplate(nativeMenu))

void controller.run().then(() => {
  if (platformBehavior.setDockIcon) app.dock?.setIcon(applicationIconPath)
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
