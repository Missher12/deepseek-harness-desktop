/** Exercise the actual official base UI and preserve incomplete native evidence explicitly. */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication, type Locator, type Page } from 'playwright'
import { dump, JSON_SCHEMA, load } from 'js-yaml'
import { validateDesktopBaseSmokeDescriptor, type DesktopBaseSmokeDescriptor } from '../../../scripts/desktop-base-contract.ts'
import { isDesktopUpdateSnapshot } from '../src/update/contracts.ts'
import { resolveDesktopRuntime } from '../src/harness/composition.ts'
import { verifyBaseLegacyFixture } from './base-legacy-fixture.ts'
import type {} from '../src/preload-api.ts'
import { BASE_SMOKE_EVENTS, baseSmokeFile, capturePackagedBaseIdentity, capturePackagedAppImageIdentity, confinedBaseSmokePath,
  type BaseSmokeCheck, type BaseSmokeEvidence, type BaseSmokeFile, type BaseSmokeInstalledIdentity, type PackagedDesktopBaseSmokeReceipt } from './base-smoke-receipt.ts'
import { exerciseWindowsDirectoryPicker } from './native-directory-picker-smoke.ts'
import { startReaderSmokeProvider, NATIVE_READER_PROMPT, NATIVE_READER_TITLE } from './reader-smoke-provider.ts'

/** Native main observations used to distinguish direct AppImage launches from ordinary packaged executables. */
export interface NativePackagedBaseObservation {
  executablePath: string
  resources: string
  appPath: string
  desktopVersion: string
  appImage: string | null
  appDir: string | null
  mountInfo: string | null
}

/**
 * Bind the driver's exact launch executable to native observations before selecting stable AppImage capture.
 * @param executable File passed to Electron launch.
 * @param native Identity read inside native main.
 * @param descriptor Expected platform and runtime descriptor.
 * @param smokeRoot Owned directory for direct AppImage snapshots.
 * @returns Packaged identity without converting direct AppImage launches into extracted launches.
 */
export async function captureNativePackagedBaseIdentity(
  executable: string, native: NativePackagedBaseObservation, descriptor: DesktopBaseSmokeDescriptor, smokeRoot: string,
): Promise<BaseSmokeInstalledIdentity> {
  if (descriptor.platform === 'linux' && (native.appImage !== null || native.appDir !== null || executable.endsWith('.AppImage'))) {
    if (native.appImage === null || native.appDir === null || native.mountInfo === null) throw new Error('Direct AppImage native mount observations are missing.')
    return await capturePackagedAppImageIdentity(executable, { appImage: native.appImage, appDir: native.appDir,
      executablePath: native.executablePath, resourcesDirectory: native.resources, appPath: native.appPath,
      mountInfo: native.mountInfo }, native.desktopVersion, descriptor, smokeRoot)
  }
  if (await realpath(executable) !== await realpath(native.executablePath)) throw new Error('Packaged launch executable differs from native process.execPath.')
  return await capturePackagedBaseIdentity(executable, native.resources, native.appPath, native.desktopVersion, descriptor)
}

/** Result shared with native installer drivers; the receipt can still be partial. */
export interface PackagedDesktopBaseSmokeResult {
  composition: 'base'
  activeSessionId: string
  activeSessionTitle: string
  protectedPaths: string[]
  primaryDisplayScaleFactor: number
  rendererDevicePixelRatio: number
  harnessHome: string
  userData: string
  workspacePath: string
  receiptPath: string
}

/** Close one owned application without equating an unavailable process tree with an empty tree.
 * @param options Native process observations, quit operation and bounded quiescence check.
 * @returns Only when a complete pre-quit tree was observed and every observed process stopped.
 */
export async function closeBaseSmokeOwnedApplication(options: {
  rootPid: number
  record: (pids: readonly number[]) => void
  discover: () => Promise<number[]>
  quit: () => Promise<void>
  waitForQuiescence: (pids: readonly number[]) => Promise<void>
}): Promise<void> {
  options.record([options.rootPid])
  let tree: number[] | undefined
  let discoveryError: unknown
  try {
    tree = await options.discover()
    if (!tree.includes(options.rootPid)) throw new Error('Owned process inventory omitted its root.')
    options.record(tree)
  } catch (error) { discoveryError = error }
  try { await options.quit() } catch (error) {
    if (discoveryError !== undefined) throw new AggregateError([discoveryError, error], 'Process discovery and native quit failed.')
    throw error
  }
  if (discoveryError !== undefined) throw discoveryError
  if (tree === undefined) throw new Error('Owned process inventory remains unknown.')
  await options.waitForQuiescence(tree)
}

/** Narrow launch parameters preserve the actual package executable at every display scale. */
export interface PackagedDesktopBaseSmokeOptions { scalePercent?: 100 | 150 }

/** @param scalePercent Requested native scale. @returns Fixed Chromium scale arguments, never a wrapper command. */
export function baseSmokeScaleArguments(scalePercent?: 100 | 150): string[] {
  if (scalePercent === undefined) return []
  if (scalePercent !== 100 && scalePercent !== 150) throw new Error('Unsupported base smoke display scale.')
  return [`--force-device-scale-factor=${String(scalePercent / 100)}`]
}

/**
 * Create only physical descendant directories without traversing existing symlinks.
 * @param root - existing caller-owned isolation directory.
 * @param path - requested descendant directory.
 * @returns physical created or existing directory inside the isolation root.
 */
export async function prepareOwnedBaseSmokeDirectory(root: string, path: string): Promise<string> {
  const local = relative(resolve(root), resolve(path))
  if (local === '' || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error('Smoke directory is outside its isolation root.')
  let current = await realpath(root)
  for (const segment of local.split(sep)) {
    current = join(current, segment)
    try { await mkdir(current) } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
    if (!(await lstat(current)).isDirectory()) throw new Error('Smoke paths require a physical directory at every parent.')
  }
  return await confinedBaseSmokePath(root, current)
}

async function until(test: () => Promise<boolean>, message: string, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!await test()) {
    if (Date.now() > deadline) throw new Error(message)
    await delay(100)
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

async function portOpen(port: number): Promise<boolean> {
  return await new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (open: boolean): void => { socket.destroy(); resolvePort(open) }
    socket.once('connect', () => { finish(true) })
    socket.once('error', () => { finish(false) })
    socket.setTimeout(500, () => { finish(false) })
  })
}

async function processTree(rootPid: number, platform: NodeJS.Platform): Promise<number[]> {
  const exec = promisify(execFile)
  let rows: { pid: number; parent: number }[]
  if (platform === 'win32') {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'], { timeout: 15_000, shell: false })
    const parsed: unknown = JSON.parse(stdout)
    const values: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
    rows = values.map((value) => {
      if (typeof value !== 'object' || value === null || !('ProcessId' in value) || !('ParentProcessId' in value)
        || typeof value.ProcessId !== 'number' || typeof value.ParentProcessId !== 'number') throw new Error('Invalid Windows native process inventory.')
      return { pid: value.ProcessId, parent: value.ParentProcessId }
    })
  } else {
    const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid='], { timeout: 15_000 })
    rows = stdout.split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line)
      return match === null ? [] : [{ pid: Number(match[1]), parent: Number(match[2]) }]
    })
  }
  if (!rows.some(row => row.pid === rootPid)) throw new Error('Owned root exited before its complete process inventory was observed.')
  const owned = new Set([rootPid])
  for (let changed = true; changed;) {
    changed = false
    for (const row of rows) if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); changed = true }
  }
  return [...owned]
}

async function nativeQuit(application: ElectronApplication, platform: NodeJS.Platform): Promise<void> {
  const closed = application.waitForEvent('close', { timeout: 30_000 }).then(() => undefined, (error: unknown) => error)
  try {
    await application.evaluate(({ app, BrowserWindow }, target) => {
      if (target === 'win32') {
        const window = BrowserWindow.getAllWindows()[0]
        if (window === undefined) throw new Error('Missing native window for Windows close.')
        window.close()
      } else app.quit()
    }, platform)
    const error = await closed
    if (error !== undefined) throw error
  } catch (error) {
    await application.close().catch(() => undefined)
    await closed
    throw error
  }
}

/** Only the public locator operations used by the fixed onboarding sequence. */
export interface PackagedBaseReadyPage {
  getByRole(role: 'dialog', options?: { name: RegExp }): Pick<Locator, 'waitFor' | 'isVisible'> & {
    getByRole(role: 'button', options: { name: RegExp }): Pick<Locator, 'scrollIntoViewIfNeeded' | 'evaluate' | 'click'>
  }
  locator(selector: string): Pick<Locator, 'waitFor' | 'click'>
}

/**
 * Complete the known official startup steps through normal UI before admitting transcript interactions.
 * Expected steps must appear even when the composer was already painted behind them.
 * @param page Native renderer; the narrow face also supports deterministic sequencing tests.
 * @param expectation The controlled fixture's welcome acknowledgement and usable-provider state, plus a bounded wait.
 * @returns Actual button hit tests; acknowledgements change only through normal UI, with no credential configuration.
 */
export async function waitForPackagedBaseReady(page: PackagedBaseReadyPage, expectation: {
  welcome: 'expected' | 'acknowledged'
  credentials: 'configured' | 'missing'
  timeoutMs?: number
}): Promise<{ continueHit: boolean; configureLaterHit: boolean }> {
  const timeout = expectation.timeoutMs ?? 60_000
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('A positive native startup wait is required.')
  const notice = page.getByRole('dialog', { name: /^(?:Internal Testing Notice|内测声明)$/u })
  const credential = page.getByRole('dialog', { name: /^(?:Add an API key to get started|添加一个 API Key 开始使用)$/u })
  async function complete(dialog: ReturnType<PackagedBaseReadyPage['getByRole']>, name: RegExp): Promise<void> {
    const button = dialog.getByRole('button', { name })
    await button.scrollIntoViewIfNeeded({ timeout })
    const hit = await button.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      return bounds.width > 0 && bounds.height > 0 && bounds.x >= 0 && bounds.y >= 0
        && bounds.right <= innerWidth && bounds.bottom <= innerHeight && (hit === element || (hit !== null && element.contains(hit)))
    })
    if (!hit) throw new Error('The named onboarding button is not reachable in the native viewport.')
    await button.click({ timeout })
    await dialog.waitFor({ state: 'detached', timeout })
  }
  let continueHit = false
  if (expectation.welcome === 'expected') await notice.waitFor({ state: 'visible', timeout })
  if (expectation.welcome === 'expected' || await notice.isVisible()) { await complete(notice, /^(?:Continue|继续)$/u); continueHit = true }
  let configureLaterHit = false
  if (expectation.credentials === 'missing') await credential.waitFor({ state: 'visible', timeout })
  if (expectation.credentials === 'missing' || await credential.isVisible()) { await complete(credential, /^(?:Configure later|稍后配置)$/u); configureLaterHit = true }
  // Unknown dialogs are never dismissed, and inert or masked composers cannot pass a trial interaction.
  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout })
  const composer = page.locator('[data-composer-input][contenteditable="true"]:not([aria-disabled="true"])')
  await composer.waitFor({ state: 'visible', timeout })
  await composer.click({ trial: true, timeout })
  return { continueHit, configureLaterHit }
}

async function command(application: ElectronApplication, name: 'new-session' | 'open-settings'): Promise<void> {
  await application.evaluate(({ BrowserWindow }, value) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) throw new Error('Missing native base window.')
    window.webContents.send('desktop:command', value)
  }, name)
}

async function reopenSession(page: Page): Promise<void> {
  const row = page.locator('[role="treeitem"][aria-selected]').filter({ has: page.getByText(NATIVE_READER_TITLE, { exact: true }) })
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  if (await row.count() !== 1) throw new Error('Native title did not identify one official session row.')
  await row.click()
  await page.getByRole('heading', { name: 'Native reader verified', exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  if (await row.getAttribute('aria-selected') !== 'true') throw new Error('Native reader session was not selected.')
}

async function completedSession(harnessHome: string): Promise<{ id: string; logPath: string; cwd: string }> {
  const cache = join(harnessHome, 'storages/session_projcache/sessions')
  let result: { id: string; logPath: string; cwd: string } | undefined
  await until(async () => {
    let names: string[]
    try { names = await readdir(cache) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
      throw error
    }
    const matches: { id: string; cwd: string }[] = []
    for (const name of names.filter(name => name.endsWith('.json'))) {
      const value: unknown = JSON.parse(await readFile(join(cache, name), 'utf8'))
      if (typeof value !== 'object' || value === null || !('record' in value)) continue
      const projection = value.record as { identity?: { cwd?: unknown }; rows?: { title?: { val?: unknown } } }
      if (projection.rows?.title?.val === NATIVE_READER_TITLE && typeof projection.identity?.cwd === 'string') matches.push({ id: name.slice(0, -5), cwd: projection.identity.cwd })
    }
    if (matches.length !== 1) return false
    const match = matches[0]
    if (match === undefined || !/^session-[a-z0-9-]+$/iu.test(match.id)) throw new Error('Invalid persisted native session id.')
    const logs: string[] = []
    const visit = async (path: string): Promise<void> => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const next = join(path, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) await visit(next)
        else if (basename(dirname(next)) === match.id && /^session\.v3\.jsonl(?:\.zstd)?$/u.test(entry.name)) logs.push(next)
      }
    }
    await visit(join(harnessHome, 'sessions'))
    if (logs.length !== 1 || logs[0] === undefined) return false
    result = { ...match, logPath: logs[0] }
    return true
  }, 'A durable official v3 session and its native title were not recorded.')
  if (result === undefined) throw new Error('Native completed session is missing.')
  return result
}

/**
 * Run the real official UI against a local one-turn provider and preserve a strict partial receipt.
 * Legacy and pause/recovery continuations are separate required scenarios; their absence never becomes a final pass.
 * @param executable - actual packaged Electron executable; an explicit stage development run stays partial.
 * @param platform - native operating system, required to match this process.
 * @param options - optional direct-executable display-scale override.
 * @returns isolated paths and the fixed receipt path after owned processes and ports have closed.
 */
export async function runPackagedDesktopBaseSmoke(
  executable: string, platform: NodeJS.Platform, options: PackagedDesktopBaseSmokeOptions = {},
): Promise<PackagedDesktopBaseSmokeResult> {
  const scaleArguments = baseSmokeScaleArguments(options.scalePercent)
  if (platform !== process.platform || process.arch !== 'x64' || !['darwin', 'win32', 'linux'].includes(platform)) throw new Error('Base smoke requires the matching native x64 host.')
  const descriptorPath = process.env.DSH_DESKTOP_SMOKE_DESCRIPTOR
  if (descriptorPath === undefined) throw new Error('DSH_DESKTOP_SMOKE_DESCRIPTOR must name the actual base stage descriptor.')
  const descriptor = validateDesktopBaseSmokeDescriptor(JSON.parse(await readFile(descriptorPath, 'utf8')) as unknown)
  if (descriptor.platform !== platform) throw new Error('The installed base smoke descriptor targets another platform.')
  const defaultRoot = resolve(import.meta.dirname, '../../../.artifacts/r7/base-smoke')
  await mkdir(defaultRoot, { recursive: true })
  const smokeRoot = await realpath(process.env.DSH_DESKTOP_SMOKE_ROOT ?? await mkdtemp(join(defaultRoot, 'run-')))
  const harnessHome = resolve(process.env.DSH_DESKTOP_SMOKE_DSH_HOME ?? join(smokeRoot, 'home/.dsh'))
  const userData = resolve(process.env.DSH_DESKTOP_SMOKE_USER_DATA ?? join(smokeRoot, 'electron-data'))
  const workspacePath = join(smokeRoot, 'workspace')
  for (const path of [harnessHome, userData, workspacePath, join(smokeRoot, 'checks'), join(smokeRoot, 'home/Desktop')]) {
    await prepareOwnedBaseSmokeDirectory(smokeRoot, path)
  }
  const receiptPath = join(smokeRoot, 'base-smoke-receipt.json')
  const legacyReceiptPath = process.env.DSH_DESKTOP_SMOKE_LEGACY_FIXTURE
  const legacy = legacyReceiptPath === undefined ? undefined
    : await verifyBaseLegacyFixture(legacyReceiptPath, { isolationRoot: smokeRoot, platform })
  if (legacy !== undefined && await realpath(legacy.dshHome) !== await realpath(harnessHome)) {
    throw new Error('The native base smoke is not reading the verified historical Harness home.')
  }
  const legacyProtected = legacy === undefined ? [] : await Promise.all(legacy.protectedPaths.map(baseSmokeFile))
  const sentinel = join(workspacePath, 'base-smoke-protected.txt')
  await writeFile(sentinel, 'Owned native smoke sentinel; this is not a historical fixture.\n', { flag: 'wx' })
  const protectedBefore = await baseSmokeFile(sentinel)
  const provider = await startReaderSmokeProvider()
  const ports = new Set([Number(new URL(provider.url).port)])
  const pids = new Set<number>()
  let application: ElectronApplication | undefined
  let page: Page | undefined
  let receipt: PackagedDesktopBaseSmokeReceipt | undefined
  let completedLog: string | undefined
  let nativeQuiescent = true
  let firstFailure: unknown
  const settingsPath = join(harnessHome, 'settings.yaml')
  let oldSettings: Buffer | undefined
  let effectiveSettingsFile: BaseSmokeFile | undefined
  try { oldSettings = await readFile(settingsPath) } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { await provider.close(); throw error }
  }
  const smokeSettings = `agent-default-model:\n  provider: desktop-smoke\n  model: native-thinker\n  reasoningEffort: high\nllm-pi-ai:\n  providers:\n    desktop-smoke:\n      displayName: Desktop Smoke\n      apiKeyEnv: DSH_DESKTOP_SMOKE_MODEL_KEY\n      api: openai-completions\n      baseURL: ${provider.url}\n      reasoning: high\n      models:\n        - id: native-thinker\n          name: Native Smoke Thinker\n          contextWindow: 65536\n          maxTokens: 4096\n          reasoningEfforts:\n            high: high\n`
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|ELECTRON_RUN_AS_NODE|^APPIMAGE$|^APPDIR$/iu.test(entry[0])))
  Object.assign(env, { HOME: join(smokeRoot, 'home'), USERPROFILE: join(smokeRoot, 'home'), DSH_HOME: harnessHome,
    CODEX_HOME: join(smokeRoot, 'home/codex'), DSH_TELEMETRY_DISABLED: '1', DSH_DESKTOP_SMOKE_MODEL_KEY: 'desktop-smoke-placeholder-key',
    DEEPSEEK_API_KEY: '', DEEPSEEK_BASE_URL: provider.url })
  const developmentStage = process.env.DSH_DESKTOP_SMOKE_STAGE
  const launchArguments = [...developmentStage === undefined ? [] : [resolve(developmentStage)], `--user-data-dir=${userData}`, ...scaleArguments]
  const launch = async (): Promise<ElectronApplication> => {
    nativeQuiescent = false
    const launched = await electron.launch({ executablePath: resolve(executable), args: launchArguments,
      cwd: workspacePath, env, chromiumSandbox: platform === 'linux', timeout: 90_000 })
    const pid = launched.process().pid
    if (pid !== undefined) pids.add(pid)
    return launched
  }
  const mark = async (check: BaseSmokeCheck, facts: Record<string, unknown>): Promise<void> => {
    if (receipt === undefined) throw new Error('Native smoke receipt identity has not been established.')
    const evidence: BaseSmokeEvidence = { schema: 1, runId: receipt.runId, check, status: 'passed', descriptorSha256: receipt.descriptor.sha256,
      executableSha256: receipt.installed.executable.sha256, events: [...BASE_SMOKE_EVENTS[check]], facts }
    const path = join(smokeRoot, 'checks', `${check}.json`)
    await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
    receipt.checks[check] = { status: 'passed', evidence: await baseSmokeFile(path) }
  }
  const closeOwned = async (): Promise<void> => {
    if (application === undefined) return
    const pid = application.process().pid
    if (pid === undefined) throw new Error('Native Electron PID is missing.')
    const owned = application
    await closeBaseSmokeOwnedApplication({ rootPid: pid,
      record: (tree) => { for (const processId of tree) pids.add(processId) },
      discover: () => processTree(pid, platform),
      quit: async () => { await nativeQuit(owned, platform); application = undefined },
      waitForQuiescence: async (tree) => {
        await until(async () => tree.every(processId => !alive(processId)), 'Owned Electron/Harness process remained after native quit.', 30_000)
      },
    })
    const harnessPorts = [...ports].filter(port => port !== Number(new URL(provider.url).port))
    await until(async () => (await Promise.all(harnessPorts.map(portOpen))).every(open => !open), 'Owned Harness port remained open after native quit.')
    nativeQuiescent = true
  }
  try {
    if (oldSettings !== undefined) await writeFile(join(smokeRoot, 'checks/settings-original.yaml'), oldSettings, { flag: 'wx' })
    const original: unknown = oldSettings === undefined ? {} : load(oldSettings.toString('utf8'), { schema: JSON_SCHEMA })
    const model = load(smokeSettings, { schema: JSON_SCHEMA }) as Record<string, unknown>
    if (typeof original !== 'object' || original === null || Array.isArray(original)) throw new Error('Existing fixture model settings must be a YAML map.')
    const originalMap = original as Record<string, unknown>
    const llm = originalMap['llm-pi-ai']
    if (llm !== undefined && (typeof llm !== 'object' || llm === null || Array.isArray(llm))) throw new Error('Existing fixture provider settings must be a map.')
    const oldLlm = (llm ?? {}) as Record<string, unknown>
    const providers = oldLlm.providers
    if (providers !== undefined && (typeof providers !== 'object' || providers === null || Array.isArray(providers))) throw new Error('Existing fixture provider registry must be a map.')
    const modelLlm = model['llm-pi-ai'] as { providers: Record<string, unknown> }
    const effective = { ...originalMap, 'agent-default-model': model['agent-default-model'],
      'llm-pi-ai': { ...oldLlm, providers: { ...providers as Record<string, unknown> | undefined, ...modelLlm.providers } } }
    await writeFile(settingsPath, dump(effective))
    await writeFile(join(smokeRoot, 'checks/settings-effective.yaml'), await readFile(settingsPath), { flag: 'wx' })
    effectiveSettingsFile = await baseSmokeFile(join(smokeRoot, 'checks/settings-effective.yaml'))
    application = await launch()
    page = await application.firstWindow({ timeout: 90_000 })
    const native = await application.evaluate(({ app, screen, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (window === undefined) throw new Error('Native base window is missing.')
      const resources = Reflect.get(process, 'resourcesPath') as unknown
      if (typeof resources !== 'string') throw new Error('Native resources path is missing.')
      const bounds = window.getBounds()
      const appImage = process.platform === 'linux' ? process.env.APPIMAGE ?? null : null
      const appDir = process.platform === 'linux' ? process.env.APPDIR ?? null : null
      const mountInfo = appImage === null && appDir === null ? null
        : process.getBuiltinModule('node:fs').readFileSync('/proc/self/mountinfo', 'utf8')
      return { packaged: app.isPackaged, appPath: app.getAppPath(), desktopVersion: app.getVersion(), resources,
        userData: app.getPath('userData'), platform: process.platform, arch: process.arch,
        executablePath: process.execPath, appImage, appDir, mountInfo,
        argv: process.argv, scaleSwitch: app.commandLine.getSwitchValue('force-device-scale-factor'),
        scale: screen.getPrimaryDisplay().scaleFactor, bounds, workArea: screen.getDisplayMatching(bounds).workArea }
    })
    if (await realpath(native.userData) !== await realpath(userData) || native.platform !== platform || native.arch !== 'x64') throw new Error('Native isolation or host identity mismatch.')
    const descriptorFile = await baseSmokeFile(descriptorPath)
    if (!native.packaged) {
      if (developmentStage === undefined || await realpath(native.appPath) !== await realpath(developmentStage)) {
        throw new Error('A development Electron launch requires its exact explicit DSH_DESKTOP_SMOKE_STAGE.')
      }
      const runtime = resolveDesktopRuntime(join(native.appPath, 'package.json'))
      if (native.desktopVersion !== descriptor.desktopVersion || runtime.kind !== 'base' || runtime.harnessVersion !== descriptor.harnessVersion) {
        throw new Error('Actual development stage identity differs from the selected base descriptor.')
      }
    }
    const installed = native.packaged
      ? await captureNativePackagedBaseIdentity(executable, native, descriptor, smokeRoot)
      : { mode: 'development-stage' as const, executable: await baseSmokeFile(executable), resourcesDirectory: native.resources, appPath: native.appPath,
        desktopVersion: native.desktopVersion, harnessVersion: descriptor.harnessVersion, officialSourceSha: descriptor.officialSourceSha,
        files: [await baseSmokeFile(join(native.appPath, 'package.json')), await baseSmokeFile(join(native.appPath, 'desktop-composition.json')),
          await baseSmokeFile(join(native.appPath, 'official-runtime/provenance.json'))] }
    const rendererDevicePixelRatio = await page.evaluate(() => window.devicePixelRatio)
    if (options.scalePercent !== undefined && Math.abs(rendererDevicePixelRatio - options.scalePercent / 100) > 0.01) {
      throw new Error('Native renderer did not apply the requested display scale.')
    }
    await writeFile(join(smokeRoot, 'checks/native-launch.json'), `${JSON.stringify({ executable: resolve(executable),
      arguments: launchArguments, nativeArguments: native.argv, appliedScaleSwitch: native.scaleSwitch,
      requestedScalePercent: options.scalePercent ?? null,
      primaryDisplayScaleFactor: native.scale, rendererDevicePixelRatio }, null, 2)}\n`, { flag: 'wx' })
    receipt = { schema: 1, composition: 'base', runId: randomUUID(), platform, arch: 'x64', outcome: 'partial', descriptor: descriptorFile, installed,
      smokeRoot, harnessHome: await realpath(harnessHome), userData: await realpath(userData), workspacePath: await realpath(workspacePath),
      activeSessionId: '', activeSessionTitle: NATIVE_READER_TITLE,
      protectedFiles: [protectedBefore, ...legacyProtected, await baseSmokeFile(join(smokeRoot, 'checks/native-launch.json'))],
      primaryDisplayScaleFactor: native.scale, rendererDevicePixelRatio,
      checks: Object.fromEntries(Object.keys(BASE_SMOKE_EVENTS).filter(key => key !== 'windowsDirectoryPicker' || platform === 'win32')
        .map(key => [key, { status: 'not-run' as const, reason: 'No completed native scenario evidence yet.' }])) }
    if (native.packaged) await mark('installedIdentity', { appPath: native.appPath, desktopVersion: native.desktopVersion })
    const firstRun = await waitForPackagedBaseReady(page, { welcome: 'expected', credentials: 'configured' })
    const { bounds, workArea } = native
    if (bounds.x < workArea.x || bounds.y < workArea.y || bounds.x + bounds.width > workArea.x + workArea.width
      || bounds.y + bounds.height > workArea.y + workArea.height) throw new Error('The native first-run window is outside its display work area.')
    await mark('firstRun', { ...firstRun, bounds, workArea })
    const url = new URL(page.url())
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || Number(url.port) <= 0) throw new Error('Base app did not expose its owned random loopback endpoint.')
    ports.add(Number(url.port))
    if (platform === 'win32') { await exerciseWindowsDirectoryPicker(page, harnessHome, userData); await mark('windowsDirectoryPicker', { selectedDirectory: join(harnessHome, 'native-picker-selected') }) }
    await command(application, 'new-session')
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.waitFor({ state: 'visible', timeout: 30_000 })
    provider.arm()
    await input.fill(NATIVE_READER_PROMPT)
    await input.press('Enter')
    await until(async () => provider.phase === 'thinking', 'The official base did not call the local native provider.')
    const thinking = page.locator('[data-variant="think"]').last()
    await thinking.waitFor({ state: 'visible', timeout: 30_000 })
    const disclosure = thinking.locator('[aria-expanded]')
    if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click()
    await until(async () => (await thinking.innerText()).includes('Line 01:'), 'Official reasoning text was not visible.')
    provider.append()
    await until(async () => (await thinking.innerText()).includes('中文 👨‍👩‍👧‍👦 é.'), 'Unicode reasoning append was not preserved.')
    provider.answer()
    await page.getByRole('heading', { name: 'Native reader verified', exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
    await page.locator('pre code').filter({ hasText: 'const nativeReader = true' }).waitFor({ state: 'visible' })
    await page.getByRole('cell', { name: 'Preserved', exact: true }).waitFor({ state: 'visible' })
    provider.finish()
    await until(async () => provider.acceptedTitleRequests === 1, 'Official automatic title did not complete.')
    await page.getByText(NATIVE_READER_TITLE, { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 })
    const session = await completedSession(harnessHome)
    receipt.activeSessionId = session.id
    completedLog = session.logPath
    receipt.workspacePath = await confinedBaseSmokePath(smokeRoot, session.cwd)
    await mark('modelTurn', { acceptedRequests: provider.acceptedRequests, acceptedTitleRequests: provider.acceptedTitleRequests,
      unexpectedRequests: provider.requests, phase: provider.phase, reasoningVisible: true, unicodeVisible: true, markdownVisible: true })
    await mark('title', { sessionId: session.id, title: NATIVE_READER_TITLE })
    await page.screenshot({ path: join(smokeRoot, 'reader.png') })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForPackagedBaseReady(page, { welcome: 'acknowledged', credentials: 'configured' })
    await reopenSession(page)
    await mark('reload', { sessionId: session.id, title: NATIVE_READER_TITLE })
    await command(application, 'new-session')
    await page.getByRole('heading', { name: 'Native reader verified', exact: true }).waitFor({ state: 'detached', timeout: 30_000 })
    await reopenSession(page)
    await mark('reopen', { sessionId: session.id, title: NATIVE_READER_TITLE })
    await command(application, 'open-settings')
    const dialog = page.getByRole('dialog').last()
    await dialog.getByRole('button', { name: /^(?:System Update|系统更新)$/u }).click()
    const section = dialog.locator('[data-system-update-section]')
    await section.waitFor({ state: 'visible', timeout: 30_000 })
    const update = await page.evaluate(async () => await window.dshDesktop?.getUpdateStatus?.())
    if (!isDesktopUpdateSnapshot(update) || update.runningDesktop !== installed.desktopVersion
      || update.includedHarness !== installed.harnessVersion
      || update.platform !== platform) throw new Error('Native System Update versions differ from the installed base.')
    await until(async () => (await section.innerText()).includes(`v${installed.desktopVersion}`) && (await section.innerText()).includes(`v${installed.harnessVersion}`), 'Visible native versions are missing.')
    await mark('systemUpdate', { desktopVersion: update.runningDesktop, harnessVersion: update.includedHarness, platform: update.platform })
    await page.screenshot({ path: join(smokeRoot, 'system-update.png') })
    await page.keyboard.press('Escape')
    if (platform === 'win32') await page.evaluate(async () => { await window.dshDesktop?.setDesktopPreference({ key: 'closeBehavior', value: 'quit' }) })
    await closeOwned()
    application = await launch()
    page = await application.firstWindow({ timeout: 90_000 })
    await waitForPackagedBaseReady(page, { welcome: 'acknowledged', credentials: 'configured' })
    ports.add(Number(new URL(page.url()).port))
    await reopenSession(page)
    await mark('restart', { sessionId: session.id, title: NATIVE_READER_TITLE })
    await closeOwned()
    await provider.close()
    if (provider.acceptedRequests !== 1 || provider.acceptedTitleRequests !== 1 || provider.requests.length !== 0) throw new Error('Unexpected provider activity occurred across reload/reopen/restart.')
    await until(async () => [...pids].every(pid => !alive(pid)), 'Native smoke left owned processes alive.')
    await until(async () => (await Promise.all([...ports].map(portOpen))).every(open => !open), 'Native smoke left owned ports listening.')
    await mark('processCleanup', { pids: [...pids], alivePids: [] })
    await mark('portCleanup', { ports: [...ports], listeningPorts: [] })
    if (JSON.stringify(await baseSmokeFile(sentinel)) !== JSON.stringify(protectedBefore)) throw new Error('The protected owned workspace file changed.')
    const completedSnapshot = join(smokeRoot, 'checks', 'completed-session', basename(completedLog))
    await mkdir(dirname(completedSnapshot), { recursive: true })
    await writeFile(completedSnapshot, await readFile(completedLog), { flag: 'wx' })
    receipt.protectedFiles.push(await baseSmokeFile(completedSnapshot))
    if (legacyReceiptPath !== undefined) {
      await verifyBaseLegacyFixture(legacyReceiptPath, { isolationRoot: smokeRoot, platform })
      receipt.checks.legacyCompatibility = { status: 'not-run', reason: 'Actual historical files and workspace membership remain verified; reopening the old session in base is a separate pending scenario.' }
    }
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
    return { composition: 'base', activeSessionId: receipt.activeSessionId, activeSessionTitle: receipt.activeSessionTitle,
      protectedPaths: receipt.protectedFiles.map(file => file.path), primaryDisplayScaleFactor: receipt.primaryDisplayScaleFactor,
      rendererDevicePixelRatio: receipt.rendererDevicePixelRatio, harnessHome, userData, workspacePath: receipt.workspacePath, receiptPath }
  } catch (error) {
    firstFailure = error
    if (page !== undefined) await page.screenshot({ path: join(smokeRoot, 'failure.png') }).catch(() => undefined)
    await writeFile(join(smokeRoot, 'failure.json'), `${JSON.stringify({ error: String(error), checks: receipt?.checks ?? {}, provider: {
      acceptedRequests: provider.acceptedRequests, acceptedTitleRequests: provider.acceptedTitleRequests,
      unexpectedRequests: provider.requests, phase: provider.phase,
    } }, null, 2)}\n`)
    throw error
  } finally {
    try {
      if (application !== undefined) await closeOwned()
    } finally {
      try { await provider.close() } finally {
        if (!nativeQuiescent || [...pids].some(alive)) throw new Error('Settings restoration is withheld until the complete owned native process tree is confirmed quiescent.', { cause: firstFailure })
        if (oldSettings === undefined) await rm(settingsPath, { force: true })
        else await writeFile(settingsPath, oldSettings)
        await writeFile(join(smokeRoot, 'checks/settings-restoration.json'), `${JSON.stringify({
          original: oldSettings === undefined ? null : await baseSmokeFile(join(smokeRoot, 'checks/settings-original.yaml')),
          effective: effectiveSettingsFile ?? null,
          restored: oldSettings === undefined ? null : await baseSmokeFile(settingsPath),
          changedSettings: ['agent-default-model', 'llm-pi-ai.providers.desktop-smoke'], nativeProcessesAlive: [],
        }, null, 2)}\n`)
      }
    }
  }
}
