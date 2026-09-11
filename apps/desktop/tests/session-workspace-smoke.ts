/** Native Session directories and V2 migration through the shipped UI and real write tool. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { generationLogPath } from '@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts'
import { compressZstdFrame } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import type { Page } from 'playwright'
import { expect } from 'vitest'
import { TITLE_FRAME_PREFIX, TITLE_SYSTEM } from './reader-smoke-provider.ts'

type CaseName = 'first' | 'second' | 'continued' | 'project' | 'legacy'
interface WriteCase {
  prompt: string
  title: string
  done: string
  filename: string
  content: string
  callId: string
  stage: 0 | 1 | 2
  titled: boolean
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function textContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  return value.map(part => record(part)?.text).filter((part): part is string => typeof part === 'string').join('')
}

function stream(delta: Record<string, unknown>, finish: string): string {
  return [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 3, completion_tokens: 2 } })}`,
    'data: [DONE]', '',
  ].join('\n\n')
}

/** Five explicitly armed fixture turns; each must execute the actual write tool once. */
export class NativeSessionWrites {
  private readonly cases = new Map<CaseName, WriteCase>()
  private active: WriteCase | undefined

  /** Arm one unique scenario before the renderer submits its prompt. */
  arm(name: CaseName): WriteCase {
    if (this.cases.has(name) || (this.active !== undefined && this.active.stage !== 2)) {
      throw new Error('native Session write scenario overlaps or repeats')
    }
    const value: WriteCase = {
      prompt: `Verify native Session directory ${name}.`, title: `Native directory ${name}`,
      done: `NATIVE_DIRECTORY_OK_${name}`, filename: name === 'continued' ? 'continued-output.txt' : 'native-session-output.txt',
      content: `Native owned output: ${name}\n`, callId: `native_directory_${name}`, stage: 0, titled: false,
    }
    this.cases.set(name, value)
    this.active = value
    return value
  }

  /** Answer only the armed write/continuation or an exact title request for an owned prompt. */
  respond(body: unknown): string | undefined {
    const request = record(body)
    if (request?.model !== 'native-thinker' || request.stream !== true || !Array.isArray(request.messages)) return undefined
    const messages = request.messages.map(record)
    const [system, user] = messages
    if (messages.length === 2 && (system?.role === 'system' || system?.role === 'developer')
      && textContent(system.content) === TITLE_SYSTEM && user?.role === 'user'
      && request.tools === undefined && (request.max_tokens === 64 || request.max_completion_tokens === 64)) {
      const text = textContent(user.content)
      if (!text?.startsWith(TITLE_FRAME_PREFIX)) return undefined
      let frame: unknown
      try { frame = JSON.parse(text.slice(TITLE_FRAME_PREFIX.length)) } catch { return undefined }
      if (!Array.isArray(frame) || frame.length !== 1) return undefined
      const item = record(frame[0])
      const owned = [...this.cases.values()].find(value => value.prompt === item?.text)
      if (owned === undefined || owned.titled || !Number.isSafeInteger(item?.seq)) return undefined
      owned.titled = true
      return stream({ content: owned.title }, 'stop')
    }
    const owned = this.active
    if (owned === undefined || !messages.some(message => message?.role === 'user' && textContent(message.content) === owned.prompt)) return undefined
    if (owned.stage === 0) {
      if (!Array.isArray(request.tools) || !request.tools.some(tool => record(record(tool)?.function)?.name === 'write')) return undefined
      owned.stage = 1
      return stream({ tool_calls: [{ index: 0, id: owned.callId, type: 'function', function: {
        name: 'write', arguments: JSON.stringify({ file_path: owned.filename, content: owned.content }),
      } }] }, 'tool_calls')
    }
    if (owned.stage !== 1 || !messages.some(message => message?.role === 'tool' && message.tool_call_id === owned.callId)) return undefined
    owned.stage = 2
    return stream({ content: owned.done }, 'stop')
  }

  /** Assert that every intended native operation reached its second model step. */
  assertComplete(): void {
    expect([...this.cases.keys()]).toEqual(['first', 'second', 'continued', 'project', 'legacy'])
    expect([...this.cases.values()].map(value => value.stage)).toEqual([2, 2, 2, 2, 2])
  }
}

/** Historical bytes copied into the isolated application's own Session store. */
export interface LegacySessionSeed {
  id: SessionId
  title: string
  cwd: string
  path: string
  bytes: Buffer
  output: string
  outputBytes: string
  sourceSha256: string
}

/** Copy and materialize a committed V2 fixture without opening a current-writer persistence handle. */
export async function seedLegacySessionWorkspace(harnessHome: string, persistenceRoot: string): Promise<LegacySessionSeed> {
  const source = await readFile(resolve(import.meta.dirname, '../../../snapshots/web/feedback-command/session.v2.jsonl'), 'utf8')
  const cwd = join(harnessHome, 'desktop-smoke-legacy-workspace')
  const id = SessionId('desktop-smoke-legacy-v2')
  const title = 'desktop-smoke-legacy-v2'
  await mkdir(cwd, { recursive: true })
  const canonicalCwd = await realpath(cwd)
  const ids = new Map<string, string>()
  const materialize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(materialize)
    if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item)]))
    if (typeof value !== 'string') return value
    if (value === '{{tools}}') return []
    return value.replaceAll('{{cwd}}/workspace', canonicalCwd).replaceAll('{{cwd}}', canonicalCwd)
      .replaceAll('{{session:1}}', id).replaceAll('{{system}}', 'Native migration fixture context.')
      .replace(/\{\{(?:message|rpc|command|approval|id):\d+\}\}/g, (token) => {
        if (!ids.has(token)) ids.set(token, randomUUID())
        return ids.get(token)!
      })
  }
  const rows = source.trim().split('\n').map(line => record(materialize(JSON.parse(line))))
  const header = rows[0]
  if (header?.type !== 'session' || header.version !== 2 || typeof header.createdAt !== 'number') throw new Error('native migration fixture is not V2')
  header.cwd = canonicalCwd
  for (const [index, row] of rows.entries()) {
    if (row === undefined) throw new Error('native V2 fixture contains a non-object row')
    if (index === 0) continue
    row.seq = index - 1
    row.time = header.createdAt + index * 10_000
    if (row.type === 'session/title') {
      const data = record(row.data)
      if (data === undefined) throw new Error('native V2 title has no data')
      data.title = title
    }
  }
  const path = generationLogPath(persistenceRoot, canonicalCwd, id, 2, 'zstd')
  const bytes = Buffer.concat([
    await compressZstdFrame(`${JSON.stringify(header)}\n`),
    await compressZstdFrame(`${rows.slice(1).map(row => JSON.stringify(row)).join('\n')}\n`),
  ])
  const output = join(canonicalCwd, 'legacy-output.txt')
  const outputBytes = 'Existing V2 output must remain unchanged.\n'
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
  await writeFile(output, outputBytes, { flag: 'wx', mode: 0o600 })
  return { id, title, cwd: canonicalCwd, path, bytes, output, outputBytes, sourceSha256: createHash('sha256').update(source).digest('hex') }
}

/** Both native Electron and Chromium use these exact controls and disk assertions. */
export interface NativeSessionWorkspaceOptions {
  persistenceRoot: string
  noProjectRoot: string
  projectTitle: string
  projectCwd: string
  legacy: LegacySessionSeed
  writes: NativeSessionWrites
  evidencePath: string
  selectSession(title: string, id: SessionId): Promise<void>
}

/** Execute five real write-tool turns and verify default directories, reopening and copied V2 migration. */
export async function exerciseNativeSessionWorkspaces(page: Page, options: NativeSessionWorkspaceOptions): Promise<void> {
  const observer = new Context()
  const legacy = options.legacy
  try {
    const collapsed = page.locator('[data-sidebar-collapsed="true"]')
    if (await collapsed.count() > 0) {
      await page.getByRole('button', { name: /^(?:Open sidebar|打开侧边栏)$/u }).click()
      await collapsed.waitFor({ state: 'detached' })
    }
    await observer.plugin(SessionStore)
    await observer.plugin(JsonlSessionPersistence, { root: options.persistenceRoot })
    const selectModel = async () => {
      const trigger = page.getByRole('button', { name: /^(?:Select model|选择模型)/u }).first()
      if ((await trigger.getAttribute('aria-label'))?.includes('Native Smoke Thinker')) return
      await trigger.click()
      const picker = page.getByRole('dialog', { name: /^(?:Model and reasoning effort|模型与推理等级)$/u })
      const option = picker.locator('section[aria-label="Desktop Smoke"]').getByRole('button', { name: 'Native Smoke Thinker', exact: true })
      if (await option.getAttribute('aria-pressed') === 'true') await page.keyboard.press('Escape')
      else await option.click()
      await picker.waitFor({ state: 'detached' })
      expect(await trigger.getAttribute('aria-label')).toContain('Native Smoke Thinker')
    }
    const run = async (name: CaseName): Promise<{ header: SessionHeader; events: readonly SessionEvent[]; fixture: WriteCase }> => {
      await selectModel()
      const fixture = options.writes.arm(name)
      const input = page.locator('[data-composer-input][contenteditable="true"]').first()
      await input.click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type(fixture.prompt)
      await input.press('Enter')
      await page.getByText(fixture.done, { exact: true }).waitFor({ timeout: 30_000 })
      let found: { header: SessionHeader; events: readonly SessionEvent[] } | undefined
      await expect.poll(async () => {
        for (const item of await observer.sessionPersistence.list()) {
          // A source-plane observer must not perform the product's historical migration.
          if (item.header.id === legacy.id && name !== 'legacy') continue
          const handle = await observer.sessionPersistence.open(item.header.id, 'read')
          try {
            const { events } = await handle.read()
            const prompt = events.find(event => event.type === 'user/message'
              && event.data.content.some(block => block.type === 'text' && block.text === fixture.prompt))
            if (prompt !== undefined && events.some(event => event.type === 'turn/end' && event.seq > prompt.seq)) {
              found = { header: handle.header, events }
              return true
            }
          } finally { await handle.close() }
        }
        return false
      }, { timeout: 15_000 }).toBe(true)
      if (found === undefined || found.header.cwd === undefined) throw new Error('native write has no durable Session cwd')
      expect(found.events.some(event => event.type === 'tool/call' && event.data.name === 'write'
        && record(JSON.parse(event.data.arguments))?.file_path === fixture.filename)).toBe(true)
      expect(await readFile(join(found.header.cwd, fixture.filename), 'utf8')).toBe(fixture.content)
      return { ...found, fixture }
    }
    const noProject = async () => {
      await page.locator('[data-dsh-desktop-command="new-session"]').click()
      await page.getByRole('button', { name: /^(?:Choose workspace|选择工作区)$/u }).click()
      await page.getByRole('menuitem', { name: /^(?:No project|不在项目中)$/u }).click()
      await expect.poll(async () => {
        const id = await page.locator('[data-conversation-scroll]').getAttribute('data-session-id')
        if (id === null) return false
        try { return (await lstat(join(options.noProjectRoot, id))).isDirectory() } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
          throw error
        }
      }, { timeout: 15_000 }).toBe(true)
      await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
    }
    await noProject()
    const first = await run('first')
    expect(first.header.cwd).toBe(join(options.noProjectRoot, first.header.id))
    const selectedRow = page.locator('[class*="sessionRow"][aria-selected="true"]')
    if (!await selectedRow.isVisible()) {
      const group = page.locator('[class*="projectRow"]').filter({ hasText: /^(?:Ungrouped|未分组)$/u }).first()
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    }
    await selectedRow.hover()
    await selectedRow.getByRole('button', { name: /(?:Session actions for|的操作)/u }).click()
    await page.getByRole('menuitem', { name: /^(?:Rename|重命名)$/u }).click()
    const rename = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: /^(?:Session name|会话名称)$/u }) })
    const title = rename.getByRole('textbox')
    await title.fill(first.fixture.title)
    await title.press('Enter')
    await rename.waitFor({ state: 'detached' })
    await noProject()
    const second = await run('second')
    expect(second.header.id).not.toBe(first.header.id)
    expect(second.header.cwd).toBe(join(options.noProjectRoot, second.header.id))
    await page.reload({ waitUntil: 'load' })
    await options.selectSession(first.fixture.title, first.header.id)
    const continued = await run('continued')
    expect(continued.header.id).toBe(first.header.id)
    expect(continued.header.cwd).toBe(first.header.cwd)
    expect(await readFile(join(first.header.cwd!, first.fixture.filename), 'utf8')).toBe(first.fixture.content)
    expect(await readFile(join(second.header.cwd!, second.fixture.filename), 'utf8')).toBe(second.fixture.content)
    const projectRow = page.locator('[class*="projectRow"]').filter({ has: page.getByText(options.projectTitle, { exact: true }) }).first()
    await projectRow.hover()
    await projectRow.getByRole('button', { name: new RegExp(
      `^(?:New session in ${options.projectTitle}|在“${options.projectTitle}”中新建会话)$`, 'u',
    ) }).click()
    await expect.poll(() => page.locator('[data-conversation-scroll]').getAttribute('data-session-id'))
      .not.toBe(first.header.id)
    const project = await run('project')
    expect(await realpath(project.header.cwd!)).toBe(await realpath(options.projectCwd))
    const legacyGroup = page.locator('[class*="projectRow"]').filter({ hasText: /^(?:Ungrouped|未分组)$/u }).first()
    if (await legacyGroup.getAttribute('aria-expanded') !== 'true') await legacyGroup.click()
    const legacyLabel = await page.locator('[class*="sessionRow"]').filter({ has: page.getByText(legacy.title, { exact: true }) }).count() > 0
      ? legacy.title : basename(legacy.cwd)
    await options.selectSession(legacyLabel, legacy.id)
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()
    await expect.poll(() => readdir(dirname(legacy.path)), { timeout: 15_000 }).toContain('session.v3.jsonl.zstd')
    expect(await readFile(legacy.path)).toEqual(legacy.bytes)
    const migrated = await run('legacy')
    expect(migrated.header.id).toBe(legacy.id)
    expect(migrated.header.version).toBe(3)
    expect(migrated.header.cwd).toBe(legacy.cwd)
    expect(await readFile(legacy.path)).toEqual(legacy.bytes)
    expect(await readFile(legacy.output, 'utf8')).toBe(legacy.outputBytes)
    await page.reload({ waitUntil: 'load' })
    await options.selectSession(legacy.title, legacy.id)
    await page.getByText(migrated.fixture.done, { exact: true }).waitFor()
    options.writes.assertComplete()
    await mkdir(dirname(options.evidencePath), { recursive: true })
    await writeFile(options.evidencePath, `${JSON.stringify({
      schemaVersion: 1,
      noProjectSessions: [first.header, second.header].map(header => ({ id: header.id, folderName: basename(header.cwd!) })),
      independentDirectories: true,
      continuedSession: continued.header.id,
      sameDirectoryOnReopen: true,
      outputsPreserved: true,
      explicitProjectPreserved: true,
      legacy: { id: legacy.id, fromVersion: 2, version: migrated.header.version,
        originalBytesPreserved: true, outputPreserved: true, reopened: true,
        originalSha256: createHash('sha256').update(legacy.bytes).digest('hex'), sourceSha256: legacy.sourceSha256 },
      completedWriteTurns: 5,
    }, null, 2)}\n`)
  } finally { await observer.fiber.dispose() }
}
