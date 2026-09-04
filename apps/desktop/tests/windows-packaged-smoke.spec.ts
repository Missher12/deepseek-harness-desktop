import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { describe, expect, it } from 'vitest'
import {
  descendantProcessTree,
  parseWindowsProcessRows,
  runPackagedDesktopSmoke,
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
    ]), { timeout: 120_000 }).toEqual([1, 1, 1])
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
    const ungrouped = page.getByText(/^(?:Ungrouped|未分组)$/u, { exact: true }).first()
    await ungrouped.waitFor({ state: 'visible', timeout: 30_000 })
    const ungroupedRow = ungrouped.locator('..').locator('..')
    if (await ungroupedRow.getAttribute('aria-expanded') !== 'true') {
      await ungrouped.click()
      await expect.poll(() => ungroupedRow.getAttribute('aria-expanded'), { timeout: 5_000 }).toBe('true')
    }
    // Session rows render under their workspace group, which the 150% layout
    // may keep collapsed; expand it before looking for the seeded row.
    const workspaceRow = page.locator('[class*="projectRow"]')
      .filter({ hasText: seeded.activeSessionTitle }).first()
    await workspaceRow.waitFor({ state: 'visible', timeout: 15_000 })
    if (await workspaceRow.getAttribute('aria-expanded') !== 'true') {
      await workspaceRow.click()
      await expect.poll(() => workspaceRow.getAttribute('aria-expanded'), { timeout: 5_000 }).toBe('true')
    }
    const activeRow = page.locator('[class*="sessionRow"]').filter({ hasText: seeded.activeSessionTitle }).first()
    await activeRow.waitFor({ state: 'visible', timeout: 15_000 })
    await activeRow.click()
    await expect.poll(() => activeRow.getAttribute('aria-selected'), { timeout: 15_000 }).toBe('true')
    const turnRail = page.locator('nav[aria-label*="轮次导航"], nav[aria-label*="Turn navigation"]')
    await turnRail.waitFor({ state: 'visible', timeout: 30_000 })
    const turnMarks = turnRail.locator('button[aria-label*="跳转"], button[aria-label*="jump to"]')
    await expect.poll(() => turnMarks.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    const currentTurn = turnRail.locator('button[aria-current="true"]')
    expect(await currentTurn.count()).toBe(1)
    const turnRailBounds = await turnRail.boundingBox()
    const transcriptBounds = await page.locator('[data-chat-flow]').boundingBox()
    if (turnRailBounds === null || transcriptBounds === null) {
      throw new Error('Windows 150 percent smoke could not measure the left Turn rail.')
    }
    expect(turnRailBounds.x + turnRailBounds.width).toBeLessThanOrEqual(transcriptBounds.x)
    await currentTurn.focus()
    await page.getByRole('tooltip').waitFor({ state: 'visible', timeout: 15_000 })

    const closeSidebar = page.getByRole('button', { name: /^(?:Close sidebar|关闭侧边栏)$/u })
    await closeSidebar.click()
    await expect.poll(
      () => page.locator('[class*="frame"][data-sidebar-collapsed]').count(),
      { timeout: 15_000 },
    ).toBe(1)
    const workbenchTrigger = page.getByRole('button', { name: /^(?:Open workbench|打开工作台)$/u })
    await workbenchTrigger.waitFor({ state: 'visible', timeout: 30_000 })
    await workbenchTrigger.click()
    const workbench = page.locator('[data-desktop-workbench-panel]:visible')
    await workbench.waitFor({ state: 'visible', timeout: 15_000 })
    expect(await workbench.locator('xpath=..').getAttribute('data-utility-drawer')).toBeNull()
    const workbenchBounds = await workbench.boundingBox()
    const centerBounds = await page.locator('[class*="centerCol"]').boundingBox()
    if (workbenchBounds === null || centerBounds === null) {
      throw new Error('Windows 150 percent smoke could not measure the docked Workbench.')
    }
    expect(workbenchBounds.width).toBeGreaterThanOrEqual(300)
    expect(centerBounds.width).toBeGreaterThanOrEqual(640)
    await workbench.getByRole('tab', { name: /^(?:Plugins|插件)$/u }).click()
    await workbench.locator('[data-plugin-card="browser-skill"]').waitFor({ state: 'visible', timeout: 15_000 })
    await workbench.locator('[data-plugin-card="open-design"]').waitFor({ state: 'visible', timeout: 15_000 })
    expect(await workbench.locator('[data-browser-skill-idle]').count()).toBe(1)
    expect(await workbench.locator('[data-open-design-state="installed"]').count()).toBe(1)

    const evidence = {
      schemaVersion: 1,
      requestedPercent: 150,
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
