import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { vi } from 'vitest'
import type { DeliveryId, Receipt } from '../src/types.ts'

export class MemoryReceiptStore {
  readonly records = new Map<DeliveryId, Receipt>()
  readonly writes: Receipt[] = []
  readonly deletes: DeliveryId[] = []
  beforePut?: (receipt: Receipt) => void | Promise<void>
  failPut?: (receipt: Receipt) => boolean

  get(id: DeliveryId): Receipt | undefined {
    return this.records.get(id)
  }

  entries(): Array<[DeliveryId, Receipt]> {
    return [...this.records.entries()]
  }

  async put(receipt: Receipt): Promise<void> {
    await this.beforePut?.(receipt)
    if (this.failPut?.(receipt) === true) throw new Error(`injected ${receipt.status} write failure`)
    this.records.set(receipt.id, structuredClone(receipt))
    this.writes.push(structuredClone(receipt))
  }

  async delete(id: DeliveryId): Promise<boolean> {
    this.deletes.push(id)
    return this.records.delete(id)
  }

  drain(): Promise<void> {
    return Promise.resolve()
  }
}

export function fakeAgent(
  id: string,
  options: { status?: 'idle' | 'running'; events?: unknown[]; origin?: 'subagent' } = {},
) {
  const events = options.events ?? []
  const append = vi.fn((type: string, data: unknown, envelope?: { ignorable?: true }) => {
    events.push({ type, data, ...(envelope?.ignorable === true ? { ignorable: true } : {}) })
  })
  return {
    id: SessionId(id),
    status: options.status ?? 'idle',
    options: {},
    session: {
      header: {
        version: 0,
        id: SessionId(id),
        createdAt: 1,
        ...(options.origin === undefined ? {} : { origin: options.origin }),
      },
      events,
      snapshotEvents: () => [...events],
      append,
    },
    inbox: { nextTurn: [], nextStep: [] },
    ctx: {},
    inject: vi.fn(),
    followup: vi.fn(),
    whenIdle: vi.fn(),
  } as unknown as Agent & {
    inject: ReturnType<typeof vi.fn>
    followup: ReturnType<typeof vi.fn>
    whenIdle: ReturnType<typeof vi.fn>
    inbox: { nextTurn: unknown[]; nextStep: unknown[] }
    session: {
      header: { id: ReturnType<typeof SessionId>; origin?: 'subagent' }
      events: unknown[]
      snapshotEvents: () => unknown[]
      append: ReturnType<typeof vi.fn>
    }
  }
}

interface FakeContextHarness {
  ctx: {
    workspaceRegistry: { archivedSessionIds: Array<ReturnType<typeof SessionId>> }
    typert: { lookups: { get: ReturnType<typeof vi.fn> } }
    agents: {
      get: ReturnType<typeof vi.fn>
      isOwnedBy: ReturnType<typeof vi.fn>
      resume: ReturnType<typeof vi.fn>
    }
    sessions: { get: ReturnType<typeof vi.fn> }
    sessionPersistence: { inspect: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> }
    on: ReturnType<typeof vi.fn>
    effect: ReturnType<typeof vi.fn>
    logger: {
      warn: ReturnType<typeof vi.fn>
      error: ReturnType<typeof vi.fn>
      info: ReturnType<typeof vi.fn>
    }
  }
  byId: Map<ReturnType<typeof SessionId>, ReturnType<typeof fakeAgent>>
  listeners: Map<string, Array<(...args: never[]) => unknown>>
  inspect: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
}

export function fakeContext(targets: ReturnType<typeof fakeAgent>[]): FakeContextHarness {
  const byId = new Map(targets.map(target => [target.id, target]))
  const listeners = new Map<string, Array<(...args: never[]) => unknown>>()
  const inspect = vi.fn(async () => { throw new Error('not found') })
  const list = vi.fn(async () => targets.map(target => target.session.header))
  const ctx = {
    workspaceRegistry: { archivedSessionIds: [] as ReturnType<typeof SessionId>[] },
    typert: {
      lookups: {
        get: vi.fn((key: string) => key === 'agent'
          ? { resolve: vi.fn(async (id: ReturnType<typeof SessionId>) => byId.get(id)) }
          : undefined),
      },
    },
    agents: {
      get: vi.fn((id: ReturnType<typeof SessionId>) => byId.get(id)),
      isOwnedBy: vi.fn(() => false),
      resume: vi.fn(),
    },
    sessions: { get: vi.fn() },
    sessionPersistence: { inspect, list },
    on: vi.fn((event: string, listener: (...args: never[]) => unknown) => {
      const entries = listeners.get(event) ?? []
      entries.push(listener)
      listeners.set(event, entries)
      return vi.fn()
    }),
    effect: vi.fn((setup: () => unknown) => setup()),
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  }
  return { ctx, byId, listeners, inspect, list }
}
