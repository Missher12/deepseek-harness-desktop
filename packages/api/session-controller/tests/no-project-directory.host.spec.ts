/** Desktop Session cwd policy exercised through the production Session Controller. */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionHeader } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionTestController, testSessionPersistence } from './test-remote.ts'

const contexts: Context[] = []
const directories: string[] = []
const children: Array<{ child: ChildProcess; closed: Promise<unknown> }> = []
afterEach(async () => {
  try {
    await Promise.all(children.splice(0).map(async ({ child, closed }) => { child.kill(); await closed }))
    await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  }
  finally { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) }
})

function temporaryHome(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-no-project-')))
  directories.push(path)
  return path
}

async function harness(home = temporaryHome(), persisted = new Map<SessionId, SessionHeader>(), enabled = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const fallback = join(home, 'app-launch-directory')
  const project = join(home, 'project')
  const managed = join(home, 'deepseek-temp')
  mkdirSync(fallback, { recursive: true })
  const attached: SessionId[] = []
  const archived: SessionId[] = []
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === 'project' ? {
      id, path: project, attachSession: (sessionId: SessionId) => { attached.push(sessionId) },
    } : undefined,
    list: () => [],
    archivedSessionIds: archived,
    purgeSession: () => Promise.resolve(),
  } as never)
  const publish = async (session: Session, setup: Parameters<AgentFactory['createAgent']>[1]['setup']) => {
    const agent = { id: session.id, session, status: 'idle', ctx } as Agent
    await setup?.(ctx, agent)
    const unregister = ctx.agents.register(agent)
    return { agent, dispose: () => { unregister(); return Promise.resolve() } }
  }
  const factory: AgentFactory = {
    async createAgent(_owner, options) {
      const session = ctx.sessions.create(options.sessionId, options.meta === undefined ? {} : { meta: options.meta })
      persisted.set(session.id, session.header)
      return publish(session, options.setup)
    },
    async resume(_owner, options) {
      const meta = persisted.get(options.resumeSessionId)
      if (meta === undefined) throw new Error('missing fixture Session')
      return publish(ctx.sessions.create(meta.id, { meta }), options.setup)
    },
  }
  ctx.agents.setFactory(factory)
  const controller = createSessionTestController(ctx, {
    cwd: fallback,
    defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    ...(enabled ? { noProjectDirectory: managed } : {}),
  })
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: () => Promise.resolve([...persisted.values()]),
    inspect: (id: SessionId) => {
      const meta = persisted.get(id)
      return Promise.resolve(meta === undefined ? undefined : { meta, events: [] })
    },
    delete: (id: SessionId) => { persisted.delete(id); return Promise.resolve() },
  }) as never)
  return { ctx, controller, home, managed, fallback, project, attached, archived, persisted }
}

describe('no-project Session directories', () => {
  it('assigns separate durable working directories and routes relative process output into them', async ({ signal }) => {
    const b = await harness()
    const first = await b.controller.create({})
    const second = await b.controller.create({})
    expect(first.sessionId).not.toBe(second.sessionId)
    for (const { sessionId } of [first, second]) {
      const cwd = b.ctx.sessions.get(sessionId)?.header.cwd
      expect(cwd).toBe(join(b.managed, sessionId))
      const child = spawn(process.execPath, ['-e', "require('node:fs').writeFileSync('generated.txt', process.argv[1])", sessionId], {
        cwd, stdio: 'ignore', signal,
      })
      let processError: Error | undefined
      child.on('error', (error) => { processError ??= error })
      const closed = new Promise<unknown>((resolve) => {
        child.once('close', (code, childSignal) => { resolve({ code, signal: childSignal }) })
      })
      children.push({ child, closed })
      expect(await closed).toEqual({ code: 0, signal: null })
      expect(processError).toBeUndefined()
      expect(readFileSync(join(b.managed, sessionId, 'generated.txt'), 'utf8')).toBe(sessionId)
    }
    expect(existsSync(join(b.fallback, 'generated.txt'))).toBe(false)
    expect(b.attached).toEqual([])
  })

  it('retains the directory and files when the Session is adopted after restart', async () => {
    const first = await harness()
    const created = await first.controller.create({ sessionId: SessionId('kept-session') })
    const cwd = first.ctx.sessions.get(created.sessionId)?.header.cwd
    expect(cwd).toBe(join(first.managed, 'kept-session'))
    await first.controller.create({ sessionId: created.sessionId })
    writeFileSync(join(cwd!, 'kept.txt'), 'keep me')
    await first.ctx.fiber.dispose()
    const second = await harness(first.home, first.persisted)
    await second.controller.create({ sessionId: created.sessionId })
    expect(second.ctx.sessions.get(created.sessionId)?.header.cwd).toBe(cwd)
    expect(readFileSync(join(cwd!, 'kept.txt'), 'utf8')).toBe('keep me')
  })

  it('adopts legacy Sessions without moving their working directory', async () => {
    const first = await harness(undefined, undefined, false)
    const created = await first.controller.create({ sessionId: SessionId('legacy-session') })
    writeFileSync(join(first.fallback, 'old.txt'), 'old content')
    await first.ctx.fiber.dispose()
    const second = await harness(first.home, first.persisted)
    await second.controller.create({ sessionId: created.sessionId })
    expect(second.ctx.sessions.get(created.sessionId)?.header.cwd).toBe(first.fallback)
    expect(readFileSync(join(first.fallback, 'old.txt'), 'utf8')).toBe('old content')
    expect(existsSync(first.managed)).toBe(false)
  })

  it('preserves explicit project and cwd destinations without creating the managed root', async () => {
    const b = await harness()
    const project = await b.controller.create({ workspaceId: 'project' as WorkspaceId })
    const custom = join(b.home, 'custom')
    const explicit = await b.controller.create({ cwd: custom })
    expect(b.ctx.sessions.get(project.sessionId)?.header.cwd).toBe(b.project)
    expect(b.ctx.sessions.get(explicit.sessionId)?.header.cwd).toBe(custom)
    expect(b.attached).toEqual([project.sessionId])
    expect(existsSync(b.managed)).toBe(false)
  })

  it.each(['attached', 'persisted'])('refuses to replace a %s Session whose cwd is missing', async (location) => {
    const b = await harness()
    const sessionId = SessionId('missing-cwd')
    if (location === 'attached') b.ctx.sessions.create(sessionId)
    else b.persisted.set(sessionId, { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, isSeeded: false })
    await expect(b.controller.create({ sessionId })).rejects.toMatchObject({ code: 'session/conflict' })
    expect(existsSync(b.managed)).toBe(false)
  })

  it('coalesces concurrent creates and keeps generated files on Session deletion', async () => {
    const b = await harness()
    const sessionId = SessionId('concurrent-session')
    const results = await Promise.all([b.controller.create({ sessionId }), b.controller.create({ sessionId })])
    expect(results).toEqual([{ sessionId }, { sessionId }])
    const file = join(b.managed, sessionId, 'keep.txt')
    writeFileSync(file, 'independent of Session history')
    b.archived.push(sessionId)
    await b.controller.delete({ sessionId })
    expect(readFileSync(file, 'utf8')).toBe('independent of Session history')
    expect(b.persisted.has(sessionId)).toBe(false)
  })

  it.each(['../escaped', '..\\escaped', '/absolute', 'C:\\absolute', 'con', 'nul', 'lpt1', '', 'UPPER'])('rejects unsafe new directory identity %j before creating files', async (id) => {
    const b = await harness()
    await expect(b.controller.create({ sessionId: SessionId(id) })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(b.persisted.size).toBe(0)
    expect(existsSync(b.managed)).toBe(false)
  })

  it('rejects a Session directory junction without writing into its target', async () => {
    const b = await harness()
    const outside = join(b.home, 'outside')
    mkdirSync(outside)
    mkdirSync(b.managed)
    symlinkSync(outside, join(b.managed, 'linked-session'), 'junction')
    await expect(b.controller.create({ sessionId: SessionId('linked-session') })).rejects.toMatchObject({ code: 'gateway/internal' })
    expect(b.persisted.size).toBe(0)
    expect(existsSync(join(outside, 'generated.txt'))).toBe(false)
  })

  it('reports an unusable parent directory instead of falling back to the launch directory', async () => {
    const b = await harness()
    writeFileSync(b.managed, 'a file occupies the directory name')
    await expect(b.controller.create({ sessionId: SessionId('blocked-session') })).rejects.toMatchObject({ code: 'gateway/internal' })
    expect(b.persisted.size).toBe(0)
    expect(readFileSync(b.managed, 'utf8')).toBe('a file occupies the directory name')
  })

  it('does not create a replacement directory when stored identity cannot be read', async () => {
    const b = await harness()
    vi.spyOn(b.ctx.sessionQuery, 'observeSession').mockRejectedValueOnce(new Error('storage offline'))
    await expect(b.controller.create({ sessionId: SessionId('unreadable-session') }))
      .rejects.toMatchObject({ code: 'gateway/internal' })
    expect(b.persisted.size).toBe(0)
    expect(existsSync(b.managed)).toBe(false)
  })
})
