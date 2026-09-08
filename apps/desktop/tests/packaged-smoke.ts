import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  SessionLogOffset,
  SessionSeq,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { logPath } from '@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { expect } from 'vitest'
import { startReaderSmokeProvider } from './reader-smoke-provider.ts'
import { exerciseReaderPresentation } from './reader-presentation-smoke.ts'
import { exerciseComposerContinuity } from './composer-continuity-smoke.ts'
import { prepareTurnNavigationViewport, verifyTurnNavigationClick } from './turn-navigation-viewport.ts'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '../../..')
const ACTIVE_CLIPBOARD_SESSION_ID = 'desktop-smoke-active-session-id'
const ARCHIVED_CLIPBOARD_SESSION_ID = 'desktop-smoke-archived-session-id'
const MESSENGER_SOURCE_SESSION_ID = 'desktop-smoke-messenger-source-session-id'
const MESSENGER_SUBAGENT_SESSION_ID = 'desktop-smoke-messenger-subagent-session-id'
/** Turns seeded into the active session so the navigation rail can page. */
const NAVIGATION_TURN_COUNT = 30
/** Event seqs one complete seeded turn occupies (see completeTurn). */
const TURN_SEQ_SPAN = 12
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000

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
    '            high: high',
    '    desktop-smoke-alternate:',
    '      displayName: Desktop Smoke Alternate',
    '      apiKeyEnv: DSH_DESKTOP_SMOKE_MODEL_KEY',
    '      api: openai-completions',
    `      baseURL: ${baseURL}`,
    '      reasoning: high',
    '      models:',
    '        - id: native-switcher',
    '          name: Native Smoke Switcher',
    '          contextWindow: 65536',
    '          maxTokens: 4096',
    '          reasoningEfforts:',
    '            high: high',
    '',
  ].join('\n'), 'utf8')
}

/** Isolated pre-0.5.0 packaged fallback plus unrelated bytes protected by the upgrade smoke. */
export interface LegacyModuleFallbackUpgradeState {
  readonly linkPath: string
  readonly recoveryRoot: string
  readonly manifest: string
  readonly entries: readonly string[]
  readonly protectedPaths: readonly string[]
}

/**
 * Seed the byte-exact proxy format emitted by the packaged 0.4.x fallback
 * generator. The unrelated profile files prove migration stays inside the
 * one installation-owned fallback entry.
 * @param harnessHome - Exact temporary DSH_HOME used by the packaged smoke.
 * @param platform - Native target whose historical file URL form to seed.
 * @returns Paths and bytes verified after the packaged application starts.
 */
export async function seedLegacyModuleFallbackUpgradeState(
  harnessHome: string,
  platform: NodeJS.Platform,
): Promise<LegacyModuleFallbackUpgradeState> {
  const packageName = '@deepseek-ai/dsh-desktop'
  const target = platform === 'win32'
    ? 'file:///C:/Program%20Files/DeepSeek%20Harness/resources/app.asar/lib/main.js'
    : 'file:///Applications/DeepSeek%20Harness.app/Contents/Resources/app.asar/lib/main.js'
  const targets = { '.': target }
  const manifest = JSON.stringify({
    name: packageName,
    version: '0.4.11',
    private: true,
    type: 'module',
    exports: { '.': './entry-0.js' },
    dsh: { moduleFallback: { targets } },
  }, undefined, 2) + '\n'
  const specifier = JSON.stringify(target)
  const entries = [
    `export * from ${specifier}\nimport * as target from ${specifier}\nexport default target.default\n`,
  ]
  const linkPath = join(harnessHome, 'profiles', 'node_modules', packageName)
  await mkdir(linkPath, { recursive: true })
  await writeFile(join(linkPath, 'package.json'), manifest, 'utf8')
  await writeFile(join(linkPath, 'entry-0.js'), entries[0]!, 'utf8')

  const ordinaryProfile = join(harnessHome, 'profiles', 'ordinary-upgrade-sentinel')
  const protectedPaths = [
    join(ordinaryProfile, 'package.json'),
    join(ordinaryProfile, 'cordis.patch.yml'),
  ]
  await mkdir(ordinaryProfile, { recursive: true })
  await writeFile(protectedPaths[0]!, JSON.stringify({
    name: 'ordinary-upgrade-sentinel',
    private: true,
    dsh: { profile: { bundles: ['user-owned-bundle'] } },
  }, undefined, 2) + '\n', 'utf8')
  await writeFile(protectedPaths[1]!, '# user-owned upgrade sentinel\n[]\n', 'utf8')

  return {
    linkPath,
    recoveryRoot: join(harnessHome, 'recovery', 'legacy-module-fallback'),
    manifest,
    entries,
    protectedPaths,
  }
}

async function verifyLegacyModuleFallbackUpgrade(
  state: LegacyModuleFallbackUpgradeState,
): Promise<void> {
  expect((await lstat(state.linkPath)).isSymbolicLink()).toBe(true)
  expect(await readlink(state.linkPath)).not.toBe('')
  const backups = (await readdir(state.recoveryRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
  expect(backups).toHaveLength(1)
  const backup = join(state.recoveryRoot, backups[0]!.name)
  expect(await readFile(join(backup, 'package.json'), 'utf8')).toBe(state.manifest)
  for (const [index, entry] of state.entries.entries()) {
    expect(await readFile(join(backup, `entry-${index}.js`), 'utf8')).toBe(entry)
  }
}

/** Isolated on-disk state used by the native system-clipboard smoke. */
export interface WindowsClipboardSmokeState {
  activeSessionId: string
  activeSessionTitle: string
  archivedSessionId: string
  archivedSessionTitle: string
  messengerSourceSessionId: string
  messengerSourceSessionTitle: string
  messengerSubagentSessionId: string
  expectedDailyTokens: number
  protectedPaths: readonly string[]
}

/** Native scale values observed from the exact packaged process under smoke. */
export interface PackagedDesktopSmokeResult extends WindowsClipboardSmokeState {
  readonly primaryDisplayScaleFactor: number
  readonly rendererDevicePixelRatio: number
}

const SEEDED_SESSION_USAGE = {
  inputTokens: 1_200,
  outputTokens: 300,
  cacheReadTokens: 500,
  cacheWriteTokens: 0,
} as const

/** Whether a visible Usage tooltip describes consumed tokens in either locale. */
export function isUsageTokenTooltip(text: string): boolean {
  return /(?:used.*tokens?|tokens?.*used|使用了.*Token)/iu.test(text)
}

function completeTurn(createdAt: number, turn = 1): SessionEvent[] {
  return [
    { type: 'turn/start', seq: SessionSeq(0), time: createdAt, data: { turn } },
    {
      type: 'user/message',
      seq: SessionSeq(1),
      time: createdAt + 1,
      data: {
        id: `desktop-smoke-user-${createdAt}` as never,
        role: 'user',
        source: { kind: 'user' },
        content: [],
      },
      surfaceOp: 'append',
    },
    {
      type: 'user/message',
      seq: SessionSeq(2),
      time: createdAt + 2,
      data: {
        id: `desktop-smoke-user-steering-${createdAt}` as never,
        role: 'user',
        source: { kind: 'user' },
        content: [],
      },
      surfaceOp: 'append',
    },
    {
      type: 'request/header',
      seq: SessionSeq(3),
      time: createdAt + 3,
      data: {
        reason: 'initial',
        header: {
          config: {
            provider: 'desktop-smoke',
            model: 'native-thinker',
            reasoningEffort: 'high' as never,
          },
        },
      },
    },
    { type: 'step/start', seq: SessionSeq(4), time: createdAt + 4, data: { turn, step: 0 } },
    {
      type: 'assistant/message',
      seq: SessionSeq(5),
      time: createdAt + 5,
      data: {
        turn,
        step: 0,
        stream: [],
        usage: SEEDED_SESSION_USAGE,
        message: {
          id: `desktop-smoke-assistant-${createdAt}` as never,
          role: 'assistant',
          source: { kind: 'model', provider: 'desktop-smoke', model: 'native-thinker' },
          content: [],
        },
      },
      surfaceOp: 'append',
    },
    { type: 'step/end', seq: SessionSeq(6), time: createdAt + 6, data: { turn, step: 0 } },
    {
      type: 'turn/end',
      seq: SessionSeq(7),
      time: createdAt + 7,
      data: { turn, reason: { kind: 'completed' } },
    },
    {
      type: 'permission/preset',
      seq: SessionSeq(8),
      time: createdAt + 8,
      data: { preset: 'workspace-write' },
    },
    {
      type: 'sandbox/mode',
      seq: SessionSeq(9),
      time: createdAt + 9,
      data: { mode: 'workspace-write' },
    },
    {
      type: 'approval/policy',
      seq: SessionSeq(10),
      time: createdAt + 10,
      data: { policy: 'ask' },
    },
    { type: 'session/end-seed', seq: SessionSeq(11), time: createdAt + 11, data: {} },
  ]
}

/**
 * Seed one ordinary and one archived cold Session through the shipped JSONL
 * persistence implementation. The smoke never writes into the user's home.
 * @param harnessHome - Exact isolated DSH_HOME prepared by the installer smoke.
 * @param persistenceRoot - Isolated session store; the browser rehearsal supplies its scaffold's root.
 * @returns Stable ids and files whose bytes must remain unchanged by copying.
 */
export async function seedWindowsClipboardSmokeState(
  harnessHome: string,
  persistenceRoot = join(harnessHome, 'sessions'),
): Promise<WindowsClipboardSmokeState> {
  const createdAt = Date.now() - 60_000
  const activeSessionTitle = 'desktop-smoke-active-workspace'
  const archivedSessionTitle = 'desktop-smoke-archived-workspace'
  const messengerSourceTitle = 'desktop-smoke-messenger-source-workspace'
  const messengerSubagentTitle = 'desktop-smoke-messenger-subagent-workspace'
  const activeSessionCwd = join(harnessHome, activeSessionTitle)
  const archivedSessionCwd = join(harnessHome, archivedSessionTitle)
  const messengerSourceCwd = join(harnessHome, messengerSourceTitle)
  const messengerSubagentCwd = join(harnessHome, messengerSubagentTitle)
  await Promise.all([
    mkdir(activeSessionCwd, { recursive: true }),
    mkdir(archivedSessionCwd, { recursive: true }),
    mkdir(messengerSourceCwd, { recursive: true }),
    mkdir(messengerSubagentCwd, { recursive: true }),
  ])
  const headers: SessionHeader[] = [
    {
      version: SESSION_FORMAT_VERSION,
      id: SessionId(ACTIVE_CLIPBOARD_SESSION_ID),
      createdAt,
      isSeeded: false,
      delegationDepth: 0,
      cwd: activeSessionCwd,
    },
    {
      version: SESSION_FORMAT_VERSION,
      id: SessionId(ARCHIVED_CLIPBOARD_SESSION_ID),
      createdAt: createdAt + 1,
      isSeeded: false,
      delegationDepth: 0,
      cwd: archivedSessionCwd,
    },
    {
      version: SESSION_FORMAT_VERSION,
      id: SessionId(MESSENGER_SOURCE_SESSION_ID),
      createdAt: createdAt + 2,
      isSeeded: false,
      delegationDepth: 0,
      cwd: messengerSourceCwd,
    },
    {
      version: SESSION_FORMAT_VERSION,
      id: SessionId(MESSENGER_SUBAGENT_SESSION_ID),
      createdAt: createdAt + 3,
      isSeeded: false,
      delegationDepth: 1,
      cwd: messengerSubagentCwd,
      parentSession: SessionId(ACTIVE_CLIPBOARD_SESSION_ID),
      origin: 'subagent',
    },
  ]

  const seeder = new Context()
  const sessionPaths: string[] = []
  try {
    await seeder.plugin(SessionStore)
    await seeder.plugin(JsonlSessionPersistence, { root: persistenceRoot })
    for (const header of headers) {
      const handle = await seeder.sessionPersistence.create(header, { inheritedEventCount: SessionLogOffset(0) })
      if (header.id === ACTIVE_CLIPBOARD_SESSION_ID) {
        // The navigation acceptance needs a rail that must page: thirty
        // completed turns with strictly ascending seqs and turn numbers.
        for (let turn = 1; turn <= NAVIGATION_TURN_COUNT; turn += 1) {
          const offset = (turn - 1) * TURN_SEQ_SPAN
          const shifted = completeTurn(header.createdAt + offset, turn).map(event => ({
            ...event,
            seq: SessionSeq(event.seq + offset),
            time: (event as { time: number }).time + offset,
          }))
          await handle.append(shifted)
        }
      } else {
        await handle.append(completeTurn(header.createdAt))
      }
      if (header.id === ACTIVE_CLIPBOARD_SESSION_ID) {
        const relaySeq = NAVIGATION_TURN_COUNT * TURN_SEQ_SPAN
        const relayEvent: SessionEvent<'user/message'> = {
          type: 'user/message',
          seq: SessionSeq(relaySeq),
          time: header.createdAt + relaySeq,
          data: {
            id: 'desktop-smoke-relay-message-id' as SessionEvent<'user/message'>['data']['id'],
            role: 'user',
            source: ({
              kind: 'plugin',
              plugin: 'dsh-session-messenger',
              form: 'relay',
              senderSessionId: MESSENGER_SOURCE_SESSION_ID,
              deliveryId: 'desktop-smoke-visible-delivery-id',
              mode: 'inject',
              bodyBlockIndex: 1,
            }) as unknown as SessionEvent<'user/message'>['data']['source'],
            content: [
              { type: 'text', text: 'bounded desktop smoke relay metadata' },
              { type: 'text', text: 'desktop-smoke-visible-message' },
            ],
          },
          surfaceOp: 'append',
        }
        await handle.append( [relayEvent])
      }
      await handle.close()
      sessionPaths.push(logPath(persistenceRoot, header.cwd, header.id, 'zstd'))
    }
  } finally {
    await seeder.fiber.dispose()
  }

  const storageRoot = join(harnessHome, 'storages')
  const workspacePath = join(storageRoot, 'workspace.json')
  const messengerPath = join(storageRoot, 'session_messenger.json')
  const smokeWorkspaceId = 'desktop-smoke-workspace'
  const workspaceCreatedAt = new Date(createdAt).toISOString()
  // The attach invariant compares the session cwd's resolved path against the
  // workspace path, so the seed must record the resolved form (macOS /var ->
  // /private/var symlink) instead of the authored temporary path.
  const resolvedWorkspacePath = await realpath(activeSessionCwd)
  await mkdir(storageRoot, { recursive: true })
  await writeFile(workspacePath, `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      workspaceIds: [smokeWorkspaceId],
      archivedSessionIds: [ARCHIVED_CLIPBOARD_SESSION_ID],
    },
    tables: {
      workspaces: {
        [smokeWorkspaceId]: {
          path: resolvedWorkspacePath,
          title: activeSessionTitle,
          sessionIds: [ACTIVE_CLIPBOARD_SESSION_ID, ARCHIVED_CLIPBOARD_SESSION_ID],
          createdAt: workspaceCreatedAt,
          updatedAt: workspaceCreatedAt,
        },
      },
    },
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
    messengerSourceSessionId: MESSENGER_SOURCE_SESSION_ID,
    messengerSourceSessionTitle: messengerSourceTitle,
    messengerSubagentSessionId: MESSENGER_SUBAGENT_SESSION_ID,
    expectedDailyTokens: (headers.length - 1 + NAVIGATION_TURN_COUNT) * Object.values(SEEDED_SESSION_USAGE)
      .reduce<number>((total, tokens) => total + tokens, 0),
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

interface StableProtectedFileSnapshotOptions {
  readonly stableForMs?: number
  readonly timeoutMs?: number
  readonly readSnapshot?: (paths: readonly string[]) => Promise<Record<string, string>>
  readonly wait?: (delayMs: number) => Promise<void>
  readonly now?: () => number
}

/**
 * Wait until session-restore writes have remained unchanged for one complete
 * persistence window before using protected files as a side-effect baseline.
 * @param paths - exact files whose bytes must settle together.
 * @param options - bounded timing and deterministic test seams.
 * @returns the first snapshot unchanged for the requested stable interval.
 */
export async function waitForStableProtectedFileSnapshot(
  paths: readonly string[],
  options: StableProtectedFileSnapshotOptions = {},
): Promise<Record<string, string>> {
  const stableForMs = options.stableForMs ?? 500
  const timeoutMs = options.timeoutMs ?? 15_000
  const readSnapshot = options.readSnapshot ?? protectedFileSnapshot
  const wait = options.wait ?? (async (delayMs: number) => { await delay(delayMs) })
  const now = options.now ?? Date.now
  const deadline = now() + timeoutMs
  let previous = await readSnapshot(paths)
  while (now() < deadline) {
    await wait(Math.min(stableForMs, Math.max(1, deadline - now())))
    const current = await readSnapshot(paths)
    if (paths.every(path => current[path] === previous[path])) return current
    previous = current
  }
  throw new Error('Packaged smoke: protected session files did not reach a stable baseline.')
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

async function surfaceCounts(page: Page): Promise<string> {
  return JSON.stringify({
    surface: await page.locator('body[data-dsh-surface="desktop"]').count(),
    sidebarCol: await page.locator('[class*="sidebarCol"]').count(),
    centerCol: await page.locator('[class*="centerCol"]').count(),
    detailsCol: await page.locator('[class*="detailsCol"]').count(),
    newSession: await page.locator('[data-dsh-desktop-command="new-session"]').count(),
    openAddMenu: await page.locator('[data-dsh-desktop-command="open-add-menu"]').count(),
    openSettings: await page.locator('[data-dsh-desktop-command="open-settings"]').count(),
  })
}

async function waitForDesktopSurface(page: Page, userData: string, consoleErrors: readonly string[] = []): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error(`Packaged smoke: desktop window closed during startup.\n${await desktopStartupDiagnostic(page, userData)}`)
    }
    if (await page.locator('body[data-dsh-surface="desktop"]').count() === 1) {
      const requiredSurfaceCounts = await Promise.all([
        page.locator('[class*="sidebarCol"]').count(),
        page.locator('[class*="centerCol"]').count(),
        page.locator('[class*="detailsCol"]').count(),
        page.locator('[data-dsh-desktop-command="new-session"]').count(),
        page.locator('[data-dsh-desktop-command="open-add-menu"]').count(),
        page.locator('[data-dsh-desktop-command="open-settings"]').count(),
      ])
      if (requiredSurfaceCounts.every(count => count === 1)) return
    }
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
  throw new Error(
    `Packaged smoke: desktop surface missed its startup deadline.\n${await desktopStartupDiagnostic(page, userData)}`
    + `\nSurface counts: ${await surfaceCounts(page)}`
    + `\nRenderer console errors:\n${consoleErrors.join('\n')}`,
  )
}

interface DesktopTitlebarGeometry {
  readonly frameTop: number
  readonly sidebarTop: number
  readonly framePaddingTop: string
  readonly dragStripContent: string
  readonly dragStripHeight: string
}

/**
 * Prove that the packaged renderer reserves native chrome only when the host
 * actually uses Electron's hidden-inset title bar. Windows already places the
 * renderer below its standard native frame, so an extra web drag strip is a
 * visible blank band rather than usable title-bar space.
 */
async function exerciseDesktopTitlebarGeometry(
  page: Page,
  platform: NodeJS.Platform,
): Promise<void> {
  const geometry = await page.locator('[class*="sidebarCol"]').evaluate((sidebar): DesktopTitlebarGeometry => {
    const frame = sidebar.parentElement
    if (!(frame instanceof HTMLElement)) throw new Error('Desktop frame is missing around the sidebar column.')
    const frameBounds = frame.getBoundingClientRect()
    const sidebarBounds = sidebar.getBoundingClientRect()
    const frameStyle = getComputedStyle(frame)
    const dragStripStyle = getComputedStyle(frame, '::before')
    return {
      frameTop: frameBounds.top,
      sidebarTop: sidebarBounds.top,
      framePaddingTop: frameStyle.paddingTop,
      dragStripContent: dragStripStyle.content,
      dragStripHeight: dragStripStyle.height,
    }
  })
  const diagnosticBase = join(repositoryRoot, `apps/desktop/release/desktop-smoke-titlebar-${platform}`)
  await Promise.all([
    writeFile(`${diagnosticBase}.json`, `${JSON.stringify(geometry, null, 2)}\n`, 'utf8'),
    page.screenshot({ path: `${diagnosticBase}.png` }),
  ])

  const contentInset = geometry.sidebarTop - geometry.frameTop
  if (platform === 'darwin') {
    expect(await page.locator('body[data-dsh-titlebar="hidden-inset"]').count()).toBe(1)
    if (
      contentInset < 37.5
      || geometry.framePaddingTop !== '38px'
      || geometry.dragStripContent === 'none'
      || geometry.dragStripHeight !== '38px'
    ) {
      throw new Error(
        `Packaged macOS desktop lost its native traffic-light safe area: ${JSON.stringify({
          ...geometry,
          contentInset,
        })}`,
      )
    }
    return
  }
  if (platform === 'win32' && (
    Math.abs(contentInset) > 0.5
    || geometry.framePaddingTop !== '0px'
    || geometry.dragStripContent !== 'none'
  )) {
    throw new Error(
      `Packaged Windows desktop reserves a renderer title-bar inset under the native frame: ${JSON.stringify({
        ...geometry,
        contentInset,
      })}`,
    )
  }
}

/** Native Add-menu acceptance without submitting any provider request. */
async function exerciseComposerAddMenu(page: Page, seeded: WindowsClipboardSmokeState): Promise<void> {
  // The composer mounts only for an open Session; the messenger acceptance
  // above may leave the conversation on the empty hero.
  const activeRow = page.locator('[class*="sessionRow"]').filter({ hasText: seeded.activeSessionTitle }).first()
  await activeRow.waitFor({ state: 'visible', timeout: 15_000 })
  if (await activeRow.getAttribute('aria-selected') !== 'true') {
    await activeRow.click()
    await expect.poll(() => activeRow.getAttribute('aria-selected'), { timeout: 15_000 }).toBe('true')
  }
  const trigger = page.locator('[data-dsh-desktop-command="open-add-menu"]')
  const composer = page.locator('[data-composer-card]').last()
  // The alpha.5 composer surface is the shell-owned Lexical contenteditable.
  const input = composer.locator('[data-composer-input]')

  await trigger.click()
  const menu = composer.locator('[data-composer-add-menu="true"]')
  await menu.waitFor({ state: 'visible', timeout: 15_000 })
  expect(await menu.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return bounds.left >= 0
      && bounds.top >= 0
      && bounds.right <= window.innerWidth
      && bounds.bottom <= window.innerHeight
  })).toBe(true)
  await expect.poll(() => menu.evaluate((element) => {
    const sections = [...element.querySelectorAll('[data-add-section="true"]')]
      .map(section => section.textContent ?? '')
    const rows = element.querySelectorAll('button[role="option"]')
    const skillCount = element.querySelectorAll('button[id^="dsh-slash-option-skill-"]').length
    return {
      settled: element.querySelector('[role="status"]') === null,
      baseOptionCount: rows.length - skillCount,
      sectionsMatchSkills: /^(?:Add|添加)$/u.test(sections[0] ?? '')
        && (skillCount === 0
          ? sections.length === 1
          : sections.length === 2 && /^(?:Plugins|插件)$/u.test(sections[1] ?? '')),
    }
  })).toEqual({ settled: true, baseOptionCount: 4, sectionsMatchSkills: true })
  const options = menu.getByRole('option')
  expect(await options.evaluateAll(rows => rows.every(row => row.querySelector('svg') !== null))).toBe(true)
  await menu.getByRole('option', { name: /^goal/iu }).waitFor({ state: 'visible' })
  await menu.getByRole('option', { name: /^plan/iu }).waitFor({ state: 'visible' })
  const commandRows = menu.locator('button[id^="dsh-slash-option-command-"]')
  expect(await commandRows.count()).toBe(2)
  await commandRows.nth(0).getByText(/^goal$/iu).waitFor({ state: 'visible' })
  await commandRows.nth(1).getByText(/^plan$/iu).waitFor({ state: 'visible' })
  const skillRows = menu.locator('button[id^="dsh-slash-option-skill-"]')
  if (await skillRows.count() > 0) {
    expect(await menu.locator('[data-add-section="true"]').allTextContents()).toContainEqual(
      expect.stringMatching(/^(?:Plugins|插件)$/u),
    )
    expect(await menu.getByRole('option', { name: /^browser-skill\b/iu }).count()).toBe(0)
  }

  // Files delegates into the existing @ reference pipeline.
  await menu.getByRole('option', { name: /^(?:Files and folders|文件和文件夹)/u }).click()
  await expect.poll(() => input.textContent()).toBe('@')
  await input.fill('')

  // The attachment picker and drag-and-drop share the same file intake.
  await trigger.click()
  await menu.waitFor({ state: 'visible', timeout: 15_000 })
  const chooser = page.waitForEvent('filechooser')
  await menu.getByRole('option', { name: /^(?:Attach file|添加附件)/u }).click()
  const fileChooser = await chooser
  await fileChooser.setFiles({
    name: 'desktop-add-menu.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  })
  const remove = page.getByRole('button', { name: /^(?:Remove image|移除图片).*desktop-add-menu\.png/iu })
  await remove.waitFor({ state: 'visible', timeout: 15_000 })
  await remove.click()
  await expect.poll(() => remove.count()).toBe(0)

  // A native document drop enters the same attachment rail without
  // becoming an @ workspace reference or allocating an image object URL.
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['packaged document drop'], 'desktop-dropped-notes.md', {
      type: 'text/markdown',
    }))
    const init = { bubbles: true, cancelable: true, dataTransfer: transfer }
    document.dispatchEvent(new DragEvent('dragenter', init))
    document.dispatchEvent(new DragEvent('dragover', init))
    document.dispatchEvent(new DragEvent('drop', init))
  })
  const removeDocument = page.getByRole('button', {
    name: /^(?:Remove attachment|移除附件).*desktop-dropped-notes\.md/iu,
  })
  await removeDocument.waitFor({ state: 'visible', timeout: 15_000 })
  await removeDocument.click()
  await expect.poll(() => removeDocument.count()).toBe(0)

  // The reference menu stays usable without bundled BrowserSkill.
  await input.fill('@')
  const mentionMenu = composer.locator('[data-trigger-menu]:not([data-composer-add-menu])')
  await mentionMenu.waitFor({ state: 'visible', timeout: 15_000 })
  expect(await mentionMenu.getByRole('option', { name: /^browser-skill\b/iu }).count()).toBe(0)
  await input.fill('')
}

async function exerciseWindowsClipboard(
  page: Page,
  application: ElectronApplication,
  seeded: WindowsClipboardSmokeState,
): Promise<void> {
  const beforeFiles = await waitForStableProtectedFileSnapshot(seeded.protectedPaths)
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
    const activeRow = page.locator('[class*="sessionRow"]').filter({ hasText: seeded.activeSessionTitle }).first()
    await activeRow.waitFor({ state: 'visible', timeout: 15_000 })
    await activeRow.hover()
    const activeActions = activeRow.getByRole('button', {
      name: new RegExp(
        `(?:会话“${seeded.activeSessionTitle}”的操作|Session actions for ${seeded.activeSessionTitle})`,
        'u',
      ),
    })
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
    expect(await waitForStableProtectedFileSnapshot(seeded.protectedPaths)).toEqual(beforeFiles)
    expect(await page.locator('[role="treeitem"][aria-selected="true"]').allTextContents()).toEqual(selectedBefore)
    await page.keyboard.press('Escape')
    await archiveDialog.waitFor({ state: 'detached', timeout: 15_000 })
  } finally {
    await application.evaluate(({ clipboard }, text) => { clipboard.writeText(text) }, previousClipboard)
  }
}

async function exerciseWindowsDirectoryPicker(
  page: Page,
  harnessHome: string,
  userData: string,
): Promise<void> {
  const selectedDirectory = join(harnessHome, 'native-picker-selected')
  await mkdir(selectedDirectory, { recursive: true })
  const automation = execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(repositoryRoot, 'scripts/windows-directory-picker-ui-smoke.ps1'),
    '-FolderPath',
    selectedDirectory,
  ], { timeout: 90_000 })

  const addWorkspace = page.getByRole('button', {
    name: /^(?:Add workspace|添加工作区)$/u,
  })
  await addWorkspace.waitFor({ state: 'visible', timeout: 15_000 })
  await addWorkspace.click()
  await automation

  const selectedWorkspace = page.locator('[role="treeitem"][aria-expanded]').filter({
    has: page.getByText(basename(selectedDirectory), { exact: true }),
  })
  await expect.poll(() => selectedWorkspace.count(), { timeout: 30_000 }).toBe(1)
  await selectedWorkspace.waitFor({ state: 'visible', timeout: 30_000 })
  const nativeBlankSession = page.getByRole('treeitem').filter({
    has: page.getByText(/^(?:New Session|新会话)$/u, { exact: true }),
  }).first()
  await nativeBlankSession.waitFor({ state: 'visible', timeout: 30_000 })
  await expect.poll(
    () => nativeBlankSession.getAttribute('aria-selected'),
    { timeout: 30_000 },
  ).toBe('true')
  await page.locator('[class*="centerCol"]')
    .getByText(basename(selectedDirectory), { exact: true })
    .waitFor({ state: 'visible', timeout: 30_000 })
  const lifecycle = await readFile(join(userData, 'logs', 'lifecycle.log'), 'utf8')
  expect(lifecycle).not.toContain('FATAL ERROR')
  expect(await page.locator('body[data-dsh-surface="desktop"]').count()).toBe(1)
}

async function dismissCredentialOnboarding(page: Page, required: boolean): Promise<void> {
  const credentialDialog = page.getByRole('dialog', {
    name: /^(?:Add an API key to get started|添加一个 API Key 开始使用)$/u,
  })
  try {
    await credentialDialog.waitFor({ state: 'visible', timeout: required ? 30_000 : 10_000 })
  } catch (error) {
    if (!required) return
    throw error
  }
  await credentialDialog.getByRole('button', {
    name: /^(?:Configure later|稍后配置)$/u,
  }).click()
  await credentialDialog.waitFor({ state: 'detached', timeout: 30_000 })
}

/**
 * Wait for initial Session restoration before making sidebar toggle decisions.
 * The shell can render before the current Workspace automatically expands.
 * @param page - The application renderer under test.
 * @returns When the restored Session exposes its enabled composer (including Hero Sessions).
 */
export async function waitForDesktopSessionReady(page: Page): Promise<void> {
  await page.locator('[data-composer-input][contenteditable="true"]:not([aria-disabled="true"])')
    .waitFor({ state: 'visible', timeout: 30_000 })
}

/**
 * Select a seeded Session through its actual sidebar, including the ungrouped bucket.
 * @param page - The application renderer under test.
 * @param title - Exact title of the owned seed, whose optional Workspace has the same title.
 * @returns When the selected Session has a visible composer.
 */
export async function activateSmokeSession(page: Page, title: string): Promise<void> {
  const row = page.locator('[class*="sessionRow"]').filter({ has: page.getByText(title, { exact: true }) }).first()
  if (!await row.isVisible()) {
    const projects = page.locator('[class*="projectRow"]')
    const namedProject = projects.filter({ has: page.getByText(title, { exact: true }) }).first()
    const group = await namedProject.isVisible()
      ? namedProject
      : projects.filter({ hasText: /^(?:Ungrouped|未分组)$/u }).first()
    await group.waitFor({ state: 'visible', timeout: 15_000 })
    if (await group.getAttribute('aria-expanded') !== 'true') {
      await group.click()
      await expect.poll(() => group.getAttribute('aria-expanded'), { timeout: 15_000 }).toBe('true')
    }
  }
  await row.click()
  await expect.poll(() => row.getAttribute('aria-selected'), { timeout: 15_000 }).toBe('true')
  await page.locator('[data-composer-input][contenteditable="true"]')
    .waitFor({ state: 'visible', timeout: 15_000 })
}

/**
 * Select only: repeatedly change an existing Session's route, leave and return,
 * then restore the reader's route before effort acceptance and reader arm.
 * @param page - The application renderer under test.
 * @param persistenceRoot - The isolated Session store used by that application.
 * @param seeded - Owned Session identities used for navigation and durable assertions.
 * @param providerTripwire - Loopback provider that must receive no requests during selection.
 * @returns After both routes have been selected twice and the original route is restored.
 */
export async function exerciseExistingSessionModelSwitch(
  page: Page,
  persistenceRoot: string,
  seeded: WindowsClipboardSmokeState,
  providerTripwire: Awaited<ReturnType<typeof startReaderSmokeProvider>>,
): Promise<void> {
  const routes = [
    { provider: 'desktop-smoke-alternate', model: 'native-switcher', group: 'Desktop Smoke Alternate', name: 'Native Smoke Switcher' },
    { provider: 'desktop-smoke', model: 'native-thinker', group: 'Desktop Smoke', name: 'Native Smoke Thinker' },
  ] as const
  const trigger = page.getByRole('button', {
    name: /^(?:Select model, current |选择模型，当前 )/u,
  })
  const popup = page.getByRole('dialog', {
    name: /^(?:Model and reasoning effort|模型与推理等级)$/u,
  })
  const assertNoRequest = (): void => {
    expect(providerTripwire.phase).toBe('idle')
    expect(providerTripwire.requests).toEqual([])
    expect(providerTripwire.acceptedRequests).toBe(0)
    expect(providerTripwire.acceptedTitleRequests).toBe(0)
  }

  const observer = new Context()
  try {
    await observer.plugin(SessionStore)
    await observer.plugin(JsonlSessionPersistence, { root: persistenceRoot })
    const assertRoute = async (route: typeof routes[number]): Promise<void> => {
      await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 15_000 }).toMatch(
        new RegExp(`^(?:Select model, current ${route.name}, reasoning effort High|选择模型，当前 ${route.name}，推理等级 High)$`, 'u'),
      )
      await expect.poll(async () => {
        // A read handle does not compete for the Host's write lease. Open a
        // fresh view so this checks durable selection on the exact seeded ID.
        const handle = await observer.sessionPersistence.open(SessionId(seeded.activeSessionId), 'read')
        try {
          const events = await handle.read()
          return events.findLast(event => event.type === 'model/selection')?.data
        } finally {
          await handle.close()
        }
      }, { timeout: 15_000 }).toEqual({
        provider: route.provider, model: route.model, reasoningEffort: 'high',
      })
      assertNoRequest()
    }

    assertNoRequest()
    await activateSmokeSession(page, seeded.activeSessionTitle)
    for (const route of [...routes, ...routes]) {
      await trigger.click()
      await popup.waitFor({ state: 'visible', timeout: 15_000 })
      const option = popup.locator(`section[aria-label="${route.group}"]`)
        .getByRole('button', { name: route.name, exact: true })
      await expect.poll(() => option.isEnabled(), { timeout: 15_000 }).toBe(true)
      expect(await option.getAttribute('aria-pressed')).toBe('false')
      await option.click()
      await popup.waitFor({ state: 'detached', timeout: 15_000 })
      await assertRoute(route)

      await activateSmokeSession(page, seeded.messengerSourceSessionTitle)
      await activateSmokeSession(page, seeded.activeSessionTitle)
      await assertRoute(route)
      await trigger.click()
      await popup.waitFor({ state: 'visible', timeout: 15_000 })
      await expect.poll(() => option.getAttribute('aria-pressed'), { timeout: 15_000 }).toBe('true')
      await expect.poll(() => popup.getByRole('slider', {
        name: /^(?:Reasoning effort|推理等级)$/u,
      }).inputValue(), { timeout: 15_000 }).toBe('2')
      await trigger.click()
      await popup.waitFor({ state: 'detached', timeout: 15_000 })
      assertNoRequest()
    }
    // The sequence ends on the existing active Session and original high
    // route; no composer submission, provider arm, or fixture turn is added.
    await assertRoute(routes[1])
  } finally {
    await observer.fiber.dispose()
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
  expect(await slider.getAttribute('max')).toBe('5')
  expect(await slider.getAttribute('step')).toBe('1')
  expect(await slider.inputValue()).toBe('2')
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
  await expect.poll(() => slider.getAttribute('aria-valuetext'), { timeout: 15_000 }).toBe('Ultra')
  expect(await popup.getByText(/(?:actual High|实际 High)/u).count()).toBe(0)
  await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 15_000 }).toMatch(
    /^(?:Select model, current Native Smoke Thinker, reasoning effort Ultra|选择模型，当前 Native Smoke Thinker，推理等级 Ultra)$/u,
  )
  await expect.poll(() => slider.evaluate((element) => {
    const track = element.parentElement
    const thumb = track?.querySelector('span[aria-hidden="true"]')
    if (!(track instanceof HTMLElement) || !(thumb instanceof HTMLElement)) return false
    const trackBounds = track.getBoundingClientRect()
    const thumbBounds = thumb.getBoundingClientRect()
    const rightGap = trackBounds.right - thumbBounds.right
    return thumbBounds.left >= trackBounds.left
      && rightGap >= 0
      && rightGap <= 3
  }), { timeout: 5_000 }).toBe(true)
  await expect.poll(() => readFile(join(harnessHome, 'settings.yaml'), 'utf8'), { timeout: 15_000 })
    .toContain('reasoningEffort: high')
  await page.screenshot({
    path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-reasoning-${platform}.png`),
  })
  await page.keyboard.press('Escape')
  await popup.waitFor({ state: 'detached', timeout: 15_000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const restoredTrigger = page.locator('button[aria-haspopup="dialog"]')
    .filter({ hasText: 'Native Smoke Thinker' })
  await restoredTrigger.waitFor({ state: 'visible', timeout: 30_000 })
  await expect.poll(() => restoredTrigger.getAttribute('aria-label'), { timeout: 15_000 }).toMatch(
    /^(?:Select model, current Native Smoke Thinker, reasoning effort Ultra|选择模型，当前 Native Smoke Thinker，推理等级 Ultra)$/u,
  )
}

async function exerciseSessionMessenger(
  page: Page,
  seeded: WindowsClipboardSmokeState,
  platform: NodeJS.Platform,
): Promise<void> {
  const activeRow = page.locator('[class*="sessionRow"]').filter({ hasText: seeded.activeSessionTitle }).first()
  await activeRow.click()
  await expect.poll(() => activeRow.getAttribute('aria-selected'), { timeout: 15_000 }).toBe('true')
  if (platform === 'win32') await dismissCredentialOnboarding(page, false)

  // Selecting a cold root can finish its Agent-policy replay a few seconds
  // after the row itself becomes selected. Wait through that complete restore
  // window before declaring subsequent relay rendering side-effect-free.
  const beforeFiles = await waitForStableProtectedFileSnapshot(seeded.protectedPaths, {
    stableForMs: 4_000,
    timeoutMs: 20_000,
  })
  expect(await page.locator('[data-messenger-trigger]').count()).toBe(0)
  expect(await page.getByRole('dialog', { name: /^(?:Session messages|会话通信)$/u }).count()).toBe(0)

  const relay = page.locator('[data-session-relay-incoming]').filter({ hasText: 'desktop-smoke-visible-message' })
  await relay.waitFor({ state: 'visible', timeout: 30_000 })
  const relayText = await relay.innerText()
  expect(relayText).toContain(seeded.messengerSourceSessionTitle)
  expect(relayText).toMatch(/(?:Sent from another chat by .*|由 .* 从另一个聊天发来)/u)
  // The relay replay restores the owning row's selection asynchronously;
  // poll through the same restore window used for the file snapshot above.
  await expect.poll(() => activeRow.getAttribute('aria-selected'), { timeout: 15_000 }).toBe('true')
  expect(await waitForStableProtectedFileSnapshot(seeded.protectedPaths)).toEqual(beforeFiles)
  await page.screenshot({
    path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-messenger-${platform}.png`),
  })
}

/**
 * Turn-navigation acceptance over the seeded thirty-turn session: the rail
 * must page beyond the loaded window, keep one mark per turn, and clamp its
 * hover preview inside the rail band above the composer.
 */
async function exerciseTurnNavigation(page: Page, seeded: WindowsClipboardSmokeState): Promise<void> {
  // The installed default-size contract is 1012px: the rail remains available
  // in the transcript's start gutter instead of disappearing at the old 900px
  // center-column threshold.
  await prepareTurnNavigationViewport(page)
  const activeRow = page.locator('[class*="sessionRow"]').filter({ hasText: seeded.activeSessionTitle }).first()
  await activeRow.waitFor({ state: 'visible', timeout: 15_000 })
  if (await activeRow.getAttribute('aria-selected') !== 'true') {
    await activeRow.click()
    await expect.poll(() => activeRow.getAttribute('aria-selected'), { timeout: 15_000 }).toBe('true')
  }

  const frame = page.locator('nav[aria-label*="轮次导航"], nav[aria-label*="Turn navigation"]')
  await frame.waitFor({ state: 'visible', timeout: 15_000 })
  const marks = frame.locator('button[aria-label*="跳转"], button[aria-label*="jump to"]')
  // The rail lists one mark per turn OUTLINED so far, and the transcript
  // virtualization pages outlines as turns load — at Windows font metrics a
  // fresh window covers fewer than all thirty seeded turns. Require a
  // populated multi-turn rail here; the exact thirty-turn seed is pinned by
  // the cross-platform helpers spec at the data layer.
  await expect.poll(() => marks.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(10)

  await page.evaluate(async () => {
    const transitions = document.getAnimations().filter(animation =>
      animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime))
    await Promise.all(transitions.map(animation => animation.finished.catch(() => undefined)))
  })
  // Read all related boxes in one browser frame; sidebar transitions otherwise
  // move the origin between separate Playwright geometry requests.
  const { frameBox, transcriptBox, centerBox } = await frame.evaluate((rail) => {
    const center = rail.closest('[class*="centerCol"]')
    const transcript = center?.querySelector('[data-chat-flow]')
    if (center === null || transcript === null || transcript === undefined) {
      throw new Error('Packaged smoke: transcript geometry is unavailable.')
    }
    return {
      frameBox: rail.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number },
      transcriptBox: transcript.getBoundingClientRect().toJSON() as { x: number },
      centerBox: center.getBoundingClientRect().toJSON() as { x: number },
    }
  })
  expect(await page.locator('[data-width-handle]').count()).toBe(0)
  const flow = page.locator('[data-chat-flow]').first()
  const initialFlow = await flow.boundingBox()
  if (initialFlow === null) throw new Error('Packaged smoke: transcript geometry is unavailable.')
  for (const x of [initialFlow.x - 38, initialFlow.x + initialFlow.width + 38]) {
    const y = frameBox.y + frameBox.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 45, y, { steps: 5 })
    await page.mouse.up()
    const after = await flow.boundingBox()
    expect(after?.width).toBe(initialFlow.width)
  }
  expect(frameBox.x + frameBox.width).toBeLessThanOrEqual(transcriptBox.x)
  expect(frameBox.x - centerBox.x).toBeGreaterThanOrEqual(15)
  expect(transcriptBox.x - frameBox.x - frameBox.width).toBeGreaterThanOrEqual(11)
  const composerBox = await page.locator('[data-composer-card]').last().boundingBox()

  // Hover the lower band so the preview must clamp against the composer
  // floor; the tooltip stays inside the frame and never crosses the composer.
  // hover() recomputes live geometry, so the paging restore cannot stale the
  // coordinates mid-gesture.
  for (const fraction of [0.7, 0.85, 0.95]) {
    await frame.hover({ position: { x: frameBox.width / 2, y: frameBox.height * fraction } })
    const tooltip = page.getByRole('tooltip')
    try {
      await expect.poll(async () => tooltip.count(), { timeout: 5_000 }).toBe(1)
    } catch (error) {
      const hit = await page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y)
        return element === null ? 'none' : `${element.tagName}.${element.className}`.slice(0, 120)
      }, { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height * fraction })
      throw new Error(
        `Packaged smoke: turn preview missing at fraction ${fraction}; hit=${hit} frame=${JSON.stringify(frameBox)}. ${String(error)}`,
      )
    }
    const liveBox = await frame.boundingBox()
    if (liveBox === null) throw new Error('Packaged smoke: turn rail frame geometry moved away.')
    const tipBox = await tooltip.boundingBox()
    if (tipBox === null) throw new Error('Packaged smoke: turn preview tooltip geometry is unavailable.')
    expect(tipBox.y).toBeGreaterThanOrEqual(liveBox.y - 1)
    expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(liveBox.y + liveBox.height + 1)
    if (composerBox !== null) {
      expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(composerBox.y + 1)
    }
    await page.mouse.move(0, 0)
    await expect.poll(async () => tooltip.count(), { timeout: 5_000 }).toBe(0)
  }
  await verifyTurnNavigationClick(page)
}

interface MarketRouteResult {
  status: number
  body: unknown
}

/** Teardown-class renderer console noise the smoke tolerates by design. */
function isBenignConsoleError(message: string): boolean {
  return /^Failed to load resource: the server responded with a status of 409 \(Conflict\)(?: \[https?:\/\/[^\]]+\])?$/u.test(message)
    || /^Failed to load resource: net::ERR_INCOMPLETE_CHUNKED_ENCODING(?: \[https?:\/\/[^\]]+\])?$/u.test(message)
    || /^Failed to load resource: net::ERR_CONNECTION_REFUSED(?: \[https?:\/\/[^\]]+\])?$/u.test(message)
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
  const fixtureName = await seedOrdinaryMarketFixture(harnessHome)
  const settingsTrigger = page.locator('[data-dsh-desktop-command="open-settings"]')
  await expect.poll(() => settingsTrigger.getAttribute('aria-expanded'), { timeout: 15_000 })
    .not.toBe('true')
  await settingsTrigger.click()
  const settingsDialog = page.getByRole('dialog').last()
  await settingsDialog.waitFor({ state: 'visible', timeout: 15_000 })
  await settingsDialog.getByRole('button', { name: /^(?:Plugin Market|插件市场)$/u }).click()

  const market = settingsDialog.locator('[data-dshmarket-layout="reference"]')
  await market.waitFor({ state: 'visible', timeout: 30_000 })
  const search = market.locator('[data-dshmarket-search]')
  const installedRail = market.locator('[data-dshmarket-installed-rail]')
  const publicMode = market.locator('[data-dshmarket-mode="public"]')
  const personalMode = market.locator('[data-dshmarket-mode="personal"]')
  const management = market.locator('[data-dshmarket-management-trigger]')
  for (const control of [search, installedRail, publicMode, personalMode, management]) {
    await control.waitFor({ state: 'visible', timeout: 30_000 })
  }
  for (const name of ['@deepseek-ai/dsh-missher-brain', 'dsh-missher-memory', 'dsh-missher-evolution', 'dsh-media-missher']) {
    expect(await installedRail.locator(`button[data-package="${name}"]`).count()).toBe(0)
  }
  expect(await installedRail.evaluate(element => getComputedStyle(element).overflowX)).toBe('auto')
  // The shell and its controls mount before the same-origin registry request
  // resolves. Wait for the categorized content, not merely the outer shell.
  await expect.poll(
    () => market.locator('[data-dshmarket-section]').count(),
    { timeout: 30_000 },
  ).toBeGreaterThan(2)
  const firstSectionGrid = market.locator('[data-dshmarket-section]').first().locator('[data-dshmarket-plugin-row]').first().locator('..')
  expect(await firstSectionGrid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)

  await personalMode.click()
  await expect.poll(() => market.locator('[data-dshmarket-personal] [data-package]').count(), { timeout: 15_000 }).toBeGreaterThan(0)
  expect(await market.locator(`[data-dshmarket-personal] [data-package="${fixtureName}"]`).isVisible()).toBe(true)
  await publicMode.click()

  await management.click()
  await page.getByRole('menuitem', { name: /^(?:Activity|活动)$/u }).click()
  await market.locator('[data-dshmarket-activity]').waitFor({ state: 'visible', timeout: 15_000 })
  await publicMode.click()

  const firstRow = market.locator('[data-dshmarket-plugin-row]').first()
  await firstRow.waitFor({ state: 'visible', timeout: 30_000 })
  expect(await firstRow.locator('[data-dshmarket-primary-action], [data-dshmarket-overflow-menu]').count()).toBe(1)
  expect(await firstRow.evaluate((row) => {
    const description = row.querySelector('[data-dshmarket-plugin-description]')
    const action = row.querySelector('[data-dshmarket-primary-action], [data-dshmarket-overflow-menu]')
    if (!(description instanceof HTMLElement) || !(action instanceof HTMLElement)) return false
    const rowBounds = row.getBoundingClientRect()
    const actionBounds = action.getBoundingClientRect()
    return actionBounds.left > rowBounds.left + 80
      && Math.abs((actionBounds.top + actionBounds.height / 2) - (rowBounds.top + rowBounds.height / 2)) <= 2
  })).toBe(true)
  const packageName = await firstRow.getAttribute('data-package')
  expect(packageName).toBeTruthy()
  await search.fill(packageName ?? '')
  await expect.poll(() => market.locator('[data-dshmarket-plugin-row]').count(), { timeout: 15_000 }).toBeGreaterThan(0)
  expect(await market.locator(`[data-package="${packageName ?? ''}"]`).first().isVisible()).toBe(true)
  await search.fill('')
  await expect.poll(
    () => market.locator('[data-dshmarket-section]').count(),
    { timeout: 15_000 },
  ).toBeGreaterThan(2)

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
  const ordinaryUninstall = await postMarket(page, '/dsh-market/uninstall', { name: fixtureName })
  expect(ordinaryUninstall.status, JSON.stringify(ordinaryUninstall.body)).toBe(200)
  expect(ordinaryUninstall.body).toMatchObject({ ok: true, exitCode: 0 })

  await page.keyboard.press('Escape')
  await settingsDialog.waitFor({ state: 'detached', timeout: 15_000 })
}

async function exerciseUsageInsights(
  page: Page,
  platform: NodeJS.Platform,
  expectedDailyTokens: number,
): Promise<void> {
  const settingsTrigger = page.locator('[data-dsh-desktop-command="open-settings"]')
  // The native click can synchronously mount the overlay before Playwright's
  // pointer sequence settles. Treat opening Settings as an idempotent state
  // transition instead of clicking a trigger that already reports open.
  if (await settingsTrigger.getAttribute('aria-expanded') !== 'true') {
    await settingsTrigger.click()
  }
  const settingsDialog = page.getByRole('dialog').last()
  await settingsDialog.waitFor({ state: 'visible', timeout: 15_000 })
  await settingsDialog.getByRole('button', { name: /^(?:Usage|使用统计)$/u }).click()

  const usage = settingsDialog.locator('section[aria-label="Usage"], section[aria-label="使用统计"]')
  await usage.waitFor({ state: 'visible', timeout: 30_000 })
  const dailyParticles = usage.locator('[data-particle-mode="daily"]')
  await expect.poll(() => dailyParticles.count(), { timeout: 30_000 }).toBe(53 * 7)
  const activeDaily = usage.locator('[data-particle-mode="daily"]:not([data-level="0"])').last()
  expect(await activeDaily.getAttribute('data-display-tokens')).toBe(String(expectedDailyTokens))
  await activeDaily.hover()
  await usage.getByRole('tooltip').waitFor({ state: 'visible', timeout: 15_000 })
  expect(isUsageTokenTooltip(await usage.getByRole('tooltip').innerText())).toBe(true)

  await usage.getByRole('tab', { name: /^(?:Weekly|每周)$/u }).click()
  const weeklyParticles = usage.locator('[data-particle-mode="weekly"]')
  await expect.poll(() => weeklyParticles.count(), { timeout: 15_000 }).toBe(53 * 7)
  await usage.locator('[data-particle-mode="weekly"]:not([data-level="0"])').last().hover()
  expect(await usage.getByRole('tooltip').innerText()).toMatch(/(?:Week of|当周使用了)/u)

  await usage.getByRole('tab', { name: /^(?:Cumulative|累计)$/u }).click()
  const cumulativeParticles = usage.locator('[data-particle-mode="cumulative"]')
  await expect.poll(() => cumulativeParticles.count(), { timeout: 15_000 }).toBe(53 * 7)
  await usage.locator('[data-particle-mode="cumulative"]:not([data-level="0"])').last().hover()
  expect(await usage.getByRole('tooltip').innerText()).toMatch(/(?:Through|截至)/u)
  await page.screenshot({
    path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-usage-${platform}.png`),
  })

  await page.keyboard.press('Escape')
  await settingsDialog.waitFor({ state: 'detached', timeout: 15_000 })
}

async function exercisePersonalization(
  page: Page,
  harnessHome: string,
  platform: NodeJS.Platform,
): Promise<void> {
  const settingsTrigger = page.locator('[data-dsh-desktop-command="open-settings"]')
  if (await settingsTrigger.getAttribute('aria-expanded') !== 'true') await settingsTrigger.click()
  let settingsDialog = page.getByRole('dialog').last()
  await settingsDialog.waitFor({ state: 'visible', timeout: 15_000 })
  await settingsDialog.getByRole('button', { name: /^(?:Personalization|个性化)$/u }).click()

  let section = settingsDialog.locator('[data-personalization-section]')
  await section.waitFor({ state: 'visible', timeout: 15_000 })
  const instructions = `desktop-0.5.4-personalization-${platform}`
  const editor = section.locator('#dsh-personalization-instructions')
  await expect.poll(() => editor.isEnabled(), { timeout: 15_000 }).toBe(true)
  await editor.fill(instructions)
  await section.locator('#dsh-personalization-style').selectOption('professional')
  await section.getByRole('button', { name: /^(?:Save|保存)$/u }).click()
  await expect.poll(() => section.getByRole('status').innerText(), { timeout: 15_000 })
    .toMatch(/^(?:Saved|已保存)$/u)

  const stored = await readFile(join(harnessHome, 'AGENTS.md'), 'utf8')
  expect(stored).toContain('<!-- dsh-desktop:personalization:start -->')
  expect(stored).toContain(instructions)
  expect(stored).toContain('<!-- dsh-desktop:reply-style:professional -->')
  await page.screenshot({
    path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-personalization-${platform}.png`),
  })

  await page.keyboard.press('Escape')
  await settingsDialog.waitFor({ state: 'detached', timeout: 15_000 })
  await settingsTrigger.click()
  settingsDialog = page.getByRole('dialog').last()
  await settingsDialog.waitFor({ state: 'visible', timeout: 15_000 })
  await settingsDialog.getByRole('button', { name: /^(?:Personalization|个性化)$/u }).click()
  section = settingsDialog.locator('[data-personalization-section]')
  await expect.poll(
    () => section.locator('#dsh-personalization-instructions').inputValue(),
    { timeout: 15_000 },
  ).toBe(instructions)
  expect(await section.locator('#dsh-personalization-style').inputValue()).toBe('professional')
  await page.keyboard.press('Escape')
  await settingsDialog.waitFor({ state: 'detached', timeout: 15_000 })
}

async function exerciseSystemUpdate(page: Page, platform: NodeJS.Platform): Promise<void> {
  const bridgeShape = await page.evaluate(() => ({
    getUpdateStatus: typeof window.dshDesktop?.getUpdateStatus,
    checkForUpdates: typeof window.dshDesktop?.checkForUpdates,
    downloadUpdate: typeof window.dshDesktop?.downloadUpdate,
    installUpdate: typeof window.dshDesktop?.installUpdate,
    onUpdateStatus: typeof window.dshDesktop?.onUpdateStatus,
  }))
  if (platform !== 'darwin') {
    expect(bridgeShape).toEqual({
      getUpdateStatus: 'undefined',
      checkForUpdates: 'undefined',
      downloadUpdate: 'undefined',
      installUpdate: 'undefined',
      onUpdateStatus: 'undefined',
    })
    const settingsTrigger = page.locator('[data-dsh-desktop-command="open-settings"]')
    if (await settingsTrigger.getAttribute('aria-expanded') !== 'true') await settingsTrigger.click()
    const settingsDialog = page.getByRole('dialog').last()
    await settingsDialog.waitFor({ state: 'visible', timeout: 15_000 })
    expect(await settingsDialog.getByRole('button', { name: /^(?:System Update|系统更新)$/u }).count()).toBe(0)
    await page.keyboard.press('Escape')
    await settingsDialog.waitFor({ state: 'detached', timeout: 15_000 })
    return
  }
  expect(bridgeShape).toEqual({
    getUpdateStatus: 'function',
    checkForUpdates: 'function',
    downloadUpdate: 'function',
    installUpdate: 'function',
    onUpdateStatus: 'function',
  })

  const settingsTrigger = page.locator('[data-dsh-desktop-command="open-settings"]')
  if (await settingsTrigger.getAttribute('aria-expanded') !== 'true') {
    await settingsTrigger.click()
  }
  const settingsDialog = page.getByRole('dialog').last()
  await settingsDialog.waitFor({ state: 'visible', timeout: 15_000 })
  await settingsDialog.getByRole('button', { name: /^(?:System Update|系统更新)$/u }).click()

  const section = settingsDialog.locator('[data-system-update-section]')
  await section.waitFor({ state: 'visible', timeout: 15_000 })
  expect(await section.locator('[data-update-version]').count()).toBe(2)
  const desktopManifest = JSON.parse(
    await readFile(join(repositoryRoot, 'apps/desktop/package.json'), 'utf8'),
  ) as { version?: unknown }
  if (typeof desktopManifest.version !== 'string') throw new Error('Desktop package version is missing.')
  await expect.poll(() => section.innerText(), { timeout: 15_000 }).toContain(`v${desktopManifest.version}`)
  await page.screenshot({
    path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-system-update-${platform}.png`),
  })

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

async function exerciseDesktopPreferences(
  page: Page,
  application: ElectronApplication,
  platform: NodeJS.Platform,
  port: number,
): Promise<void> {
  const expectedDefault = platform === 'darwin' ? 'keep-running' : 'quit'
  const initial = await page.evaluate(async () => {
    if (typeof window.dshDesktop?.getDesktopPreferences !== 'function'
      || typeof window.dshDesktop.setDesktopPreference !== 'function'
      || typeof window.dshDesktop.onDesktopPreferences !== 'function') {
      throw new Error('Packaged smoke: Desktop preferences bridge is incomplete.')
    }
    return await window.dshDesktop.getDesktopPreferences()
  })
  expect(initial).toEqual({ closeBehavior: expectedDefault, tieredPricingEstimates: true })

  const switched = await page.evaluate(async () => {
    const bridge = window.dshDesktop
    if (bridge === undefined) throw new Error('Packaged smoke: Desktop preferences bridge disappeared.')
    await bridge.setDesktopPreference({ key: 'tieredPricingEstimates', value: false })
    await bridge.setDesktopPreference({ key: 'closeBehavior', value: 'keep-running' })
    return await bridge.getDesktopPreferences()
  })
  expect(switched).toEqual({ closeBehavior: 'keep-running', tieredPricingEstimates: false })

  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) throw new Error('Packaged smoke: native window is missing.')
    window.close()
  })
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0]?.isVisible() ?? true
  )), { timeout: 15_000 }).toBe(false)
  expect(await listenerPids(port, platform)).not.toEqual([])

  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) throw new Error('Packaged smoke: hidden native window was destroyed.')
    window.show()
    window.focus()
  })
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0]?.isVisible() ?? false
  )), { timeout: 15_000 }).toBe(true)

  const restored = await page.evaluate(async (closeBehavior) => {
    const bridge = window.dshDesktop
    if (bridge === undefined) throw new Error('Packaged smoke: Desktop preferences bridge disappeared.')
    if (closeBehavior !== 'keep-running' && closeBehavior !== 'quit') {
      throw new Error('Packaged smoke: invalid close behavior fixture.')
    }
    await bridge.setDesktopPreference({ key: 'tieredPricingEstimates', value: true })
    await bridge.setDesktopPreference({ key: 'closeBehavior', value: closeBehavior })
    return await bridge.getDesktopPreferences()
  }, expectedDefault)
  expect(restored).toEqual({ closeBehavior: expectedDefault, tieredPricingEstimates: true })
}

/**
 * Launch and exercise one packaged desktop executable on its native platform.
 * @param executable - Packaged Electron executable.
 * @param platform - Platform whose process inspection and quit path to exercise.
 * @returns The isolated seeded Session ids after the app and its Harness tree are gone.
 */
export async function runPackagedDesktopSmoke(
  executable: string,
  platform: NodeJS.Platform,
): Promise<PackagedDesktopSmokeResult> {
  const temporaryRoot = process.env.DSH_DESKTOP_SMOKE_ROOT
    ?? await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))
  const harnessHome = process.env.DSH_DESKTOP_SMOKE_DSH_HOME ?? join(temporaryRoot, 'dsh-home')
  const userData = process.env.DSH_DESKTOP_SMOKE_USER_DATA ?? join(temporaryRoot, 'electron-data')
  await Promise.all([mkdir(harnessHome, { recursive: true }), mkdir(userData, { recursive: true })])
  const legacyFallbackSeed = await seedLegacyModuleFallbackUpgradeState(harnessHome, platform)
  const clipboardSeed = await seedWindowsClipboardSmokeState(harnessHome)
  const archivedSessionPath = clipboardSeed.protectedPaths[1]
  if (archivedSessionPath === undefined) throw new Error('Packaged smoke: archived Session fixture is missing.')
  const upgradeProtectedPaths = [...legacyFallbackSeed.protectedPaths, archivedSessionPath]
  const upgradeProtectedBefore = await protectedFileSnapshot(upgradeProtectedPaths)
  const providerTripwire = await startReaderSmokeProvider()
  await writeDesktopSmokeModelSettings(harnessHome, providerTripwire.url)

  let nativeApp: ElectronApplication | undefined
  let quitCompleted = false
  let primaryDisplayScaleFactor: number | undefined
  let rendererDevicePixelRatio: number | undefined
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
        MISSHER_TENCENTDB_DIR: join(temporaryRoot, 'memory-source-unconfigured'),
        DEEPSEEK_API_KEY: '',
        DEEPSEEK_BASE_URL: providerTripwire.url,
      },
      timeout: 120_000,
    })
    const page = await nativeApp.firstWindow({ timeout: 120_000 })
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const source = message.location().url
        consoleErrors.push(`${message.text()}${source === '' ? '' : ` [${source}]`}`)
      }
    })
    page.on('pageerror', error => consoleErrors.push(error.message))

    // Check first-run reachability at the actual native window size before
    // widening the viewport for the separate workspace feature scenarios.
    const welcomeDialog = page.getByRole('dialog', {
      name: /^(?:Internal Testing Notice|内测声明)$/u,
    })
    try {
      await welcomeDialog.waitFor({ state: 'visible', timeout: 30_000 })
    } catch (error) {
      throw new Error(
        `Packaged smoke: notice dialog missing.\nbody=${await page.locator('body').innerText().catch(() => '[body unavailable]')}`
        + `\nconsole=${consoleErrors.join(' | ')}\n${String(error)}`,
      )
    }
    const initialWindow = await nativeApp.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (window === undefined) throw new Error('Packaged smoke: native window is missing.')
      const bounds = window.getBounds()
      return { bounds, workArea: screen.getDisplayMatching(bounds).workArea }
    })
    const continueButton = welcomeDialog.getByRole('button', { name: /^(?:Continue|继续)$/u })
    await continueButton.scrollIntoViewIfNeeded()
    const initialButton = await continueButton.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        rendererDevicePixelRatio: window.devicePixelRatio,
        receivesPointer: hit === element || (hit !== null && element.contains(hit)),
      }
    })
    const firstRunEvidence = join(repositoryRoot, 'apps/desktop/release', `desktop-smoke-first-run-${platform}`)
    await writeFile(`${firstRunEvidence}.json`, `${JSON.stringify({
      schemaVersion: 1, initialWindow, initialButton,
    }, null, 2)}\n`, 'utf8')
    await page.screenshot({ path: `${firstRunEvidence}.png` })
    const { bounds, workArea } = initialWindow
    expect(bounds.x).toBeGreaterThanOrEqual(workArea.x)
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(workArea.y + workArea.height)
    expect(initialButton.x).toBeGreaterThanOrEqual(0)
    expect(initialButton.y).toBeGreaterThanOrEqual(0)
    expect(initialButton.x + initialButton.width).toBeLessThanOrEqual(initialButton.viewportWidth)
    expect(initialButton.y + initialButton.height).toBeLessThanOrEqual(initialButton.viewportHeight)
    expect(initialButton.receivesPointer).toBe(true)
    await continueButton.click()
    await welcomeDialog.waitFor({ state: 'detached', timeout: 30_000 })
    await page.setViewportSize({ width: 1600, height: 1000 })
    ;[primaryDisplayScaleFactor, rendererDevicePixelRatio] = await Promise.all([
      nativeApp.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor),
      page.evaluate(() => window.devicePixelRatio),
    ])
    expect(Number.isFinite(primaryDisplayScaleFactor) && primaryDisplayScaleFactor > 0).toBe(true)
    expect(Number.isFinite(rendererDevicePixelRatio) && rendererDevicePixelRatio > 0).toBe(true)
    // Target the workspace row itself, not the first DOM match of its title
    // text (the title also appears in breadcrumbs, hover cards, and the
    // seeded Session title, and the trailing "New session" action only
    // surfaces on the row's hover state).
    const seededWorkspaceRow = page.locator('[class*="projectRow"]')
      .filter({ hasText: 'desktop-smoke-active-workspace' }).first()
    try {
      await seededWorkspaceRow.waitFor({ state: 'visible', timeout: 30_000 })
    } catch (error) {
      const dump = await page.evaluate(() => ({
        innerText: document.body.innerText.slice(0, 1600),
        rows: [...document.querySelectorAll('[class*="row"], [class*="Row"]')]
          .filter(element => element.textContent?.includes('desktop-smoke-active-workspace'))
          .slice(0, 8)
          .map((element) => {
            const bounds = element.getBoundingClientRect()
            return {
              tag: element.tagName,
              cls: element.className.slice(0, 200),
              visible: bounds.width > 0 && bounds.height > 0,
              text: (element.textContent ?? '').slice(0, 90),
            }
          }),
      }))
      throw new Error(
        `Packaged smoke: seeded workspace row is missing.\n${JSON.stringify(dump, null, 2)}\n${String(error)}`,
      )
    }
    await seededWorkspaceRow.hover()
    const seededWorkspace = page.getByRole('button', {
      name: /(?:在“desktop-smoke-active-workspace”中新建会话|New session in desktop-smoke-active-workspace)/u,
    })
    await seededWorkspace.waitFor({ state: 'visible', timeout: 30_000 })
    await seededWorkspace.click()

    await waitForDesktopSurface(page, userData, consoleErrors)
    await verifyLegacyModuleFallbackUpgrade(legacyFallbackSeed)
    expect(await protectedFileSnapshot(upgradeProtectedPaths)).toEqual(upgradeProtectedBefore)
    await exerciseDesktopTitlebarGeometry(page, platform)

    expect(await page.evaluate(() => (
      typeof window.dshDesktop?.onCommand === 'function'
      && typeof window.dshDesktop.recover === 'function'
    ))).toBe(true)

    const url = new URL(page.url())
    expect(url.hostname).toBe('127.0.0.1')
    // The alpha.5 token exchange redirects to the bare root; the desktop
    // surface marker is bridge-driven and verified through the body marker.
    expect(await page.locator('body[data-dsh-surface="desktop"]').count()).toBe(1)
    const port = Number(url.port)
    expect(port).toBeGreaterThan(0)
    expect(await listenerPids(port, platform)).not.toEqual([])
    await exerciseDesktopPreferences(page, nativeApp, platform, port)

    // CDP-driven Electron clicks do not carry the browser's ordinary user
    // clipboard permission. Grant the same automation permission as the
    // browser E2E suite, then verify the native Electron clipboard itself.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.origin })

    expect(await page.locator('[class*="sidebarCol"]').count()).toBe(1)
    expect(await page.locator('[class*="centerCol"]').count()).toBe(1)
    expect(await page.locator('[class*="detailsCol"]').count()).toBe(1)
    expect(await page.locator('[data-dsh-desktop-command="new-session"]').count()).toBe(1)
    expect(await page.locator('[data-dsh-desktop-command="open-add-menu"]').count()).toBe(1)
    expect(await page.locator('[data-dsh-desktop-command="open-settings"]').count()).toBe(1)

    // The native effort acceptance starts with an isolated, usable custom
    // provider so the first Session captures that exact model selection.
    // A usable non-DeepSeek route must also suppress the keyless onboarding.
    const credentialDialog = page.getByRole('dialog', {
      name: /^(?:Add an API key to get started|添加一个 API Key 开始使用)$/u,
    })
    await expect.poll(() => credentialDialog.count(), { timeout: 30_000 }).toBe(0)
    expect(await page.locator('#root').evaluate((element: HTMLElement) => !element.inert)).toBe(true)

    try {
      await exerciseWindowsClipboard(page, nativeApp, clipboardSeed)
      if (platform === 'win32') {
        await exerciseWindowsDirectoryPicker(page, harnessHome, userData)
      }
      await exerciseSessionMessenger(page, clipboardSeed, platform)
      await exerciseComposerAddMenu(page, clipboardSeed)
      await assertWorkbenchRemoved(page)
      await exerciseTurnNavigation(page, clipboardSeed)
      await exerciseExistingSessionModelSwitch(page, join(harnessHome, 'sessions'), clipboardSeed, providerTripwire)
      await exerciseComposerContinuity(page, {
        selectSession: title => activateSmokeSession(page, title),
        primaryTitle: clipboardSeed.activeSessionTitle,
        primaryTurns: NAVIGATION_TURN_COUNT,
        secondaryTitle: clipboardSeed.messengerSourceSessionTitle,
        evidenceDirectory: join(repositoryRoot, 'apps/desktop/release'),
        platform,
      })
      await exerciseReasoningEffort(page, harnessHome, platform)
    } catch (error) {
      throw new Error(
        `Packaged smoke: native shared-feature acceptance failed: ${String(error)}\n${await desktopStartupDiagnostic(page, userData)}`,
        { cause: error },
      )
    }

    // Keep renderer errors release-blocking; teardown-class noise (broken
    // event-stream chunks from exercise navigation, the intentional 409
    // protected-update probes, and refused in-flight requests after quit)
    // is tolerated at every check, matching the code's documented races.
    expect(consoleErrors.filter(message => !isBenignConsoleError(message))).toEqual([])
    consoleErrors.length = 0

    await page.waitForTimeout(15_000)
    expect(await page.locator('body').innerText()).not.toContain('Failed to load plugins')
    expect(await page.locator('[class*="centerCol"]').count()).toBe(1)
    await page.screenshot({
      path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-${platform}.png`),
    })

    await exerciseUsageInsights(page, platform, clipboardSeed.expectedDailyTokens)
    await exercisePersonalization(page, harnessHome, platform)
    await exerciseSystemUpdate(page, platform)
    await exercisePluginMarket(page, harnessHome, platform, consoleErrors)
    expect(consoleErrors.filter(message => !isBenignConsoleError(message))).toEqual([])
    expect(providerTripwire.requests).toEqual([])
    await page.locator('[data-dsh-desktop-command="new-session"]').click()
    await exerciseReaderPresentation(page, {
      driver: providerTripwire,
      evidence: {
        directory: join(repositoryRoot, 'apps/desktop/release'),
        prefix: 'desktop-smoke-reader', suffix: `-${platform}`,
      },
    })
    expect(providerTripwire.acceptedRequests).toBe(1)
    await expect.poll(() => providerTripwire.acceptedTitleRequests, { timeout: 5_000 }).toBe(1)
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
    expect(await protectedFileSnapshot(upgradeProtectedPaths)).toEqual(upgradeProtectedBefore)
  } finally {
    if (!quitCompleted && nativeApp !== undefined) await quitAfterSmokeFailure(nativeApp)
    await providerTripwire.close()
  }
  if (primaryDisplayScaleFactor === undefined || rendererDevicePixelRatio === undefined) {
    throw new Error('Packaged smoke: native scale evidence was not recorded.')
  }
  return {
    ...clipboardSeed,
    primaryDisplayScaleFactor,
    rendererDevicePixelRatio,
  }
}

/** Verify that layout state and preload cannot reopen the retired workbench. */
async function assertWorkbenchRemoved(page: Page): Promise<void> {
  expect(await page.locator('[data-desktop-workbench-panel], [data-utility-drawer], [data-side="utility"]').count()).toBe(0)
  expect(await page.getByRole('button', { name: /^(?:Open workbench|打开工作台)$/u }).count()).toBe(0)
  const api = await page.evaluate(() => Object.keys(window.dshDesktop ?? {}))
  expect(api.some(key => /WorkbenchBrowser|DesktopIntegrations/.test(key))).toBe(false)
}
