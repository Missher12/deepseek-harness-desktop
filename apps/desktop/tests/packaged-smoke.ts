import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { expect } from 'vitest'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '../../..')
const ACTIVE_CLIPBOARD_SESSION_ID = 'desktop-smoke-active-session-id'
const ARCHIVED_CLIPBOARD_SESSION_ID = 'desktop-smoke-archived-session-id'

/** Isolated on-disk state used only by the native Windows clipboard smoke. */
export interface WindowsClipboardSmokeState {
  activeSessionId: string
  activeSessionTitle: string
  archivedSessionId: string
  archivedSessionTitle: string
  protectedPaths: readonly string[]
}

function completeTurn(createdAt: number): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: createdAt, data: { turn: 1 } },
    {
      type: 'turn/end',
      seq: 1,
      time: createdAt + 1,
      data: { turn: 1, reason: { kind: 'completed' } },
    },
  ]
}

/**
 * Seed one ordinary and one archived cold Session through the shipped JSONL
 * persistence implementation. The smoke never writes into the user's home.
 * @param harnessHome - Exact isolated DSH_HOME prepared by the installer smoke.
 * @returns Stable ids and files whose bytes must remain unchanged by copying.
 */
export async function seedWindowsClipboardSmokeState(
  harnessHome: string,
): Promise<WindowsClipboardSmokeState> {
  const persistenceRoot = join(harnessHome, 'sessions')
  const createdAt = Date.now() - 60_000
  const activeSessionTitle = 'desktop-smoke-active-workspace'
  const archivedSessionTitle = 'desktop-smoke-archived-workspace'
  const activeSessionCwd = join(harnessHome, activeSessionTitle)
  const archivedSessionCwd = join(harnessHome, archivedSessionTitle)
  await Promise.all([
    mkdir(activeSessionCwd, { recursive: true }),
    mkdir(archivedSessionCwd, { recursive: true }),
  ])
  const headers: SessionHeader[] = [
    {
      version: SESSION_FORMAT_VERSION,
      id: SessionId(ACTIVE_CLIPBOARD_SESSION_ID),
      createdAt,
      delegationDepth: 0,
      cwd: activeSessionCwd,
    },
    {
      version: SESSION_FORMAT_VERSION,
      id: SessionId(ARCHIVED_CLIPBOARD_SESSION_ID),
      createdAt: createdAt + 1,
      delegationDepth: 0,
      cwd: archivedSessionCwd,
    },
  ]

  const seeder = new Context()
  const sessionPaths: string[] = []
  try {
    await seeder.plugin(SessionStore)
    await seeder.plugin(JsonlSessionPersistence, { root: persistenceRoot })
    for (const header of headers) {
      await seeder.sessionPersistence.create(header)
      await seeder.sessionPersistence.append(header.id, completeTurn(header.createdAt))
      const location = seeder.sessionPersistence.locate(header)
      if (location === undefined || location.kind !== 'jsonl') {
        throw new Error(`Packaged smoke: seeded Session ${header.id} has no JSONL location.`)
      }
      sessionPaths.push(location.path)
    }
  } finally {
    await seeder.fiber.dispose()
  }

  const storageRoot = join(harnessHome, 'storages')
  const workspacePath = join(storageRoot, 'workspace.json')
  await mkdir(storageRoot, { recursive: true })
  await writeFile(workspacePath, `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      workspaceIds: [],
      archivedSessionIds: [ARCHIVED_CLIPBOARD_SESSION_ID],
    },
    tables: { workspaces: {} },
  }, null, 2)}\n`, 'utf8')

  return {
    activeSessionId: ACTIVE_CLIPBOARD_SESSION_ID,
    activeSessionTitle,
    archivedSessionId: ARCHIVED_CLIPBOARD_SESSION_ID,
    archivedSessionTitle,
    protectedPaths: [...sessionPaths, workspacePath],
  }
}

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

async function protectedFileSnapshot(paths: readonly string[]): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {}
  await Promise.all(paths.map(async (path) => {
    snapshot[path] = (await readFile(path)).toString('base64')
  }))
  return snapshot
}

async function desktopStartupDiagnostic(page: Page, userData: string): Promise<string> {
  const url = page.isClosed() ? '[window closed]' : page.url()
  const body = page.isClosed()
    ? '[window closed]'
    : await page.locator('body').innerText().catch((error: unknown) => `[body unavailable: ${String(error)}]`)
  const lifecyclePath = join(userData, 'logs', 'lifecycle.log')
  const lifecycle = await readFile(lifecyclePath, 'utf8')
    .then(text => text.slice(-24_000))
    .catch((error: unknown) => `[lifecycle log unavailable: ${String(error)}]`)
  return `URL: ${url}\nRendered body:\n${body}\nLifecycle log tail:\n${lifecycle}`
}

async function waitForDesktopSurface(page: Page, userData: string): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error(`Packaged smoke: desktop window closed during startup.\n${await desktopStartupDiagnostic(page, userData)}`)
    }
    if (await page.locator('body[data-dsh-surface="desktop"]').count() === 1) return
    try {
      const url = new URL(page.url())
      if (url.protocol === 'file:' && url.pathname.endsWith('/failure.html')) {
        throw new Error(`Packaged smoke: application rendered its failure surface.\n${await desktopStartupDiagnostic(page, userData)}`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Packaged smoke:')) throw error
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`Packaged smoke: desktop surface missed its startup deadline.\n${await desktopStartupDiagnostic(page, userData)}`)
}

async function exerciseWindowsClipboard(
  page: Page,
  application: ElectronApplication,
  seeded: WindowsClipboardSmokeState,
): Promise<void> {
  const beforeFiles = await protectedFileSnapshot(seeded.protectedPaths)
  const selectedBefore = await page.locator('[role="treeitem"][aria-selected="true"]').allTextContents()
  const previousClipboard = await application.evaluate(({ clipboard }) => clipboard.readText())

  try {
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
    const activeRow = page.getByRole('treeitem').filter({ hasText: seeded.activeSessionTitle }).first()
    await activeRow.waitFor({ state: 'visible', timeout: 15_000 })
    await activeRow.hover()
    const activeActions = activeRow.getByRole('button').first()
    await activeActions.waitFor({ state: 'visible', timeout: 15_000 })

    await application.evaluate(({ clipboard }, text) => { clipboard.writeText(text) }, 'desktop-smoke-before-active-copy')
    await activeActions.click()
    await page.getByRole('menuitem', { name: /^(?:Copy session ID|复制会话 ID)$/u }).click()
    await expect.poll(
      () => application.evaluate(({ clipboard }) => clipboard.readText()),
      { timeout: 10_000 },
    ).toBe(seeded.activeSessionId)
    await page.getByRole('alert').filter({ hasText: /^(?:Session ID copied|会话 ID 已复制)$/u })
      .waitFor({ state: 'visible', timeout: 10_000 })

    await page.getByRole('button', { name: /^(?:Archive|Archived|归档)$/u }).click()
    const archiveDialog = page.getByRole('dialog', { name: /^(?:Archived sessions|已归档会话)$/u })
    await archiveDialog.waitFor({ state: 'visible', timeout: 15_000 })
    const archivedRow = archiveDialog.getByText(seeded.archivedSessionTitle, { exact: true })
      .locator('..').locator('..')
    const archivedCopy = archivedRow.getByRole('button', {
      name: /^(?:Copy session ID|复制会话 ID)/u,
    })
    await archivedCopy.waitFor({ state: 'visible', timeout: 15_000 })

    await application.evaluate(({ clipboard }, text) => { clipboard.writeText(text) }, 'desktop-smoke-before-archived-copy')
    await archivedCopy.click()
    await expect.poll(
      () => application.evaluate(({ clipboard }) => clipboard.readText()),
      { timeout: 10_000 },
    ).toBe(seeded.archivedSessionId)
    expect(await archiveDialog.isVisible()).toBe(true)
    expect(await archiveDialog.getByRole('button', { name: /^(?:Restore|恢复)/u }).count()).toBe(1)
    expect(await archiveDialog.getByRole('button', { name: /^(?:Delete|删除)/u }).count()).toBe(1)

    await page.waitForTimeout(500)
    expect(await protectedFileSnapshot(seeded.protectedPaths)).toEqual(beforeFiles)
    expect(await page.locator('[role="treeitem"][aria-selected="true"]').allTextContents()).toEqual(selectedBefore)
    await page.keyboard.press('Escape')
    await archiveDialog.waitFor({ state: 'detached', timeout: 15_000 })
  } finally {
    await application.evaluate(({ clipboard }, text) => { clipboard.writeText(text) }, previousClipboard)
  }
}

async function quitAfterSmokeFailure(application: ElectronApplication): Promise<void> {
  try {
    const closed = application.waitForEvent('close', { timeout: 15_000 })
    await application.evaluate(({ app }) => { app.quit() })
    await closed
  } catch {
    await application.close().catch(() => undefined)
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
  const clipboardSeed = platform === 'win32'
    ? await seedWindowsClipboardSmokeState(harnessHome)
    : undefined

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
    await waitForDesktopSurface(page, userData)

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

    if (clipboardSeed !== undefined) {
      // CDP-driven Electron clicks do not carry the browser's ordinary user
      // clipboard permission. Grant the same automation permission as the
      // browser E2E suite, then verify the native Electron clipboard itself.
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.origin })
    }

    expect(await page.locator('[class*="sidebarCol"]').count()).toBe(1)
    expect(await page.locator('[class*="centerCol"]').count()).toBe(1)
    expect(await page.locator('[class*="detailsCol"]').count()).toBe(1)
    expect(await page.locator('[data-dsh-desktop-command="new-session"]').count()).toBe(1)
    expect(await page.locator('[data-dsh-desktop-command="open-command-menu"]').count()).toBe(1)
    expect(await page.locator('[data-dsh-desktop-command="open-settings"]').count()).toBe(1)

    const welcomeDialog = page.getByRole('dialog', {
      name: /^(?:Internal Testing Notice|内测声明)$/u,
    })
    await welcomeDialog.waitFor({ state: 'visible', timeout: 30_000 })
    await welcomeDialog.getByRole('button', { name: /^(?:Continue|继续)$/u }).click()
    await welcomeDialog.waitFor({ state: 'detached', timeout: 30_000 })
    const credentialDialog = page.getByRole('dialog', {
      name: /^(?:Add an API key to get started|添加一个 API Key 开始使用)$/u,
    })
    await credentialDialog.waitFor({ state: 'visible', timeout: 30_000 })
    await credentialDialog.getByRole('button', {
      name: /^(?:Configure later|稍后配置)$/u,
    }).click()
    await credentialDialog.waitFor({ state: 'detached', timeout: 30_000 })
    expect(await page.locator('#root').evaluate((element: HTMLElement) => !element.inert)).toBe(true)

    if (clipboardSeed !== undefined) {
      try {
        await exerciseWindowsClipboard(page, nativeApp, clipboardSeed)
      } catch (error) {
        throw new Error(
          `Packaged smoke: Windows clipboard acceptance failed: ${String(error)}\n${await desktopStartupDiagnostic(page, userData)}`,
          { cause: error },
        )
      }
    } else {
      await page.getByRole('button', { name: /^(?:Archive|Archived|归档)$/u }).click()
      const archiveDialog = page.getByRole('dialog', {
        name: /^(?:Archived sessions|已归档会话)$/u,
      })
      await archiveDialog.waitFor({ state: 'visible', timeout: 15_000 })
      expect(await archiveDialog.getByText(/^(?:No archived sessions|暂无已归档会话)$/u).isVisible()).toBe(true)
      await page.keyboard.press('Escape')
      await archiveDialog.waitFor({ state: 'detached', timeout: 15_000 })
    }

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
    if (!quitCompleted && nativeApp !== undefined) await quitAfterSmokeFailure(nativeApp)
  }
}
