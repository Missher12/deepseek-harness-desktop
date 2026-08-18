import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import UsageInsightsGateway from '../src/index.ts'

interface StoredLog {
  header: SessionHeader
  events: SessionEvent[]
  revision: string
  error?: Error
}

const contexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const userEvent = (seq: number, date: string): SessionEvent => ({
  seq,
  time: Date.parse(date),
  type: 'user/message',
  data: {
    id: `user-${seq}`,
    role: 'user',
    source: { kind: 'user' },
    content: [],
  },
} as SessionEvent)

function stored(id: string, revision: string, events: SessionEvent[]): StoredLog {
  return {
    header: {
      version: 0,
      id: id as SessionId,
      createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    events,
    revision,
  }
}

async function harness(
  initial: StoredLog[],
  pool = new MemoryMediaPool(),
  config: { timeZone?: string } = { timeZone: 'UTC' },
) {
  const logs = new Map(initial.map(log => [String(log.header.id), log]))
  const persistence = {
    listSnapshots: vi.fn(async () => [...logs.values()].map(log => ({
      header: structuredClone(log.header),
      revision: SessionPersistenceRevision(log.revision),
    }))),
    inspect: vi.fn(async (id: SessionId) => {
      const log = logs.get(String(id))
      if (log === undefined) throw new Error(`missing ${id}`)
      if (log.error !== undefined) throw log.error
      return { meta: structuredClone(log.header), events: structuredClone(log.events) }
    }),
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionPersistence', persistence as never)
  await ctx.plugin(UsageInsightsGateway, config)
  const gateway = ctx.get('usageInsights') as UsageInsightsGateway
  return { ctx, gateway, logs, persistence, pool }
}

describe('UsageInsightsGateway', () => {
  it('shares refresh work and reuses unchanged durable revisions', async () => {
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'))
    const { gateway, persistence } = await harness([
      stored('one', 'r1', [userEvent(0, '2026-08-17T12:00:00.000Z')]),
    ])

    const [first, joined] = await Promise.all([gateway.snapshot(), gateway.snapshot()])

    expect(first).toEqual(joined)
    expect(persistence.listSnapshots).toHaveBeenCalledTimes(1)
    expect(persistence.inspect).toHaveBeenCalledTimes(1)

    await gateway.snapshot()
    expect(persistence.listSnapshots).toHaveBeenCalledTimes(2)
    expect(persistence.inspect).toHaveBeenCalledTimes(1)
  })

  it('rebuilds changed rows and removes cache rows for deleted sessions', async () => {
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'))
    const { gateway, logs, persistence, pool } = await harness([
      stored('one', 'r1', [userEvent(0, '2026-08-16T12:00:00.000Z')]),
      stored('two', 'r1', [userEvent(0, '2026-08-17T12:00:00.000Z')]),
    ])
    await gateway.snapshot()

    const changed = logs.get('one')
    if (changed === undefined) throw new Error('missing fixture')
    changed.revision = 'r2'
    changed.events.push(userEvent(1, '2026-08-17T12:00:00.000Z'))
    logs.delete('two')

    const snapshot = await gateway.snapshot()

    expect(snapshot.sessionCount).toBe(1)
    expect(snapshot.summary.currentStreakDays).toBe(2)
    expect(persistence.inspect).toHaveBeenCalledTimes(3)
    const storedRows = pool.media.get('usage_insights')?.tables.get('sessions')
    expect([...storedRows?.keys() ?? []]).toEqual(['one'])
  })

  it('omits a failed session while keeping successful history available', async () => {
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'))
    const good = stored('good', 'r1', [userEvent(0, '2026-08-17T12:00:00.000Z')])
    const bad = stored('bad', 'r1', [])
    bad.error = new Error('corrupt fixture')
    const { gateway } = await harness([good, bad])

    const snapshot = await gateway.snapshot()

    expect(snapshot.sessionCount).toBe(1)
    expect(snapshot.omittedSessions).toBe(1)
    expect(snapshot.summary.currentStreakDays).toBe(1)
  })

  it('discards a malformed cached row and rebuilds it from the log', async () => {
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'))
    const pool = new MemoryMediaPool()
    pool.versions.set('usage_insights', 1)
    pool.media.set('usage_insights', {
      global: null,
      tables: new Map([['sessions', new Map([['one', { secretPrompt: 'must-not-survive' }]])]]),
    })
    const { gateway, persistence } = await harness([
      stored('one', 'r1', [userEvent(0, '2026-08-17T12:00:00.000Z')]),
    ], pool)

    const snapshot = await gateway.snapshot()

    expect(snapshot.sessionCount).toBe(1)
    expect(persistence.inspect).toHaveBeenCalledTimes(1)
    const rebuilt = pool.media.get('usage_insights')?.tables.get('sessions')?.get('one')
    expect(rebuilt).not.toHaveProperty('secretPrompt')
  })

  it('uses the system zone by default and clears a rejected refresh for retry', async () => {
    const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const { gateway } = await harness([], new MemoryMediaPool(), {})
    expect((await gateway.snapshot()).timeZone).toBe(systemZone)

    const invalid = await harness([], new MemoryMediaPool(), { timeZone: 'Not/A-Time-Zone' })
    await expect(invalid.gateway.snapshot()).rejects.toThrow()
    await expect(invalid.gateway.snapshot()).rejects.toThrow()
    expect(invalid.persistence.listSnapshots).not.toHaveBeenCalled()
  })

  it('keeps snapshots available when cache writes and stale deletes fail', async () => {
    const firstLog = stored('one', 'r1', [userEvent(0, '2026-08-17T12:00:00.000Z')])
    const fixture = await harness([firstLog])
    const table = (fixture.gateway as unknown as {
      table: { put: (id: SessionId, value: unknown) => Promise<void>; delete: (id: SessionId) => Promise<void> }
    }).table
    const put = vi.spyOn(table, 'put').mockRejectedValueOnce(new Error('cache unavailable'))

    expect((await fixture.gateway.snapshot()).sessionCount).toBe(1)
    expect(put).toHaveBeenCalled()

    put.mockRestore()
    await fixture.gateway.snapshot()
    fixture.logs.delete('one')
    const remove = vi.spyOn(table, 'delete').mockRejectedValueOnce(new Error('delete unavailable'))

    expect((await fixture.gateway.snapshot()).sessionCount).toBe(0)
    expect(remove).toHaveBeenCalledWith('one')
  })
})
