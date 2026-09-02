import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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
const MESSENGER_SUBAGENT_SESSION_ID = 'desktop-smoke-messenger-subagent-session-id'
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000

/** Native command used to prove the packaged workbench terminal is interactive. */
export function workbenchTerminalProbe(platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? "Write-Output 'desktop-workbench-terminal-ok'"
    : "printf 'desktop-workbench-terminal-ok\\n'"
}

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

/**
 * Seed the exact old-Profile shape that previously collided with Desktop's
 * built-in providers. The profile-local modules are deliberate tripwires: a
 * successful packaged boot proves the immutable overlay disabled them and
 * resolved the managed wrappers from the application installation instead.
 */
async function seedLegacyExternalBrainProfile(harnessHome: string): Promise<void> {
  const profile = join(harnessHome, 'profiles', 'web')
  const packages = [
    ['dsh-missher-memory', '0.1.3', 'missher-memory'],
    ['dsh-missher-evolution', '0.1.0', 'missher-evolution'],
  ] as const
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: Object.fromEntries(packages.map(([name]) => [name, `file:./legacy-packages/${name}`])),
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app',
          ...packages.map(([name]) => name),
        ],
      },
    },
  }, null, 2)}\n`, 'utf8')
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n', 'utf8')
  await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n', 'utf8')
  for (const [packageName, version, id] of packages) {
    for (const packageRoot of [
      join(profile, 'legacy-packages', packageName),
      join(profile, 'node_modules', packageName),
    ]) {
      await mkdir(join(packageRoot, 'lib'), { recursive: true })
      await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
        name: packageName,
        version,
        type: 'module',
        exports: {
          '.': { default: './lib/index.js' },
          './client': { default: './lib/client.js' },
          './package.json': './package.json',
        },
        dsh: {
          bundle: { patch: './cordis.patch.yml' },
          client: {
            inject: [
              '@deepseek-ai/dsh-client-runtime',
              '@deepseek-ai/dsh-client-ui-settings',
              '@deepseek-ai/dsh-client-locale',
              '@deepseek-ai/dsh-api-remotes',
            ],
            platform: 'web',
          },
        },
      }, null, 2)}\n`, 'utf8')
      await writeFile(join(packageRoot, 'cordis.patch.yml'), [
        '- insert:',
        `    - id: ${id}`,
        `      name: ${packageName}`,
        '',
      ].join('\n'), 'utf8')
      await writeFile(
        join(packageRoot, 'lib/index.js'),
        `throw new Error(${JSON.stringify(`packaged smoke loaded legacy ${packageName}`)})\n`,
        'utf8',
      )
      await writeFile(
        join(packageRoot, 'lib/client.js'),
        [
          'window.__ModuleLoader__.load({',
          `  id: ${JSON.stringify(packageName)},`,
          '  factory: () => {',
          `    throw new Error(${JSON.stringify(`packaged smoke loaded legacy client ${packageName}`)})`,
          '  },',
          '})',
          '',
        ].join('\n'),
        'utf8',
      )
    }
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

function completeTurn(createdAt: number): SessionEvent[] {
  return [
    {
      type: 'user/message',
      seq: 0,
      time: createdAt,
      data: {
        id: `desktop-smoke-user-${createdAt}` as never,
        role: 'user',
        source: { kind: 'user' },
        content: [],
      },
      surfaceOp: 'append',
    },
    {
      type: 'request/header',
      seq: 1,
      time: createdAt + 1,
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
    { type: 'turn/start', seq: 2, time: createdAt + 2, data: { turn: 1 } },
    {
      type: 'assistant/message',
      seq: 3,
      time: createdAt + 3,
      data: {
        turn: 1,
        step: 0,
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
    {
      type: 'turn/end',
      seq: 4,
      time: createdAt + 4,
      data: { turn: 1, reason: { kind: 'completed' } },
    },
    {
      type: 'permission/preset',
      seq: 5,
      time: createdAt + 5,
      data: { preset: 'workspace-write' },
    },
    {
      type: 'sandbox/mode',
      seq: 6,
      time: createdAt + 6,
      data: { mode: 'workspace-write' },
    },
    {
      type: 'approval/policy',
      seq: 7,
      time: createdAt + 7,
      data: { policy: 'ask' },
    },
    { type: 'session/end-seed', seq: 8, time: createdAt + 8, data: {} },
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
    {
      version: SESSION_FORMAT_VERSION,
      id: SessionId(MESSENGER_SUBAGENT_SESSION_ID),
      createdAt: createdAt + 3,
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
      await seeder.sessionPersistence.create(header)
      await seeder.sessionPersistence.append(header.id, completeTurn(header.createdAt))
      if (header.id === ACTIVE_CLIPBOARD_SESSION_ID) {
        const relayEvent: SessionEvent<'user/message'> = {
          type: 'user/message',
          seq: 9,
          time: header.createdAt + 9,
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
        await seeder.sessionPersistence.append(header.id, [relayEvent])
      }
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
    messengerSourceSessionId: MESSENGER_SOURCE_SESSION_ID,
    messengerSourceSessionTitle: messengerSourceTitle,
    messengerSubagentSessionId: MESSENGER_SUBAGENT_SESSION_ID,
    expectedDailyTokens: headers.length * Object.values(SEEDED_SESSION_USAGE)
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

async function waitForDesktopSurface(page: Page, userData: string): Promise<void> {
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
  throw new Error(`Packaged smoke: desktop surface missed its startup deadline.\n${await desktopStartupDiagnostic(page, userData)}`)
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

  if (platform !== 'win32') return
  const contentInset = geometry.sidebarTop - geometry.frameTop
  if (
    Math.abs(contentInset) > 0.5
    || geometry.framePaddingTop !== '0px'
    || geometry.dragStripContent !== 'none'
  ) {
    throw new Error(
      `Packaged Windows desktop reserves a renderer title-bar inset under the native frame: ${JSON.stringify({
        ...geometry,
        contentInset,
      })}`,
    )
  }
}

/** Native Add-menu acceptance without submitting any provider request. */
async function exerciseComposerAddMenu(page: Page): Promise<void> {
  const trigger = page.locator('[data-dsh-desktop-command="open-add-menu"]')
  const composer = page.locator('[data-composer-card]').last()
  const input = composer.locator('textarea')

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
  await expect.poll(() => menu.locator('[data-add-section="true"]').allTextContents()).toEqual(
    expect.arrayContaining([expect.stringMatching(/^(?:Add|添加)$/u), expect.stringMatching(/^(?:Commands|命令)$/u)]),
  )
  const options = menu.getByRole('option')
  await expect.poll(() => options.count()).toBeGreaterThanOrEqual(5)
  expect(await options.evaluateAll(rows => rows.every(row => row.querySelector('svg') !== null))).toBe(true)
  await menu.getByRole('option', { name: /^goal/iu }).waitFor({ state: 'visible' })
  await menu.getByRole('option', { name: /^plan/iu }).waitFor({ state: 'visible' })
  const commandRows = menu.locator('button[id^="dsh-slash-option-command-"]')
  expect(await commandRows.count()).toBeGreaterThanOrEqual(2)
  const skillRows = menu.locator('button[id^="dsh-slash-option-skill-"]')
  if (await skillRows.count() > 0) {
    expect(await menu.locator('[data-add-section="true"]').allTextContents()).toContainEqual(
      expect.stringMatching(/^(?:Plugins|插件)$/u),
    )
  }

  // Files delegates into the existing @ reference pipeline.
  await menu.getByRole('option', { name: /^(?:Files and folders|文件和文件夹)/u }).click()
  await expect.poll(() => input.inputValue()).toBe('@')
  await input.fill('')

  // The attachment picker accepts the same closed image/document roster as drag-and-drop.
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
  const remove = page.getByRole('button', { name: /^(?:Remove attachment|移除附件).*desktop-add-menu\.png/iu })
  await remove.waitFor({ state: 'visible', timeout: 15_000 })
  await remove.click()
  await expect.poll(() => remove.count()).toBe(0)

  // A native document drop enters the same closed attachment rail without
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
  const activeRow = page.getByRole('treeitem').filter({ hasText: seeded.activeSessionTitle }).first()
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
  expect(relayText).toMatch(/(?:Sent by .* from another chat|由 .* 从另一个聊天发来)/u)
  expect(await activeRow.getAttribute('aria-selected')).toBe('true')
  expect(await waitForStableProtectedFileSnapshot(seeded.protectedPaths)).toEqual(beforeFiles)
  await page.screenshot({
    path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-messenger-${platform}.png`),
  })
}

async function exerciseDesktopWorkbench(page: Page, platform: NodeJS.Platform): Promise<void> {
  // Keep this part of the native smoke in the resizable column layout rather
  // than the narrow-window utility drawer, which intentionally has no drag
  // handle.
  await page.setViewportSize({ width: 1600, height: 1000 })
  const sessionLog = page.getByRole('button', { name: /^Session log/u })
  const trigger = page.getByRole('button', { name: /^(?:Open workbench|打开工作台)$/u })
  await trigger.waitFor({ state: 'visible', timeout: 15_000 })
  const [sessionLogBounds, triggerBounds] = await Promise.all([
    sessionLog.boundingBox(),
    trigger.boundingBox(),
  ])
  if (sessionLogBounds === null || triggerBounds === null) {
    throw new Error('Packaged smoke: Session log and workbench trigger geometry is unavailable.')
  }
  expect(triggerBounds.x).toBeGreaterThanOrEqual(sessionLogBounds.x + sessionLogBounds.width)

  await trigger.click()
  const panel = page.locator('[data-desktop-workbench-panel]:visible')
  await panel.waitFor({ state: 'visible', timeout: 15_000 })
  const tabs = panel.getByRole('tablist').getByRole('tab')
  await expect.poll(() => tabs.count(), { timeout: 15_000 }).toBe(4)
  expect([
    ['审阅', '终端', '浏览器', '文件'],
    ['Review', 'Terminal', 'Browser', 'Files'],
  ]).toContainEqual(await tabs.allTextContents())
  const originalPanelBounds = await panel.boundingBox()
  const utilityHandle = page.locator('[data-side="utility"]')
  const utilityHandleBounds = await utilityHandle.boundingBox()
  if (originalPanelBounds === null || utilityHandleBounds === null) {
    throw new Error('Packaged smoke: workbench resize geometry is unavailable.')
  }
  await page.mouse.move(
    utilityHandleBounds.x + utilityHandleBounds.width / 2,
    utilityHandleBounds.y + utilityHandleBounds.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(utilityHandleBounds.x - 96, utilityHandleBounds.y + utilityHandleBounds.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0, {
    timeout: 15_000,
  }).toBeGreaterThan(originalPanelBounds.width + 64)
  const stablePanelWidth = (await panel.boundingBox())?.width ?? 0
  expect(stablePanelWidth).toBeGreaterThan(originalPanelBounds.width + 64)
  const expectStablePanelWidth = async (): Promise<void> => {
    await expect.poll(async () => Math.abs(((await panel.boundingBox())?.width ?? 0) - stablePanelWidth), {
      timeout: 15_000,
    }).toBeLessThanOrEqual(1)
  }
  const terminalInput = panel.getByPlaceholder(/^(?:Type a command and press Return|输入命令并按回车)$/u)
  await terminalInput.waitFor({ state: 'visible', timeout: 15_000 })
  await terminalInput.fill(workbenchTerminalProbe(platform))
  await terminalInput.press('Enter')
  await expect.poll(() => panel.innerText(), { timeout: 15_000 }).toContain('desktop-workbench-terminal-ok')
  expect(await panel.innerText()).not.toContain('posix_spawn failed')
  await page.screenshot({
    path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-workbench-${platform}.png`),
  })

  await panel.getByRole('tab', { name: /^(?:Browser|浏览器)$/u }).click()
  await panel.locator('[data-native-browser-host]').waitFor({ state: 'visible', timeout: 15_000 })
  await expectStablePanelWidth()
  // Leaving Terminal asynchronously tears down its PTY. Keep that teardown
  // fenced from the parent Harness process: the workbench must not take its
  // own Host offline when a user changes tools.
  await page.waitForTimeout(2_000)
  await expect.poll(async () => await page.evaluate(async () => {
    try { return (await fetch('/', { cache: 'no-store' })).status } catch { return 0 }
  }), { timeout: 10_000 }).toBe(200)
  await panel.getByRole('tab', { name: /^(?:Files|文件)$/u }).click()
  await panel.getByPlaceholder(/^(?:Filter files|筛选文件)$/u).waitFor({ state: 'visible', timeout: 15_000 })
  await expectStablePanelWidth()
  expect(await panel.getByRole('tab', { name: /^(?:Side chat|侧边聊天)$/u }).count()).toBe(0)
  await panel.getByRole('tab', { name: /^(?:Review|审阅)$/u }).click()
  await panel.getByText(/^(?:Changes|变更)$/u).waitFor({ state: 'visible', timeout: 15_000 })
  await expectStablePanelWidth()
  await panel.getByRole('button', { name: /^(?:Close workbench|关闭工作台)$/u }).click()
  const reopenTrigger = page.getByRole('button', { name: /^(?:Open workbench|打开工作台)$/u })
  await expect.poll(() => reopenTrigger.getAttribute('aria-expanded'), { timeout: 15_000 }).toBe('false')
  await reopenTrigger.click()
  await panel.waitFor({ state: 'visible', timeout: 15_000 })
  await expectStablePanelWidth()
  await panel.getByRole('button', { name: /^(?:Close workbench|关闭工作台)$/u }).click()
  await expect.poll(() => reopenTrigger.getAttribute('aria-expanded'), { timeout: 15_000 }).toBe('false')
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
  const builtinMemory = installedRail.locator('button[data-package="dsh-missher-memory"]')
  const builtinBrain = installedRail.locator('button[data-package="@deepseek-ai/dsh-missher-brain"]')
  const builtinEvolution = installedRail.locator('button[data-package="dsh-missher-evolution"]')
  await builtinBrain.waitFor({ state: 'visible', timeout: 30_000 })
  await builtinMemory.waitFor({ state: 'visible', timeout: 30_000 })
  await builtinEvolution.waitFor({ state: 'visible', timeout: 30_000 })
  const builtinActivation = await page.evaluate(async () => {
    const response = await fetch('/dsh-market/installed', { cache: 'no-store' })
    if (!response.ok) throw new Error(`market installed status failed: ${response.status}`)
    const body = await response.json() as {
      activation?: Record<string, { state?: string; hot?: boolean; reasons?: string[] }>
    }
    return body.activation ?? {}
  })
  expect(builtinActivation['@deepseek-ai/dsh-missher-brain']).toMatchObject({ state: 'live', hot: true })
  expect(builtinActivation['dsh-missher-memory']).toMatchObject({ state: 'live', hot: true })
  expect(builtinActivation['dsh-missher-evolution']).toMatchObject({ state: 'live', hot: true })
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

  await builtinMemory.click()
  await market.locator('[data-dshmarket-protected-package]').waitFor({ state: 'visible', timeout: 15_000 })
  expect(await market.locator('[data-dshmarket-protected-package]').innerText())
    .toMatch(/(?:Managed by DeepSeek Harness Desktop|由 DeepSeek Harness Desktop 管理)/u)
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
  const protectedMemoryUpdate = await postMarket(page, '/dsh-market/update', { name: 'dsh-missher-memory' })
  expect(protectedMemoryUpdate).toEqual({ status: 409, body: { ok: false, code: 'self-protected' } })
  const protectedMemoryUninstall = await postMarket(page, '/dsh-market/uninstall', { name: 'dsh-missher-memory' })
  expect(protectedMemoryUninstall).toEqual({ status: 409, body: { ok: false, code: 'self-protected' } })

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
  const instructions = `desktop-0.5.2-personalization-${platform}`
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

async function exerciseMemorySettings(
  page: Page,
  harnessHome: string,
  platform: NodeJS.Platform,
): Promise<void> {
  const stateFile = join(harnessHome, 'missher-memory', 'state.db')
  const stateExists = async (): Promise<boolean> => readFile(stateFile).then(() => true, () => false)
  expect(await stateExists()).toBe(false)

  const settingsTrigger = page.locator('[data-dsh-desktop-command="open-settings"]')
  if (await settingsTrigger.getAttribute('aria-expanded') !== 'true') await settingsTrigger.click()
  const settingsDialog = page.getByRole('dialog').last()
  await settingsDialog.waitFor({ state: 'visible', timeout: 15_000 })
  await settingsDialog.getByRole('button', { name: /^(?:Memory & Learning|记忆与学习)$/u }).click()
  const heading = settingsDialog.getByRole('heading', { name: /^(?:Memory & Learning|记忆与学习)$/u })
  await heading.waitFor({ state: 'visible', timeout: 30_000 })
  const section = heading.locator('xpath=ancestor::section[1]')
  await expect.poll(() => section.innerText(), { timeout: 15_000 }).toSatisfy((text: string) => (
    /(?:Project memory|项目记忆)/u.test(text)
    && /(?:Learned workflows|学到的工作流程)/u.test(text)
    && /(?:Memory stores stay on this device|记忆库保存在本机)/u.test(text)
  ))
  expect(await stateExists()).toBe(false)
  await page.screenshot({
    path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-memory-${platform}.png`),
  })
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
  expect(await section.locator(':scope > [class*="rows"] > [class*="row"]').count()).toBe(2)
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
  const legacyFallbackSeed = await seedLegacyModuleFallbackUpgradeState(harnessHome, platform)
  await seedLegacyExternalBrainProfile(harnessHome)
  const clipboardSeed = await seedWindowsClipboardSmokeState(harnessHome)
  const archivedSessionPath = clipboardSeed.protectedPaths[1]
  if (archivedSessionPath === undefined) throw new Error('Packaged smoke: archived Session fixture is missing.')
  const upgradeProtectedPaths = [...legacyFallbackSeed.protectedPaths, archivedSessionPath]
  const upgradeProtectedBefore = await protectedFileSnapshot(upgradeProtectedPaths)
  const providerTripwire = await startProviderTripwire()
  await writeDesktopSmokeModelSettings(harnessHome, providerTripwire.url)

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
    await waitForDesktopSurface(page, userData)
    await verifyLegacyModuleFallbackUpgrade(legacyFallbackSeed)
    expect(await protectedFileSnapshot(upgradeProtectedPaths)).toEqual(upgradeProtectedBefore)
    await exerciseDesktopTitlebarGeometry(page, platform)

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

    const welcomeDialog = page.getByRole('dialog', {
      name: /^(?:Internal Testing Notice|内测声明)$/u,
    })
    await welcomeDialog.waitFor({ state: 'visible', timeout: 30_000 })
    await welcomeDialog.getByRole('button', { name: /^(?:Continue|继续)$/u }).click()
    await welcomeDialog.waitFor({ state: 'detached', timeout: 30_000 })
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
      await exerciseComposerAddMenu(page)
      await exerciseDesktopWorkbench(page, platform)
      await exerciseReasoningEffort(page, harnessHome, platform)
    } catch (error) {
      throw new Error(
        `Packaged smoke: native shared-feature acceptance failed: ${String(error)}\n${await desktopStartupDiagnostic(page, userData)}`,
        { cause: error },
      )
    }

    // Keep renderer errors release-blocking; the legacy drawer no longer
    // issues archived or subagent send requests during this acceptance.
    expect(consoleErrors).toEqual([])
    consoleErrors.length = 0

    await page.waitForTimeout(15_000)
    expect(await page.locator('body').innerText()).not.toContain('Failed to load plugins')
    expect(await page.locator('[class*="centerCol"]').count()).toBe(1)
    await page.screenshot({
      path: join(repositoryRoot, `apps/desktop/release/desktop-smoke-${platform}.png`),
    })

    await exerciseUsageInsights(page, platform, clipboardSeed.expectedDailyTokens)
    await exercisePersonalization(page, harnessHome, platform)
    await exerciseMemorySettings(page, harnessHome, platform)
    await exerciseSystemUpdate(page, platform)
    await exercisePluginMarket(page, harnessHome, platform, consoleErrors)
    expect(consoleErrors.filter(message => (
      !/^Failed to load resource: the server responded with a status of 409 \(Conflict\)(?: \[https?:\/\/[^\]]+\])?$/u.test(message)
      && !/^Failed to load resource: net::ERR_INCOMPLETE_CHUNKED_ENCODING(?: \[https?:\/\/[^\]]+\])?$/u.test(message)
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
    expect(await protectedFileSnapshot(upgradeProtectedPaths)).toEqual(upgradeProtectedBefore)
  } finally {
    if (!quitCompleted && nativeApp !== undefined) await quitAfterSmokeFailure(nativeApp)
    await providerTripwire.close()
  }
}
