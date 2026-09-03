/** Rebuildable all-history usage index and read-only Settings Remote. */

import { Context, Service } from '@deepseek-ai/cordis'
import zc from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { aggregateUsageRows } from './aggregate.ts'
import { foldSessionUsage } from './fold.ts'
import { usageInsightsDomainSpec } from './spec.ts'
import type { SessionUsageRow, UsageInsightsSnapshot } from './types.ts'

export { aggregateUsageRows } from './aggregate.ts'
export { foldSessionUsage } from './fold.ts'
export { usageInsightsDomainSpec } from './spec.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageInsights: UsageInsightsGateway
  }
}

/** Optional deterministic date-zone override; production follows the system zone. */
export interface Config {
  /** IANA zone used for calendar aggregation; defaults to the system zone. */
  timeZone?: string
  /** Total refresh budget before pending Session inspections are cancelled. */
  refreshTimeoutMs?: number
}

/** Validate the optional IANA time-zone override. */
export const Config: zc<Config> = zc.object({
  timeZone: zc.string(),
  refreshTimeoutMs: zc.number(),
})

const DEFAULT_REFRESH_TIMEOUT_MS = 12_000
const MIN_REFRESH_TIMEOUT_MS = 10
const MAX_REFRESH_TIMEOUT_MS = 60_000

const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const countRecordSchema = z.record(z.string(), countSchema)
const daySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  humanMessages: countSchema,
  tokens: countSchema,
  toolCalls: countSchema,
}).strict()
const tokenSchema = z.object({
  uncachedInput: countSchema,
  output: countSchema,
  cacheRead: countSchema,
  cacheWrite: countSchema,
}).strict()
const rowSchema: z.ZodType<SessionUsageRow> = z.object({
  sessionId: z.string(),
  createdAt: countSchema,
  timeZone: z.string(),
  lastSeq: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
  tokens: tokenSchema,
  totalTokens: countSchema,
  validUsageSamples: countSchema,
  incompleteUsageSamples: countSchema,
  completedTurnDurationMs: countSchema,
  completedTurnCount: countSchema,
  daily: z.array(daySchema),
  models: countRecordSchema,
  reasoningEfforts: countRecordSchema,
  skills: countRecordSchema,
  tools: countRecordSchema,
}).strict()

const cacheRecordSchema = z.object({
  schemaVersion: z.literal(2),
  revision: z.string(),
  createdAt: countSchema,
  timeZone: z.string(),
  row: rowSchema,
}).strict()

type CacheRecord = z.infer<typeof cacheRecordSchema>

interface RefreshResult {
  row?: SessionUsageRow
  cache?: CacheRecord
}

interface LiveCacheRecord {
  record: CacheRecord
  generation: number
}

/** Remote-only service exposing an immutable bounded usage snapshot. */
export class UsageInsightsGateway extends TypertRemoteService {
  static inject = ['storageDomain', 'sessionPersistence']
  static Config = Config

  private table?: KvTable<SessionId, unknown>
  private refreshInFlight: Promise<UsageInsightsSnapshot> | undefined
  private readonly dirty = new Set<string>()
  private readonly eventGeneration = new Map<string, number>()
  private readonly liveRows = new Map<string, LiveCacheRecord>()
  private readonly refreshTimeoutMs: number

  constructor(ctx: Context, public config: Config = {}) {
    super(ctx, 'usageInsights')
    const refreshTimeoutMs = config.refreshTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS
    if (!Number.isInteger(refreshTimeoutMs)
      || refreshTimeoutMs < MIN_REFRESH_TIMEOUT_MS
      || refreshTimeoutMs > MAX_REFRESH_TIMEOUT_MS) {
      throw new TypeError('usage insights: refreshTimeoutMs is out of range')
    }
    this.refreshTimeoutMs = refreshTimeoutMs
    ctx.on('session/event', (session: Session) => {
      const id = String(session.id)
      this.dirty.add(id)
      this.eventGeneration.set(id, (this.eventGeneration.get(id) ?? 0) + 1)
      this.liveRows.delete(id)
    })
    ctx.on('session/disposed', (session: Session) => {
      // Its next durable revision differs from any old cache record; allowing
      // normal revision comparison avoids pinning every retired id dirty.
      const id = String(session.id)
      this.dirty.delete(id)
      this.eventGeneration.delete(id)
      this.liveRows.delete(id)
    })
  }

  /** Open the cache domain for the lifetime of this service. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(usageInsightsDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'usageInsights.domainClose')
    this.table = domain.table('sessions')
  }

  /**
   * Read one current all-history snapshot, sharing concurrent refresh work.
   * @returns The locally derived usage snapshot after any required cache refresh.
   */
  @Remote('snapshot')
  snapshot(): Promise<UsageInsightsSnapshot> {
    if (this.refreshInFlight !== undefined) return this.refreshInFlight
    const refresh = this.refresh()
    this.refreshInFlight = refresh
    const clearRefresh = (): void => { this.refreshInFlight = undefined }
    void refresh.then(clearRefresh, clearRefresh)
    return refresh
  }

  /** Revision-aware rebuild followed by bounded pure aggregation. */
  private async refresh(): Promise<UsageInsightsSnapshot> {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort(new Error('usage insights: refresh deadline exceeded'))
    }, this.refreshTimeoutMs)
    timer.unref()
    try {
      return await this.refreshWithin(controller.signal)
    } finally {
      clearTimeout(timer)
    }
  }

  /** Refresh work sharing one cancellation deadline across all durable reads. */
  private async refreshWithin(signal: AbortSignal): Promise<UsageInsightsSnapshot> {
    const timeZone = this.config.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    // Validate now so a bad override fails before any cache write.
    void new Intl.DateTimeFormat('en', { timeZone }).format()
    const snapshots = await this.ctx.sessionPersistence.listSnapshots(signal)
    const table = this.requireTable()
    const listedIds = new Set(snapshots.map(snapshot => String(snapshot.header.id)))
    for (const id of this.liveRows.keys()) {
      if (!listedIds.has(id)) this.liveRows.delete(id)
    }
    for (const id of this.eventGeneration.keys()) {
      if (!listedIds.has(id)) this.eventGeneration.delete(id)
    }
    await Promise.all([...table.keys()]
      .filter(id => !listedIds.has(String(id)))
      .map(async (id) => { await this.deleteSoft(id) }))

    const results = await this.mapConcurrent(snapshots, 8, snapshot => this.rowFor(snapshot, timeZone, signal))
    const rows: SessionUsageRow[] = []
    let omittedSessions = 0
    for (const result of results) {
      if (result.row === undefined) {
        omittedSessions += 1
        continue
      }
      rows.push(result.row)
      if (result.cache !== undefined) await this.putSoft(result.row.sessionId as SessionId, result.cache)
    }
    return aggregateUsageRows(rows, { now: Date.now(), timeZone, omittedSessions })
  }

  /** Reuse one exact cache row or inspect and refold only this session. */
  private async rowFor(
    snapshot: SessionPersistenceSnapshot,
    timeZone: string,
    signal: AbortSignal,
  ): Promise<RefreshResult> {
    const id = String(snapshot.header.id)
    const generation = this.eventGeneration.get(id) ?? 0
    const revision = String(snapshot.revision)
    const sessions = this.ctx.get('sessions') as { get(id: SessionId): Session | undefined } | undefined
    const live = sessions?.get(snapshot.header.id) !== undefined
    const liveCached = this.liveRows.get(id)
    if (live
      && liveCached?.generation === generation
      && this.matches(liveCached.record, snapshot, timeZone)
      && !this.dirty.has(id)) {
      return { row: liveCached.record.row }
    }
    const cached = cacheRecordSchema.safeParse(this.requireTable().get(snapshot.header.id))
    if (cached.success && this.matches(cached.data, snapshot, timeZone) && !this.dirty.has(id)) {
      return { row: cached.data.row }
    }
    try {
      const inspection = await this.ctx.sessionPersistence.inspect(snapshot.header.id, signal)
      const row = foldSessionUsage(
        inspection.meta,
        inspection.events,
        timeZone,
        inspection.inheritedEventCount,
      )
      const record: CacheRecord = {
        schemaVersion: 2,
        revision,
        createdAt: inspection.meta.createdAt,
        timeZone,
        row,
      }
      // A Session event racing the inspection leaves this result useful for
      // the current response but ineligible for either cache. The next refresh
      // sees the newer generation and inspects again.
      if ((this.eventGeneration.get(id) ?? 0) !== generation) return { row }
      this.dirty.delete(id)
      if (sessions?.get(snapshot.header.id) !== undefined) {
        // Live inspection can include events newer than the durable revision.
        // Keep it process-local so a crash can never persist an over-counted
        // row under an older on-disk revision.
        this.liveRows.set(id, { record, generation })
        return { row }
      }
      this.liveRows.delete(id)
      return {
        row,
        cache: record,
      }
    } catch (error) {
      if (signal.aborted) return {}
      this.ctx.logger.warn(`usage insights: omitted session "${snapshot.header.id}": ${String(error)}`)
      return {}
    }
  }

  /** Match one cache record to the exact durable identity and calendar zone. */
  private matches(record: CacheRecord, snapshot: SessionPersistenceSnapshot, timeZone: string): boolean {
    return record.revision === String(snapshot.revision)
      && record.createdAt === snapshot.header.createdAt
      && record.timeZone === timeZone
  }

  /** Bounded ordered concurrency without exposing mutable worker state. */
  private async mapConcurrent<T, R>(
    values: readonly T[],
    limit: number,
    visit: (value: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(values.length)
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < values.length) {
        const index = cursor
        cursor += 1
        results[index] = await visit(values[index] as T)
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
    return results
  }

  /** Cache writes are accelerators and must never fail the read model. */
  private async putSoft(id: SessionId, record: CacheRecord): Promise<void> {
    try {
      await this.requireTable().put(id, record)
    } catch (error) {
      this.ctx.logger.warn(`usage insights: cache write for "${id}" failed: ${String(error)}`)
    }
  }

  /** Cache deletion is likewise fail-soft; authority is the persistence list. */
  private async deleteSoft(id: SessionId): Promise<void> {
    try {
      await this.requireTable().delete(id)
    } catch (error) {
      this.ctx.logger.warn(`usage insights: stale cache delete for "${id}" failed: ${String(error)}`)
    }
  }

  private requireTable(): KvTable<SessionId, unknown> {
    /* v8 ignore next -- Service.init opens the domain before injection */
    if (this.table === undefined) throw new Error('usage insights is not initialized')
    return this.table
  }
}

export default UsageInsightsGateway
