import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { describe, expect, it } from 'vitest'
import {
  activateSmokeSession,
  descendantProcessTree,
  parseWindowsProcessRows,
  runPackagedDesktopSmoke,
  waitForDesktopSessionReady,
  type WindowsClipboardSmokeState,
} from './packaged-smoke.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const execFileAsync = promisify(execFile)
const executable = process.env.DSH_WINDOWS_DESKTOP_EXECUTABLE
  ?? join(repositoryRoot, 'apps/desktop/release/win-unpacked/DeepSeek Harness.exe')

function isolatedHarnessHome(): string {
  const harnessHome = process.env.DSH_DESKTOP_SMOKE_DSH_HOME
  if (harnessHome === undefined) throw new Error('Windows packaged smoke requires an isolated DSH_HOME.')
  return harnessHome
}

async function windowsProcessTree(rootPid: number): Promise<number[]> {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
  ])
  return descendantProcessTree(rootPid, parseWindowsProcessRows(stdout))
}

async function waitForWindowsProcessesStopped(processIds: readonly number[]): Promise<void> {
  await expect.poll(async () => {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
    ])
    const current = new Set(parseWindowsProcessRows(stdout).map(row => row.processId))
    return processIds.filter(processId => current.has(processId))
  }, { timeout: 30_000 }).toEqual([])
}

async function exerciseWindows150PercentSurface(
  executablePath: string,
  seeded: WindowsClipboardSmokeState,
): Promise<void> {
  const smokeRoot = process.env.DSH_DESKTOP_SMOKE_ROOT
  const harnessHome = process.env.DSH_DESKTOP_SMOKE_DSH_HOME
  const userData = process.env.DSH_DESKTOP_SMOKE_USER_DATA
  if (smokeRoot === undefined || harnessHome === undefined || userData === undefined) {
    throw new Error('Windows 150 percent smoke requires the isolated Setup lifecycle directories.')
  }

  let application: ElectronApplication | undefined
  let closed = false
  try {
    application = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${userData}`, '--force-device-scale-factor=1.5'],
      cwd: smokeRoot,
      env: {
        ...process.env,
        DSH_HOME: harnessHome,
        DSH_DESKTOP_SMOKE_MODEL_KEY: 'desktop-smoke-placeholder-key',
        DSH_TELEMETRY_DISABLED: '1',
        MISSHER_TENCENTDB_DIR: join(smokeRoot, 'memory-source-unconfigured'),
        DEEPSEEK_API_KEY: '',
      },
      timeout: 120_000,
    })
    const page = await application.firstWindow({ timeout: 120_000 })
    await expect.poll(() => page.locator('body[data-dsh-surface="desktop"]').count(), {
      timeout: 120_000,
    }).toBe(1)
    await expect.poll(async () => Promise.all([
      page.locator('[class*="sidebarCol"]').count(),
      page.locator('[class*="centerCol"]').count(),
      page.locator('[class*="detailsCol"]').count(),
    ]), { timeout: 120_000 }).toEqual([1, 1, 0])
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio), { timeout: 15_000 })
      .toBeCloseTo(1.5, 1)
    await expect.poll(() => application?.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor), {
      timeout: 15_000,
    }).toBeCloseTo(1.5, 1)

    const collapsedFrame = page.locator('[data-sidebar-collapsed="true"]')
    if (await collapsedFrame.count() === 1) {
      await page.getByRole('button', { name: /^(?:Open sidebar|打开侧边栏)$/u }).click()
      await collapsedFrame.waitFor({ state: 'detached', timeout: 15_000 })
    }
    // Initial Session selection may automatically expand its Workspace after
    // the shell paints. Wait before reading a group state and toggling it.
    await waitForDesktopSessionReady(page)
    await activateSmokeSession(page, seeded.activeSessionTitle)

    // The product intentionally hides Turn navigation while the center column
    // is narrower than 680px. Selecting the fixture requires temporarily
    // expanding the sidebar at 150%; restore the normal wide reading surface
    // before asserting the rail itself.
    const closeSidebar = page.getByRole('button', { name: /^(?:Collapse sidebar|收起侧边栏)$/u })
    await closeSidebar.click()
    await expect.poll(
      () => page.locator('[class*="frame"][data-sidebar-collapsed]').count(),
      { timeout: 15_000 },
    ).toBe(1)

    const turnRail = page.locator('nav[aria-label*="轮次导航"], nav[aria-label*="Turn navigation"]')
    await turnRail.waitFor({ state: 'attached', timeout: 30_000 })
    const turnRailTrack = turnRail.locator('[data-turn-navigation-track]')
    await expect.poll(() => turnRail.locator('button[aria-label*="跳转"], button[aria-label*="jump to"]').count(), {
      timeout: 15_000,
    }).toBeGreaterThanOrEqual(2)
    const nativeGeometry = await application.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (window === undefined) throw new Error('Windows 150 percent smoke has no native window.')
      const bounds = window.getBounds()
      return { bounds, workArea: screen.getDisplayMatching(bounds).workArea }
    })
    await expect.poll(() => page.locator('[class*="frame"][data-sidebar-collapsed]').evaluate(frame =>
      frame.getAnimations().every(animation => animation.playState !== 'running'
        || !Number.isFinite(animation.effect?.getComputedTiming().endTime))), {
      timeout: 15_000,
    }).toBe(true)
    const queryInlineSize = await turnRail.evaluate(async (rail) => {
      for (let ancestor = rail.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor)
        if (style.containerType === 'normal') continue
        const queryContainer = ancestor
        return await new Promise<number>((resolve, reject) => {
          const observer = new ResizeObserver((entries) => {
            clearTimeout(deadline)
            observer.disconnect()
            const size = entries[0]?.contentBoxSize[0]?.inlineSize
            if (size === undefined) reject(new Error('Turn rail query container has no observed inline size.'))
            else resolve(size)
          })
          const deadline = setTimeout(() => {
            observer.disconnect()
            reject(new Error('Turn rail query container did not report its size.'))
          }, 10_000)
          observer.observe(queryContainer)
        })
      }
      throw new Error('Windows 150 percent smoke could not find the Turn rail query container.')
    })
    expect(Number.isFinite(queryInlineSize) && queryInlineSize > 0).toBe(true)
    const expectedNativeRailState = queryInlineSize <= 584 ? 'hidden' : 'visible'
    await turnRailTrack.waitFor({ state: expectedNativeRailState, timeout: 15_000 })
    const nativeEvidenceRoot = join(repositoryRoot, 'apps/desktop/release/windows-native-visual-evidence')
    await mkdir(nativeEvidenceRoot, { recursive: true })
    await writeFile(join(nativeEvidenceRoot, 'renderer-native-150.json'), `${JSON.stringify({
      schemaVersion: 1,
      nativeGeometry,
      viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })),
      queryInlineSize,
      expectedNativeRailState,
    }, null, 2)}\n`, 'utf8')
    await page.screenshot({ path: join(nativeEvidenceRoot, 'renderer-native-150.png') })
    const { bounds: nativeBounds, workArea } = nativeGeometry
    expect(nativeBounds.x).toBeGreaterThanOrEqual(workArea.x)
    expect(nativeBounds.y).toBeGreaterThanOrEqual(workArea.y)
    expect(nativeBounds.x + nativeBounds.width).toBeLessThanOrEqual(workArea.x + workArea.width)
    expect(nativeBounds.y + nativeBounds.height).toBeLessThanOrEqual(workArea.y + workArea.height)

    // The following rail interaction uses a wide CSS viewport; native small-screen
    // geometry and responsive hiding are recorded above before any override.
    await page.setViewportSize({ width: 1600, height: 1000 })
    // Playwright's viewport setter resets the emulated DPR to 1. The app owns
    // this CDP session until quit; keep the wide interaction at 150 percent.
    const viewportSession = await page.context().newCDPSession(page)
    await viewportSession.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 1000, deviceScaleFactor: 1.5, mobile: false,
    })
    await expect.poll(async () => (await page.locator('[class*="centerCol"]').boundingBox())?.width ?? 0, {
      timeout: 15_000,
    }).toBeGreaterThan(680)
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio), { timeout: 15_000 })
      .toBeCloseTo(1.5, 1)
    await turnRailTrack.waitFor({ state: 'visible', timeout: 30_000 })
    const turnMarks = turnRail.locator('button[aria-label*="跳转"], button[aria-label*="jump to"]')
    await expect.poll(() => turnMarks.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    const currentTurn = turnRail.locator('button[aria-current="true"]')
    await expect.poll(() => currentTurn.count(), { timeout: 15_000 }).toBe(1)
    await currentTurn.waitFor({ state: 'visible', timeout: 15_000 })
    const turnRailBounds = await turnRailTrack.boundingBox()
    const transcriptBounds = await page.locator('[data-chat-flow]').boundingBox()
    if (turnRailBounds === null || transcriptBounds === null) {
      throw new Error('Windows 150 percent smoke could not measure the left Turn rail.')
    }
    expect(turnRailBounds.x + turnRailBounds.width).toBeLessThanOrEqual(transcriptBounds.x)
    await currentTurn.focus()
    await page.getByRole('tooltip').waitFor({ state: 'visible', timeout: 15_000 })

    expect(await page.getByRole('button', { name: /^(?:Open workbench|打开工作台)$/u }).count()).toBe(0)
    expect(await page.locator(
      '[data-desktop-workbench-panel], [data-utility-drawer], [data-side="utility"]',
    ).count()).toBe(0)
    expect(await page.locator(
      '[data-plugin-card="browser-skill"], [data-browser-skill-idle]',
    ).count()).toBe(0)
    expect(await page.locator(
      '[data-plugin-card="open-design"], [data-open-design-state]',
    ).count()).toBe(0)

    const evidence = {
      schemaVersion: 1,
      requestedPercent: 150,
      viewportMode: 'explicit-wide-css-viewport',
      rendererDevicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
      primaryDisplayScaleFactor: await application.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor),
    }
    await Promise.all([
      page.screenshot({
        path: join(repositoryRoot, 'apps/desktop/release/desktop-smoke-dpi-150-win32.png'),
      }),
      writeFile(
        join(repositoryRoot, 'apps/desktop/release/desktop-smoke-dpi-150-win32.json'),
        `${JSON.stringify(evidence, null, 2)}\n`,
        'utf8',
      ),
    ])

    const mainPid = application.process().pid
    if (mainPid === undefined) throw new Error('Windows 150 percent smoke has no Electron PID.')
    const tracked = await windowsProcessTree(mainPid)
    const close = application.waitForEvent('close')
    await application.evaluate(({ app }) => { app.quit() })
    await close
    closed = true
    await waitForWindowsProcessesStopped(tracked)
  } finally {
    if (!closed && application !== undefined) await application.close()
  }
}

describe('packaged DeepSeek Harness desktop on Windows', () => {
  it.skipIf(process.platform !== 'win32' || !existsSync(executable))(
    'boots isolated data, renders the desktop shell, and closes its complete process tree',
    async () => {
      const seeded = await runPackagedDesktopSmoke(executable, 'win32')
      await exerciseWindows150PercentSurface(executable, seeded)
      const link = join(
        isolatedHarnessHome(),
        'profiles',
        'node_modules',
        '@deepseek-ai',
        'dsh-desktop',
      )
      expect(resolve(await readlink(link))).toBe(resolve(dirname(executable), 'resources', 'app.asar'))
    },
    300_000,
  )
})
