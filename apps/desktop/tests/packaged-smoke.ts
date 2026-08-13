import { execFile } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { expect } from 'vitest'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '../../..')

/** One Windows process inventory row returned by Win32_Process. */
export interface WindowsProcessRow {
  processId: number
  parentProcessId: number
}

interface WindowsProcessJson {
  ProcessId?: unknown
  ParentProcessId?: unknown
}

/**
 * Parse PowerShell's single-object or array JSON process output.
 * @param raw - Compressed ConvertTo-Json output.
 * @returns Valid process rows; malformed rows are ignored.
 */
export function parseWindowsProcessRows(raw: string): WindowsProcessRow[] {
  if (raw.trim() === '') return []
  const parsed: unknown = JSON.parse(raw)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.flatMap((value) => {
    if (typeof value !== 'object' || value === null) return []
    const row = value as WindowsProcessJson
    if (!Number.isSafeInteger(row.ProcessId) || !Number.isSafeInteger(row.ParentProcessId)) return []
    return [{ processId: row.ProcessId as number, parentProcessId: row.ParentProcessId as number }]
  })
}

/**
 * Resolve the process ids rooted at one parent from an inventory snapshot.
 * @param rootPid - Root process id.
 * @param rows - Process inventory snapshot.
 * @returns Root followed by every reachable descendant exactly once.
 */
export function descendantProcessTree(
  rootPid: number,
  rows: readonly WindowsProcessRow[],
): number[] {
  const children = new Map<number, number[]>()
  for (const row of rows) {
    const list = children.get(row.parentProcessId) ?? []
    list.push(row.processId)
    children.set(row.parentProcessId, list)
  }
  const found = [rootPid]
  const seen = new Set(found)
  for (let index = 0; index < found.length; index += 1) {
    for (const child of children.get(found[index]!) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      found.push(child)
    }
  }
  return found
}

function parsePidLines(raw: string): number[] {
  return raw.split(/\s+/u).filter(Boolean).map(Number).filter(Number.isSafeInteger)
}

async function processTree(rootPid: number, platform: NodeJS.Platform): Promise<number[]> {
  if (platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
    ])
    return descendantProcessTree(rootPid, parseWindowsProcessRows(stdout))
  }

  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid='])
  const rows = stdout.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line)
    if (match === null) return []
    return [{ processId: Number(match[1]), parentProcessId: Number(match[2]) }]
  })
  return descendantProcessTree(rootPid, rows)
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

async function listenerPids(port: number, platform: NodeJS.Platform): Promise<number[]> {
  if (platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-NetTCPConnection -State Listen -LocalPort ${String(port)} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
    ])
    return parsePidLines(stdout)
  }

  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', [
      '-nP', '-t', `-iTCP:${String(port)}`, '-sTCP:LISTEN',
    ])
    return parsePidLines(stdout)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 1) return []
    throw error
  }
}

async function quitDesktop(application: ElectronApplication, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32') {
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (window === undefined) throw new Error('Packaged smoke: native window is missing.')
      window.close()
    })
    return
  }

  await application.evaluate(({ app, Menu }) => {
    const appMenu = Menu.getApplicationMenu()
    const quit = appMenu?.items
      .flatMap(item => item.submenu?.items ?? [])
      .find(item => item.role === 'quit')
    if (quit === undefined) throw new Error('Packaged smoke: native Quit menu item is missing.')
    app.quit()
  })
}

/**
 * Launch and exercise one packaged desktop executable on its native platform.
 * @param executable - Packaged Electron executable.
 * @param platform - Platform whose process inspection and quit path to exercise.
 * @returns A promise that resolves after the app and its Harness tree are gone.
 */
export async function runPackagedDesktopSmoke(
  executable: string,
  platform: NodeJS.Platform,
): Promise<void> {
  const temporaryRoot = process.env.DSH_DESKTOP_SMOKE_ROOT
    ?? await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))
  const harnessHome = process.env.DSH_DESKTOP_SMOKE_DSH_HOME ?? join(temporaryRoot, 'dsh-home')
  const userData = process.env.DSH_DESKTOP_SMOKE_USER_DATA ?? join(temporaryRoot, 'electron-data')
  await Promise.all([mkdir(harnessHome, { recursive: true }), mkdir(userData, { recursive: true })])

  let nativeApp: ElectronApplication | undefined
  let quitCompleted = false
  try {
    nativeApp = await electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${userData}`],
      cwd: temporaryRoot,
      env: { ...process.env, DSH_HOME: harnessHome },
      timeout: 120_000,
    })
    const page = await nativeApp.firstWindow({ timeout: 120_000 })
    await page.locator('body[data-dsh-surface="desktop"]').waitFor({ timeout: 120_000 })

    expect(await page.evaluate(() => (
      typeof window.dshDesktop?.onCommand === 'function'
      && typeof window.dshDesktop.recover === 'function'
    ))).toBe(true)

    const url = new URL(page.url())
    expect(url.hostname).toBe('127.0.0.1')
    expect(url.searchParams.get('surface')).toBe('desktop')
    const port = Number(url.port)
    expect(port).toBeGreaterThan(0)
    expect(await listenerPids(port, platform)).not.toEqual([])

    expect(await page.locator('[class*="sidebarCol"]').count()).toBe(1)
    expect(await page.locator('[class*="centerCol"]').count()).toBe(1)
    expect(await page.locator('[class*="detailsCol"]').count()).toBe(1)
    expect(await page.locator('[data-dsh-desktop-command="new-session"]').count()).toBe(1)
    expect(await page.locator('[data-dsh-desktop-command="open-command-menu"]').count()).toBe(1)
    expect(await page.locator('[data-dsh-desktop-command="open-settings"]').count()).toBe(1)

    const continueButton = page.getByRole('button', { name: /^(?:Continue|继续)$/u })
    if (await continueButton.isVisible()) await continueButton.click()
    const configureLaterButton = page.getByRole('button', {
      name: /^(?:Configure later|稍后配置)$/u,
    })
    await expect.poll(async () => {
      if (await configureLaterButton.isVisible()) await configureLaterButton.click()
      return page.locator('#root').evaluate((element: HTMLElement) => !element.inert)
    }, { timeout: 15_000 }).toBe(true)

    await page.waitForTimeout(15_000)
    expect(await page.locator('body').innerText()).not.toContain('Failed to load plugins')
    expect(await page.locator('[class*="centerCol"]').count()).toBe(1)
    await page.screenshot({
      path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-${platform}.png`),
    })

    await page.locator('[data-dsh-desktop-command="open-settings"]').click()
    const settingsDialog = page.getByRole('dialog')
    await settingsDialog.waitFor({ state: 'visible' })
    expect(await settingsDialog.isVisible()).toBe(true)
    await page.keyboard.press('Escape')
    await settingsDialog.waitFor({ state: 'detached' })
    expect(await settingsDialog.count()).toBe(0)

    const mainPid = nativeApp.process().pid
    if (mainPid === undefined) throw new Error('Packaged smoke: Electron main PID is unavailable.')
    const trackedPids = [...new Set([
      ...await processTree(mainPid, platform),
      ...await listenerPids(port, platform),
    ])]

    const closed = nativeApp.waitForEvent('close')
    await quitDesktop(nativeApp, platform)
    await closed
    quitCompleted = true

    await expect.poll(() => trackedPids.filter(processExists), { timeout: 15_000 }).toEqual([])
    await expect.poll(() => listenerPids(port, platform), { timeout: 15_000 }).toEqual([])
  } finally {
    if (!quitCompleted && nativeApp !== undefined) await nativeApp.close()
  }
}
