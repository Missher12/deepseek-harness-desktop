/**
 * Desktop upgrade fixtures pinned before the official alpha.5 core import.
 * The current rc.2 cache cannot satisfy these expectations: the tests become
 * GREEN only when the alpha.5 per-record compatibility path is present.
 */

import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition, ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SessionProjectionCache, { projectionCacheDomainSpec } from '../src/index.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    title: string | null
  }
  interface SessionProjectionMap {
    title: string | null
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'desktop-upgrade/set-title': { title: string }
  }

  interface OutOfBandSessionEventMap {
    'desktop-upgrade/set-title': true
  }
}

const titleUnit = {
  key: 'title',
  stateSchema: z.string().nullable(),
  init: () => null,
  apply: (state, event) => event.type === 'desktop-upgrade/set-title' ? event.data.title : state,
  wire: {
    viewSchema: z.string().nullable(),
    view: state => state,
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'title', string | null>

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

interface FixtureRecord {
  identity: { createdAt: number; cwd?: string }
  rows: Record<string, { ver: number; seq: number; val: unknown }>
}

interface FixtureDoc {
  version: number
  record: FixtureRecord
}

interface WholeUnitFixture {
  unit: { name: string; version: number }
  tables: { sessions: Record<string, FixtureRecord> }
}

const contexts: Context[] = []
const roots: string[] = []

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-projcache-upgrade-'))
  roots.push(root)
  return root
}

async function fixtureJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf8')) as T
}

async function harness(root: string): Promise<{ ctx: Context; cache: SessionProjectionCache }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(
    { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
    { root },
  )
  await ctx.plugin(
    { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
    { backend: 'json' },
  )
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(titleUnit)
  ctx.provide('sessionPersistence', {
    readFrom: async () => { throw new Error('Desktop upgrade fixture has no replay tail') },
  } as never)
  await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 100, writeIntervalMs: 60_000 })
  return { ctx, cache: ctx.sessionProjectionCache }
}

function headerFor(id: SessionId, identity: FixtureRecord['identity']): SessionHeader {
  return {
    version: 0,
    id,
    createdAt: identity.createdAt,
    isSeeded: false,
    ...identity.cwd === undefined ? {} : { cwd: identity.cwd },
  } as SessionHeader
}

/** Invoke both the rc.2 one-argument and alpha.5 three-argument read faces. */
function cachedTitle(cache: SessionProjectionCache, header: SessionHeader): unknown {
  const read = cache.cachedSnapshot.bind(cache) as unknown as (
    meta: SessionHeader,
    inheritedEventCount: number,
    keys: readonly string[],
  ) => ProjectionSnapshot | undefined
  return read(header, 0, ['title'])?.values.title
}

async function stageSourceLog(
  root: string,
  id: SessionId,
  identity: FixtureRecord['identity'],
): Promise<{ path: string; bytes: Buffer; sha256: string }> {
  const path = join(root, 'sessions', 'desktop-upgrade', id, 'session.jsonl')
  const bytes = Buffer.from(`${JSON.stringify({
    type: 'session',
    version: 0,
    id,
    createdAt: identity.createdAt,
    ...identity.cwd === undefined ? {} : { cwd: identity.cwd },
    delegationDepth: 0,
  })}\n`, 'utf8')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  return { path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

async function expectSourceUnchanged(source: { path: string; bytes: Buffer; sha256: string }): Promise<void> {
  const after = await readFile(source.path)
  expect(after).toEqual(source.bytes)
  expect(createHash('sha256').update(after).digest('hex')).toBe(source.sha256)
}

async function expectCurrentRewrite(
  ctx: Context,
  root: string,
  id: SessionId,
  title: string,
): Promise<void> {
  const session = ctx.sessions.create(id)
  session.append('desktop-upgrade/set-title', { title })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const path = join(root, projectionCacheDomainSpec.name, 'sessions', `${id}.json`)
  await vi.waitFor(async () => {
    const doc = JSON.parse(await readFile(path, 'utf8')) as FixtureDoc
    expect(doc.version).toBe(projectionCacheDomainSpec.version)
    expect(doc.record.rows.title?.val).toBe(title)
  }, { timeout: 5_000 })
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  })))
})

describe('Desktop rc.2 and alpha.3 projection-cache upgrades', () => {
  it('migrates the rc.2 whole-unit cache without changing the source Session log', async () => {
    const root = await freshRoot()
    const fixture = await fixtureJson<WholeUnitFixture>('desktop-rc2-title-cache.json')
    const [rawId, record] = Object.entries(fixture.tables.sessions)[0]!
    const id = SessionId(rawId)
    const source = await stageSourceLog(root, id, record.identity)
    await cp(
      join(FIXTURES, 'desktop-rc2-title-cache.json'),
      join(root, `${projectionCacheDomainSpec.name}.json`),
    )

    const { cache } = await harness(root)

    expect(cachedTitle(cache, headerFor(id, record.identity))).toBe('验收标题-rc2')
    const migrated = JSON.parse(await readFile(
      join(root, projectionCacheDomainSpec.name, 'sessions', `${id}.json`),
      'utf8',
    )) as FixtureDoc
    expect(migrated.version).toBe(projectionCacheDomainSpec.version)
    await expectSourceUnchanged(source)
  })

  it('serves and rewrites the alpha.3 per-record cache without changing the source Session log', async () => {
    const root = await freshRoot()
    const id = SessionId('desktop-alpha3-upgrade')
    const fixture = await fixtureJson<FixtureDoc>('desktop-alpha3-title-cache.json')
    const source = await stageSourceLog(root, id, fixture.record.identity)
    const stored = join(root, projectionCacheDomainSpec.name, 'sessions', `${id}.json`)
    await mkdir(dirname(stored), { recursive: true })
    await cp(join(FIXTURES, 'desktop-alpha3-title-cache.json'), stored)

    const { ctx, cache } = await harness(root)

    expect(cachedTitle(cache, headerFor(id, fixture.record.identity))).toBe('验收标题-alpha3')
    await expectCurrentRewrite(ctx, root, id, 'Desktop upgraded title')
    await expectSourceUnchanged(source)
  })

  it('backs up an invalid derived record, then rebuilds it without changing the source Session log', async () => {
    const root = await freshRoot()
    const id = SessionId('desktop-invalid-upgrade')
    const identity = { createdAt: 1_788_286_999_000, cwd: '/tmp' }
    const source = await stageSourceLog(root, id, identity)
    const sessionsDir = join(root, projectionCacheDomainSpec.name, 'sessions')
    const invalidPath = join(sessionsDir, `${id}.json`)
    const invalidBytes = Buffer.from(`${JSON.stringify({
      version: 5,
      record: { identity: { createdAt: 'not-a-number' }, rows: 'not-an-object' },
    })}\n`, 'utf8')
    await mkdir(sessionsDir, { recursive: true })
    await writeFile(invalidPath, invalidBytes)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Storage)
    await ctx.plugin(
      { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
      { root },
    )
    await ctx.plugin(
      { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
      { backend: 'json' },
    )
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(titleUnit)
    ctx.provide('sessionPersistence', {
      readFrom: async () => { throw new Error('Desktop upgrade fixture has no replay tail') },
    } as never)
    const error = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 100, writeIntervalMs: 60_000 })

    const entries = await readdir(sessionsDir)
    expect(entries).not.toContain(`${id}.json`)
    const backup = entries.find(name => new RegExp(`^${id}\\.json\\.bak\\.\\d{12}$`, 'u').test(name))
    expect(backup).toBeDefined()
    expect(await readFile(join(sessionsDir, backup!))).toEqual(invalidBytes)
    expect(error).toHaveBeenCalledWith(expect.stringContaining(`record '${id}'`))

    await expectCurrentRewrite(ctx, root, id, 'Rebuilt after invalid cache')
    await expectSourceUnchanged(source)
  })
})
