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

async function exerciseWindows150PercentSurface(executablePath: string): Promise<void> {
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
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio), { timeout: 15_000 })
      .toBeCloseTo(1.5, 1)
    await expect.poll(() => application?.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor), {
      timeout: 15_000,
    }).toBeCloseTo(1.5, 1)

    expect(await page.locator('[class*="sidebarCol"]').count()).toBe(1)
    expect(await page.locator('[class*="centerCol"]').count()).toBe(1)
    expect(await page.locator('[class*="detailsCol"]').count()).toBe(1)
    await page.getByRole('navigation', { name: /^(?:Previous prompts|过往发言)$/u })
      .waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByRole('button', { name: /^(?:Open workbench|打开工作台)$/u })
      .waitFor({ state: 'visible', timeout: 30_000 })

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
      await runPackagedDesktopSmoke(executable, 'win32')
      await exerciseWindows150PercentSurface(executable)
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
