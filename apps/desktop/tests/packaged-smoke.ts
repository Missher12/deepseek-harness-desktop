import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
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
const MESSENGER_SOURCE_SESSION_ID = 'desktop-smoke-messenger-source-session-id'
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000

interface ProviderTripwire {
  readonly url: string
  readonly requests: string[]
  close(): Promise<void>
}

async function startProviderTripwire(): Promise<ProviderTripwire> {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(`${request.method ?? 'UNKNOWN'} ${request.url ?? '/'}`)
    request.resume()
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end('{"error":{"message":"packaged smoke provider tripwire"}}')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('provider tripwire has no TCP port')
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    }),
  }
}

async function writeDesktopSmokeModelSettings(harnessHome: string, baseURL: string): Promise<void> {
  await writeFile(join(harnessHome, 'settings.yaml'), [
    'agent-default-model:',
    '  provider: desktop-smoke',
    '  model: native-thinker',
    '  reasoningEffort: high',
    'llm-pi-ai:',
    '  providers:',
    '    desktop-smoke:',
    '      displayName: Desktop Smoke',
    '      apiKeyEnv: DSH_DESKTOP_SMOKE_MODEL_KEY',
    '      api: openai-completions',
    `      baseURL: ${baseURL}`,
    '      reasoning: high',
    '      models:',
    '        - id: native-thinker',
    '          name: Native Smoke Thinker',
    '          contextWindow: 65536',
    '          maxTokens: 4096',
    '          reasoningEfforts:',
    '            off:',
    '            high: high',
    '            max: ultra',
    '',
  ].join('\n'), 'utf8')
}

/** Isolated on-disk state used by the native system-clipboard smoke. */
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
    { type: 'session/end-seed', seq: 2, time: createdAt + 2, data: {} },
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
  const messengerSourceTitle = 'desktop-smoke-messenger-source-workspace'
  const activeSessionCwd = join(harnessHome, activeSessionTitle)
  const archivedSessionCwd = join(harnessHome, archivedSessionTitle)
  const messengerSourceCwd = join(harnessHome, messengerSourceTitle)
  await Promise.all([
    mkdir(activeSessionCwd, { recursive: true }),
    mkdir(archivedSessionCwd, { recursive: true }),
    mkdir(messengerSourceCwd, { recursive: true }),
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
    {
      version: SESSION_FORMAT_VERSION,
      id: SessionId(MESSENGER_SOURCE_SESSION_ID),
      createdAt: createdAt + 2,
      delegationDepth: 0,
      cwd: messengerSourceCwd,
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
  const messengerPath = join(storageRoot, 'session_messenger.json')
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
  const receiptCreatedAt = createdAt + 100
  const originalDeliveryId = 'desktop-smoke-original-delivery-id'
  const replyDeliveryId = 'desktop-smoke-reply-delivery-id'
  await writeFile(messengerPath, `${JSON.stringify({
    unit: { name: 'session_messenger', version: 1 },
    global: null,
    tables: {
      receipts: {
        [originalDeliveryId]: {
          id: originalDeliveryId,
          sourceSessionId: ACTIVE_CLIPBOARD_SESSION_ID,
          targetSessionId: MESSENGER_SOURCE_SESSION_ID,
          messageId: 'desktop-smoke-original-message-id',
          mode: 'inject',
          createdAt: receiptCreatedAt,
          updatedAt: receiptCreatedAt + 2,
          expiresAt: receiptCreatedAt + RECEIPT_TTL_MS,
          replyToken: 'desktop-smoke-consumed-reply-token',
          hop: 0,
          wakeRequested: false,
          status: 'replied',
          deliveredAt: receiptCreatedAt + 1,
          repliedAt: receiptCreatedAt + 2,
          replyDeliveryId,
        },
        [replyDeliveryId]: {
          id: replyDeliveryId,
          sourceSessionId: MESSENGER_SOURCE_SESSION_ID,
          targetSessionId: ACTIVE_CLIPBOARD_SESSION_ID,
          messageId: 'desktop-smoke-reply-message-id',
          mode: 'inject',
          createdAt: receiptCreatedAt + 3,
          updatedAt: receiptCreatedAt + 4,
          expiresAt: receiptCreatedAt + 3 + RECEIPT_TTL_MS,
          replyToken: 'desktop-smoke-reply-reply-token',
          hop: 1,
          wakeRequested: false,
          replyToDeliveryId: originalDeliveryId,
          status: 'delivered',
          deliveredAt: receiptCreatedAt + 4,
        },
      },
    },
  }, null, 2)}\n`, 'utf8')

  return {
    activeSessionId: ACTIVE_CLIPBOARD_SESSION_ID,
    activeSessionTitle,
    archivedSessionId: ARCHIVED_CLIPBOARD_SESSION_ID,
    archivedSessionTitle,
    protectedPaths: [...sessionPaths, workspacePath, messengerPath],
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

/** Whether a native inspection command reported that it found no matching row. */
export function isCommandNoMatch(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 1
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
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-NetTCPConnection -State Listen -LocalPort ${String(port)} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
      ])
      return parsePidLines(stdout)
    } catch (error) {
      if (isCommandNoMatch(error)) return []
      throw error
    }
  }

  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', [
      '-nP', '-t', `-iTCP:${String(port)}`, '-sTCP:LISTEN',
    ])
    return parsePidLines(stdout)
  } catch (error) {
    if (isCommandNoMatch(error)) return []
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

async function exerciseReasoningEffort(
  page: Page,
  harnessHome: string,
  platform: NodeJS.Platform,
): Promise<void> {
  const trigger = page.locator('button[aria-haspopup="dialog"]')
    .filter({ hasText: 'Native Smoke Thinker' })
  await trigger.waitFor({ state: 'visible', timeout: 30_000 })
  expect(await trigger.getAttribute('aria-label')).toMatch(
    /^(?:Select model, current Native Smoke Thinker, reasoning effort High|选择模型，当前 Native Smoke Thinker，推理等级 High)$/u,
  )
  await trigger.click()

  const popup = page.getByRole('dialog', {
    name: /^(?:Model and reasoning effort|模型与推理等级)$/u,
  })
  await popup.waitFor({ state: 'visible', timeout: 15_000 })
  const side = await popup.getAttribute('data-side')
  expect(['above', 'below']).toContain(side)
  expect(await popup.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return bounds.left >= 0
      && bounds.top >= 0
      && bounds.right <= window.innerWidth
      && bounds.bottom <= window.innerHeight
  })).toBe(true)

  const slider = popup.getByRole('slider', {
    name: /^(?:Reasoning effort|推理等级)$/u,
  })
  await slider.waitFor({ state: 'visible', timeout: 15_000 })
  expect(await slider.getAttribute('min')).toBe('0')
  expect(await slider.getAttribute('max')).toBe('2')
  expect(await slider.getAttribute('step')).toBe('1')
  expect(await slider.inputValue()).toBe('1')
  expect(await slider.getAttribute('aria-valuetext')).toBe('High')
  const canvas = popup.locator('canvas').first()
  expect(await canvas.count()).toBe(1)
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('2d')
    if (context === null || element.width === 0 || element.height === 0) return false
    return context.getImageData(0, 0, element.width, element.height).data
      .some((channel, index) => index % 4 === 3 && channel > 0)
  }), { timeout: 5_000 }).toBe(true)

  const character = popup.getByRole('switch', {
    name: /^(?:Character thumb|角色滑块)/u,
  })
  expect(await character.getAttribute('aria-checked')).toBe('false')
  await slider.press('End')
  await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 15_000 }).toMatch(
    /^(?:Select model, current Native Smoke Thinker, reasoning effort Max|选择模型，当前 Native Smoke Thinker，推理等级 Max)$/u,
  )
  expect(await slider.evaluate((element) => {
    const track = element.parentElement
    const thumb = track?.querySelector('span[aria-hidden="true"]')
    if (!(track instanceof HTMLElement) || !(thumb instanceof HTMLElement)) return false
    const trackBounds = track.getBoundingClientRect()
    const thumbBounds = thumb.getBoundingClientRect()
    return thumbBounds.left >= trackBounds.left && thumbBounds.right <= trackBounds.right
  })).toBe(true)
  await expect.poll(() => readFile(join(harnessHome, 'settings.yaml'), 'utf8'), { timeout: 15_000 })
    .toContain('reasoningEffort: max')
  await page.screenshot({
    path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-reasoning-${platform}.png`),
  })
  await page.keyboard.press('Escape')
  await popup.waitFor({ state: 'detached', timeout: 15_000 })
}

async function exerciseSessionMessenger(
  page: Page,
  application: ElectronApplication,
  seeded: WindowsClipboardSmokeState,
  platform: NodeJS.Platform,
): Promise<void> {
  const activeRow = page.getByRole('treeitem').filter({ hasText: seeded.activeSessionTitle }).first()
  await activeRow.click()
  await expect.poll(() => activeRow.getAttribute('aria-selected'), { timeout: 15_000 }).toBe('true')

  const trigger = page.getByRole('button', {
    name: /^(?:Session messages|会话通信)[,，]/u,
  })
  await trigger.waitFor({ state: 'visible', timeout: 30_000 })
  await trigger.click()
  const panel = page.getByRole('dialog', {
    name: /^(?:Session messages|会话通信)$/u,
  })
  await panel.waitFor({ state: 'visible', timeout: 15_000 })
  const pending = panel.locator('[data-messenger-state="pending"]')
  const unread = panel.locator('[data-messenger-state="unread"]')
  expect(await pending.count()).toBe(1)
  expect(await unread.count()).toBe(1)
  await expect.poll(() => pending.innerText(), { timeout: 15_000 }).toMatch(/^(?:0 pending|0 条待处理)$/u)
  await expect.poll(() => unread.innerText(), { timeout: 15_000 }).toMatch(/^(?:1 unread|1 条未读)$/u)

  const beforeFiles = await protectedFileSnapshot(seeded.protectedPaths)
  const previousClipboard = await application.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await application.evaluate(({ clipboard }, text) => { clipboard.writeText(text) }, 'desktop-smoke-before-messenger-copy')
    await panel.getByRole('button', {
      name: /^(?:Copy current Session ID|复制当前会话 ID)$/u,
    }).click()
    await expect.poll(
      () => application.evaluate(({ clipboard }) => clipboard.readText()),
      { timeout: 10_000 },
    ).toBe(seeded.activeSessionId)
    await panel.getByRole('status').filter({
      hasText: /^(?:Session ID copied|会话 ID 已复制)$/u,
    }).waitFor({ state: 'visible', timeout: 10_000 })
    await panel.getByRole('button', { name: /^(?:Mark read|标为已读)$/u }).click()
    await panel.getByRole('status').filter({
      hasText: /^(?:Notifications marked read|通知已标为已读)$/u,
    }).waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => unread.innerText(), { timeout: 10_000 }).toMatch(/^(?:0 unread|0 条未读)$/u)
    expect(await protectedFileSnapshot(seeded.protectedPaths)).toEqual(beforeFiles)
    expect(await activeRow.getAttribute('aria-selected')).toBe('true')
    await page.screenshot({
      path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-messenger-${platform}.png`),
    })
  } finally {
    await application.evaluate(({ clipboard }, text) => { clipboard.writeText(text) }, previousClipboard)
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined)
  }
}

interface MarketRouteResult {
  status: number
  body: unknown
}

async function postMarket(page: Page, path: string, body: Record<string, unknown>): Promise<MarketRouteResult> {
  return await page.evaluate(async ({ route, payload }) => {
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json() as unknown }
  }, { route: path, payload: body })
}

async function seedOrdinaryMarketFixture(harnessHome: string): Promise<string> {
  const packageName = 'dsh-desktop-smoke-plugin'
  const profileDirectory = join(harnessHome, 'profiles', 'web')
  const manifestPath = join(profileDirectory, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
    [key: string]: unknown
  }
  const fixtureDirectory = join(profileDirectory, packageName)
  await mkdir(fixtureDirectory, { recursive: true })
  await writeFile(join(fixtureDirectory, 'package.json'), `${JSON.stringify({
    name: packageName,
    version: '1.0.0',
    private: true,
    dsh: {},
  }, null, 2)}\n`, 'utf8')
  manifest.dependencies = {
    ...manifest.dependencies,
    [packageName]: `file:./${packageName}`,
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return packageName
}

async function exercisePluginMarket(
  page: Page,
  harnessHome: string,
  platform: NodeJS.Platform,
  consoleErrors: string[],
): Promise<void> {
  await page.locator('[data-dsh-desktop-command="open-settings"]').click()
  const settingsDialog = page.getByRole('dialog').last()
  await settingsDialog.waitFor({ state: 'visible', timeout: 15_000 })
  await settingsDialog.getByRole('button', { name: /^(?:Plugin Market|插件市场)$/u }).click()

  const market = settingsDialog.locator('[data-dshmarket-layout="compact"]')
  await market.waitFor({ state: 'visible', timeout: 30_000 })
  const tabs = ['discover', 'installed', 'updates', 'activity'] as const
  for (const tab of tabs) {
    const button = market.locator(`[data-dshmarket-tab="${tab}"]`)
    expect(await button.count()).toBe(1)
    await button.click()
    expect(await market.isVisible()).toBe(true)
  }
  await market.locator('[data-dshmarket-tab="discover"]').click()

  const toolbar = market.locator('[data-dshmarket-toolbar]')
  const categories = market.locator('[data-dshmarket-categories]')
  await toolbar.waitFor({ state: 'visible', timeout: 30_000 })
  await categories.waitFor({ state: 'visible', timeout: 30_000 })
  expect(await categories.evaluate(element => (
    [...element.querySelectorAll('div')].some((child) => {
      const overflow = getComputedStyle(child).overflowX
      return overflow === 'auto' || overflow === 'scroll'
    })
  ))).toBe(true)
  expect(await categories.locator('[data-chip="1"]').evaluateAll(chips => chips.every((chip) => {
    const style = getComputedStyle(chip)
    return style.flexShrink === '0' && style.whiteSpace === 'nowrap'
  }))).toBe(true)

  const firstRow = market.locator('[data-dshmarket-plugin-row]').first()
  await firstRow.waitFor({ state: 'visible', timeout: 30_000 })
  const primaryAction = firstRow.locator('[data-dshmarket-primary-action]')
  expect(await primaryAction.count()).toBe(1)
  expect(await firstRow.evaluate((row) => {
    const copy = row.children.item(1)
    const action = row.querySelector('[data-dshmarket-primary-action]')
    if (!(copy instanceof HTMLElement) || !(action instanceof HTMLElement)) return false
    return action.getBoundingClientRect().top >= copy.getBoundingClientRect().bottom
  })).toBe(true)
  const packageName = await firstRow.getAttribute('data-package')
  expect(packageName).toBeTruthy()
  const search = toolbar.getByRole('textbox').first()
  await search.fill(packageName ?? '')
  expect(await market.locator('[data-dshmarket-plugin-row]').first().isVisible()).toBe(true)
  await search.fill('')

  await page.screenshot({
    path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-market-${platform}.png`),
  })

  // Keep ordinary rendering completely clean. The two mutations below
  // intentionally produce a rejected HTTP status and a Host hot-refresh,
  // whose cancelled old streams Chromium reports as resource errors.
  expect(consoleErrors).toEqual([])
  consoleErrors.length = 0
  const protectedUpdate = await postMarket(page, '/dsh-market/update', { name: 'dshmarket' })
  expect(protectedUpdate).toEqual({ status: 409, body: { ok: false, code: 'self-protected' } })

  const fixtureName = await seedOrdinaryMarketFixture(harnessHome)
  const ordinaryUninstall = await postMarket(page, '/dsh-market/uninstall', { name: fixtureName })
  expect(ordinaryUninstall.status, JSON.stringify(ordinaryUninstall.body)).toBe(200)
  expect(ordinaryUninstall.body).toMatchObject({ ok: true, exitCode: 0 })

  await page.keyboard.press('Escape')
  await settingsDialog.waitFor({ state: 'detached', timeout: 15_000 })
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
  const clipboardSeed = await seedWindowsClipboardSmokeState(harnessHome)
  const providerTripwire = await startProviderTripwire()
  if (platform === 'darwin') {
    await writeDesktopSmokeModelSettings(harnessHome, providerTripwire.url)
  }

  let nativeApp: ElectronApplication | undefined
  let quitCompleted = false
  try {
    nativeApp = await electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${userData}`],
      cwd: temporaryRoot,
      env: {
        ...process.env,
        DSH_HOME: harnessHome,
        DSH_DESKTOP_SMOKE_MODEL_KEY: 'desktop-smoke-placeholder-key',
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: '',
        DEEPSEEK_BASE_URL: providerTripwire.url,
      },
      timeout: 120_000,
    })
    const page = await nativeApp.firstWindow({ timeout: 120_000 })
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', error => consoleErrors.push(error.message))
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

    // CDP-driven Electron clicks do not carry the browser's ordinary user
    // clipboard permission. Grant the same automation permission as the
    // browser E2E suite, then verify the native Electron clipboard itself.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.origin })

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
    if (platform === 'darwin') {
      // The native effort acceptance starts with an isolated, usable custom
      // provider so the first Session captures that exact model selection.
      // A usable non-DeepSeek route must also suppress the keyless onboarding.
      await expect.poll(() => credentialDialog.count(), { timeout: 30_000 }).toBe(0)
    } else {
      await credentialDialog.waitFor({ state: 'visible', timeout: 30_000 })
      await credentialDialog.getByRole('button', {
        name: /^(?:Configure later|稍后配置)$/u,
      }).click()
      await credentialDialog.waitFor({ state: 'detached', timeout: 30_000 })
    }
    expect(await page.locator('#root').evaluate((element: HTMLElement) => !element.inert)).toBe(true)

    try {
      await exerciseWindowsClipboard(page, nativeApp, clipboardSeed)
      if (platform === 'darwin') {
        await exerciseSessionMessenger(page, nativeApp, clipboardSeed, platform)
        await exerciseReasoningEffort(page, harnessHome, platform)
      }
    } catch (error) {
      throw new Error(
        `Packaged smoke: native clipboard and session-messenger acceptance failed: ${String(error)}\n${await desktopStartupDiagnostic(page, userData)}`,
        { cause: error },
      )
    }

    await page.waitForTimeout(15_000)
    expect(await page.locator('body').innerText()).not.toContain('Failed to load plugins')
    expect(await page.locator('[class*="centerCol"]').count()).toBe(1)
    await page.screenshot({
      path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-${platform}.png`),
    })

    await exercisePluginMarket(page, harnessHome, platform, consoleErrors)
    expect(consoleErrors.filter(message => (
      !/^Failed to load resource: the server responded with a status of 409 \(Conflict\)$/u.test(message)
      && message !== 'Failed to load resource: net::ERR_INCOMPLETE_CHUNKED_ENCODING'
    ))).toEqual([])
    expect(providerTripwire.requests).toEqual([])

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
    await providerTripwire.close()
  }
}
