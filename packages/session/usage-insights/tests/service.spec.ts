import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import UsageInsightsGateway, { type Config } from '../src/index.ts'

interface StoredLog {
  header: SessionHeader
  inheritedEventCount: number
  events: SessionEvent[]
  revision: string
  error?: Error
  onInspect?: () => void
  waitForAbort?: boolean
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
      isSeeded: false,
    },
    inheritedEventCount: 0,
    events,
    revision,
  }
}

async function harness(
  initial: StoredLog[],
  pool = new MemoryMediaPool(),
  config: Config = { timeZone: 'UTC' },
  liveIds: ReadonlySet<string> = new Set(),
) {
  const logs = new Map(initial.map(log => [String(log.header.id), log]))
  const persistence = {
    listSnapshots: vi.fn(async (_signal?: AbortSignal) => [...logs.values()].map(log => ({
      header: structuredClone(log.header),
      revision: SessionPersistenceRevision(log.revision),
    }))),
    inspect: vi.fn(async (id: SessionId, signal?: AbortSignal) => {
      const log = logs.get(String(id))
      if (log === undefined) throw new Error(`missing ${id}`)
      if (log.error !== undefined) throw log.error
      if (log.waitForAbort === true) {
        await new Promise<never>((_resolve, reject) => {
          const abort = (): void => {
            reject(new Error('inspection aborted'))
          }
          if (signal?.aborted === true) abort()
          else signal?.addEventListener('abort', abort, { once: true })
        })
      }
      log.onInspect?.()
      return {
        meta: structuredClone(log.header),
        inheritedEventCount: log.inheritedEventCount,
        events: structuredClone(log.events),
      }
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
  ctx.provide('sessions', {
    get: (id: SessionId) => liveIds.has(String(id)) ? ({ id } as Session) : undefined,
  } as never)
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

  it('memoizes a live Session only in process memory and invalidates it on the next event', async () => {
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'))
    const active = stored('active', 'r1', [userEvent(0, '2026-08-17T12:00:00.000Z')])
    const liveIds = new Set(['active'])
    const { ctx, gateway, logs, persistence, pool } = await harness(
      [active],
      new MemoryMediaPool(),
      { timeZone: 'UTC' },
      liveIds,
    )

    await gateway.snapshot()
    await gateway.snapshot()

    expect(persistence.inspect).toHaveBeenCalledTimes(1)
    expect([...pool.media.get('usage_insights')?.tables.get('sessions')?.keys() ?? []]).toEqual([])

    active.events.push(userEvent(1, '2026-08-18T12:00:00.000Z'))
    ctx.emit('session/event', { id: active.header.id } as Session, active.events.at(-1) as SessionEvent)

    expect((await gateway.snapshot()).summary.currentStreakDays).toBe(2)
    await gateway.snapshot()
    expect(persistence.inspect).toHaveBeenCalledTimes(2)

    liveIds.delete('active')
    logs.delete('active')
    expect((await gateway.snapshot()).sessionCount).toBe(0)
  })

  it('drops process-local state when a live Session is disposed', async () => {
    const active = stored('disposed', 'r1', [userEvent(0, '2026-08-17T12:00:00.000Z')])
    const liveIds = new Set(['disposed'])
    const { ctx, gateway, persistence, pool } = await harness(
      [active],
      new MemoryMediaPool(),
      { timeZone: 'UTC' },
      liveIds,
    )

    await gateway.snapshot()
    liveIds.delete('disposed')
    ctx.emit('session/disposed', { id: active.header.id } as Session)
    await gateway.snapshot()

    expect(persistence.inspect).toHaveBeenCalledTimes(2)
    expect([...pool.media.get('usage_insights')?.tables.get('sessions')?.keys() ?? []]).toEqual(['disposed'])
  })

  it('keeps a Session that becomes live during inspection out of durable cache', async () => {
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'))
    const transitioning = stored('transitioning', 'r1', [userEvent(0, '2026-08-17T12:00:00.000Z')])
    const liveIds = new Set<string>()
    transitioning.onInspect = () => { liveIds.add('transitioning') }
    const { gateway, persistence, pool } = await harness(
      [transitioning],
      new MemoryMediaPool(),
      { timeZone: 'UTC' },
      liveIds,
    )

    await gateway.snapshot()
    await gateway.snapshot()

    expect(persistence.inspect).toHaveBeenCalledTimes(1)
    expect([...pool.media.get('usage_insights')?.tables.get('sessions')?.keys() ?? []]).toEqual([])
  })

  it('does not cache an inspection raced by a newer Session event', async () => {
    const racing = stored('racing', 'r1', [userEvent(0, '2026-08-17T12:00:00.000Z')])
    const fixture = await harness([racing])
    racing.onInspect = () => {
      delete racing.onInspect
      fixture.ctx.emit('session/event', { id: racing.header.id } as Session, racing.events[0] as SessionEvent)
    }

    await fixture.gateway.snapshot()
    expect([...fixture.pool.media.get('usage_insights')?.tables.get('sessions')?.keys() ?? []]).toEqual([])

    await fixture.gateway.snapshot()
    expect(fixture.persistence.inspect).toHaveBeenCalledTimes(2)
    expect([...fixture.pool.media.get('usage_insights')?.tables.get('sessions')?.keys() ?? []]).toEqual(['racing'])
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

  it('aborts a stuck session inspection and clears the refresh for retry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'))
    const good = stored('good', 'r1', [userEvent(0, '2026-08-17T12:00:00.000Z')])
    const stuck = stored('stuck', 'r1', [])
    stuck.waitForAbort = true
    const { gateway, persistence } = await harness(
      [good, stuck],
      new MemoryMediaPool(),
      { timeZone: 'UTC', refreshTimeoutMs: 25 },
    )

    const first = gateway.snapshot()
    await vi.advanceTimersByTimeAsync(25)
    await expect(first).resolves.toMatchObject({ sessionCount: 1, omittedSessions: 1 })
    expect(persistence.listSnapshots.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal)
    expect(persistence.inspect.mock.calls.find(call => String(call[0]) === 'stuck')?.[1]).toBeInstanceOf(AbortSignal)

    stuck.waitForAbort = false
    await expect(gateway.snapshot()).resolves.toMatchObject({ sessionCount: 2, omittedSessions: 0 })
    expect(persistence.listSnapshots).toHaveBeenCalledTimes(2)
  })

  it.each([9, 10.5, 60_001])('rejects an unsafe refresh timeout of %s milliseconds', async (refreshTimeoutMs) => {
    await expect(harness([], new MemoryMediaPool(), { timeZone: 'UTC', refreshTimeoutMs }))
      .rejects.toThrow('usage insights: refreshTimeoutMs is out of range')
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
