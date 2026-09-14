import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { verifyBaseLegacyFixture } from './base-legacy-fixture.ts'
import { completeWindowsCoreHistory, reopenWindowsCoreHistory, windowsCorePortListening,
  waitForWindowsCoreProcessesStopped, windowsCoreProcessTree } from './windows-core-native.ts'
import { closeBaseSmokeOwnedApplication, waitForPackagedBaseReady, runPackagedDesktopBaseSmoke,
  type PackagedDesktopBaseSmokeResult } from './packaged-base-smoke.ts'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const execFileAsync = promisify(execFile)
const executable = process.env.DSH_WINDOWS_DESKTOP_EXECUTABLE
  ?? join(repositoryRoot, 'apps/desktop/release/win-unpacked/DeepSeek Harness.exe')

async function protectedSnapshot(paths: readonly string[]): Promise<string[]> {
  return await Promise.all(paths.map(async path => createHash('sha256').update(await readFile(path)).digest('hex')))
}

async function windowsProcessOutput(): Promise<string> {
  const { stdout, stderr } = await execFileAsync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; $rows = @(Get-CimInstance Win32_Process -ErrorAction Stop | "
      + 'Select-Object ProcessId,ParentProcessId); ConvertTo-Json -InputObject $rows -Compress',
  ], { timeout: 30_000 })
  if (stderr.trim() !== '') throw new Error('Native process query reported an error.')
  return stdout
}

async function windowsProcessTree(rootPid: number): Promise<number[]> {
  return windowsCoreProcessTree(rootPid, await windowsProcessOutput())
}

async function exerciseWindows150PercentSurface(
  executablePath: string,
  seeded: PackagedDesktopBaseSmokeResult,
): Promise<void> {
  const smokeRoot = process.env.DSH_DESKTOP_SMOKE_ROOT
  const harnessHome = process.env.DSH_DESKTOP_SMOKE_DSH_HOME
  const userData = process.env.DSH_DESKTOP_SMOKE_USER_DATA
  if (smokeRoot === undefined || harnessHome === undefined || userData === undefined) {
    throw new Error('Windows 150 percent smoke requires the isolated Setup lifecycle directories.')
  }
  expect(seeded.composition).toBe('base')
  expect(resolve(seeded.harnessHome)).toBe(resolve(harnessHome))
  expect(resolve(seeded.userData)).toBe(resolve(userData))
  expect(seeded.protectedPaths.length).toBeGreaterThan(0)
  const protectedBefore = await protectedSnapshot(seeded.protectedPaths)
  const legacy = await verifyBaseLegacyFixture(join(smokeRoot, 'legacy-fixture.json'), { isolationRoot: smokeRoot, platform: 'win32' })
  const tracked = new Set<number>()
  const ports = new Set<number>()
  let application: ElectronApplication | undefined
  let processRoot: number | undefined
  try {
    await mkdir(join(smokeRoot, 'Desktop'), { recursive: true })
    application = await electron.launch({
      executablePath,
      args: ['--user-data-dir=' + userData, '--force-device-scale-factor=1.5'],
      cwd: smokeRoot,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/iu.test(key))),
        HOME: smokeRoot, USERPROFILE: smokeRoot,
        DSH_HOME: harnessHome,
        DSH_DESKTOP_SMOKE_MODEL_KEY: 'desktop-smoke-placeholder-key',
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: '',
      },
      timeout: 120_000,
    })
    const launcherPid = application.process().pid
    if (launcherPid === undefined) throw new Error('Windows 150 percent smoke has no launcher PID.')
    processRoot = launcherPid
    tracked.add(launcherPid)
    for (const pid of await windowsProcessTree(launcherPid)) tracked.add(pid)
    const mainPid = await application.evaluate(() => process.pid)
    processRoot = mainPid
    tracked.add(mainPid)
    const observed = await application.evaluate(({ app }) => ({ executable: process.execPath,
      userData: app.getPath('userData'), home: process.env.DSH_HOME }))
    expect(await realpath(observed.executable)).toBe(await realpath(executablePath))
    expect(await realpath(observed.userData)).toBe(await realpath(userData))
    expect(observed.home).toBe(harnessHome)
    for (const pid of await windowsProcessTree(mainPid)) tracked.add(pid)
    const page = await application.firstWindow({ timeout: 120_000 })
    await expect.poll(() => page.locator('body[data-dsh-surface="desktop"]').count(), {
      timeout: 120_000,
    }).toBe(1)
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:/u, { timeout: 60_000 })
    const port = Number(new URL(page.url()).port)
    if (!Number.isSafeInteger(port) || port <= 0) throw new Error('Native continuation Harness port is missing.')
    ports.add(port)
    const onboarding = await waitForPackagedBaseReady(page, { welcome: 'expected', credentials: 'missing' })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio), { timeout: 15_000 }).toBeCloseTo(1.5, 1)
    await expect.poll(() => application?.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor), {
      timeout: 15_000,
    }).toBeCloseTo(1.5, 1)

    const collapsed = page.locator('[data-sidebar-collapsed="true"]')
    if (await collapsed.count() === 1) {
      await page.getByRole('button', { name: /^(?:Open sidebar|打开侧边栏)$/u }).click()
      await collapsed.waitFor({ state: 'detached', timeout: 15_000 })
    }
    await reopenWindowsCoreHistory(page, legacy)
    const sessionRow = page.locator('[role="treeitem"][aria-selected]')
      .filter({ has: page.getByText(seeded.activeSessionTitle, { exact: true }) })
    await sessionRow.waitFor({ state: 'visible', timeout: 30_000 })
    expect(await sessionRow.count()).toBe(1)
    await sessionRow.click()
    await expect.poll(() => sessionRow.getAttribute('aria-selected'), { timeout: 15_000 }).toBe('true')
    await page.locator('[data-composer-input][contenteditable="true"]:not([aria-disabled="true"])')
      .waitFor({ state: 'visible', timeout: 30_000 })
    const composer = page.locator('[data-composer-input][contenteditable="true"]')
    await composer.fill('Windows base 150% input probe')
    await expect.poll(() => composer.innerText(), { timeout: 15_000 }).toBe('Windows base 150% input probe')
    await composer.fill('')

    const nativeGeometry = await application.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (window === undefined) throw new Error('Windows 150 percent smoke has no native window.')
      const bounds = window.getBounds()
      return { bounds, workArea: screen.getDisplayMatching(bounds).workArea }
    })
    const { bounds: nativeBounds, workArea } = nativeGeometry
    expect(nativeBounds.x).toBeGreaterThanOrEqual(workArea.x)
    expect(nativeBounds.y).toBeGreaterThanOrEqual(workArea.y)
    expect(nativeBounds.x + nativeBounds.width).toBeLessThanOrEqual(workArea.x + workArea.width)
    expect(nativeBounds.y + nativeBounds.height).toBeLessThanOrEqual(workArea.y + workArea.height)
    const evidence = {
      schemaVersion: 1, composition: 'base', requestedPercent: 150, viewportMode: 'native-window',
      nativeGeometry, editorInteraction: true, onboarding,
      rendererDevicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
      primaryDisplayScaleFactor: await application.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor),
    }
    const nativeEvidenceRoot = join(repositoryRoot, 'apps/desktop/release/windows-native-visual-evidence')
    await mkdir(nativeEvidenceRoot, { recursive: true })
    await page.screenshot({ path: join(nativeEvidenceRoot, 'renderer-native-150.png') })
    await writeFile(join(nativeEvidenceRoot, 'renderer-native-150.json'), JSON.stringify(evidence, null, 2) + '\n')
    await page.screenshot({ path: join(repositoryRoot, 'apps/desktop/release/desktop-smoke-dpi-150-win32.png') })
    await writeFile(join(repositoryRoot, 'apps/desktop/release/desktop-smoke-dpi-150-win32.json'), JSON.stringify(evidence, null, 2) + '\n')
  } finally {
    const owned = application
    if (owned !== undefined) {
      if (processRoot === undefined) { await owned.close(); throw new Error('Native process ownership is unknown.') }
      const rootPid = processRoot
      await closeBaseSmokeOwnedApplication({
        rootPid,
        record: (pids) => { for (const pid of pids) tracked.add(pid) },
        discover: async () => await windowsProcessTree(rootPid),
        quit: async () => {
          const close = owned.waitForEvent('close', { timeout: 30_000 }).then(() => undefined, (error: unknown) => error)
          try { await owned.evaluate(({ app }) => { app.quit() }) } catch (error) {
            await owned.close()
            await close
            throw error
          }
          const failure = await close
          if (failure !== undefined) { await owned.close(); throw failure }
        },
        waitForQuiescence: async () => { await waitForWindowsCoreProcessesStopped([...tracked], windowsProcessOutput) },
      })
    }
    await expect.poll(async () => await Promise.all([...ports].map(windowsCorePortListening)), {
      timeout: 30_000,
    }).toEqual([...ports].map(() => false))
  }
  expect(await protectedSnapshot(seeded.protectedPaths)).toEqual(protectedBefore)
  const descriptor = process.env.DSH_DESKTOP_SMOKE_DESCRIPTOR
  if (descriptor === undefined) throw new Error('Missing base descriptor for historical continuation.')
  await completeWindowsCoreHistory(smokeRoot, descriptor, [...tracked], [...ports])
}

describe('packaged DeepSeek Harness base desktop on Windows', () => {
  it.skipIf(process.platform !== 'win32' || !existsSync(executable))(
    'boots the real base composition and preserves its data through native 150 percent restart',
    async () => {
      const seeded = await runPackagedDesktopBaseSmoke(executable, 'win32', { scalePercent: 100 })
      await exerciseWindows150PercentSurface(executable, seeded)
      const smokeRoot = process.env.DSH_DESKTOP_SMOKE_ROOT
      if (smokeRoot === undefined) throw new Error('Missing owned base smoke root.')
      // Private cross-process input for the updater driver; never an uploaded artifact.
      await writeFile(join(smokeRoot, 'base-protected-paths.json'),
        JSON.stringify({ schemaVersion: 1, composition: 'base', protectedPaths: seeded.protectedPaths }) + '\n',
        { flag: 'wx', mode: 0o600 })
    },
    300_000,
  )
})
