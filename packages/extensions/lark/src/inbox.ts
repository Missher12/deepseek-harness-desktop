import { MessageId, freezeMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { BindingRecord, QueueRecord } from './state.ts'
import type { AdmittedMessage } from './commands.ts'

export interface LarkInboxStore {
  list(): Promise<QueueRecord[]>
  put(record: QueueRecord): Promise<void>
}

export interface RemoteAgent {
  id: string
  followup(message: UserMessage): void
  steer(message: UserMessage): void
  cancel(cause: { kind: 'user' }, options: { keepInbox: true }): void
  inbox: {
    nextTurn: readonly UserMessage[]
    nextStep: readonly UserMessage[]
    remove(messageId: MessageId): boolean
  }
  hasHistoricalMessage(messageId: MessageId, turn?: number): boolean | Promise<boolean>
}

interface InboxOptions {
  store: LarkInboxStore
  getBinding(): Promise<BindingRecord | undefined>
  resolveAgent(sessionId: string): Promise<RemoteAgent>
  messageId?: () => string
  now?: () => number
}

const unsettled = (record: QueueRecord): boolean =>
  !['terminal', 'cancelled'].includes(record.status)

/** One durable, terminal-boundary FIFO over a bound ordinary Harness Agent. */
export class DurableLarkInbox {
  private readonly now: () => number
  private readonly mintMessageId: () => string
  private tail = Promise.resolve()

  constructor(private readonly options: InboxOptions) {
    this.now = options.now ?? Date.now
    this.mintMessageId = options.messageId ?? crypto.randomUUID
  }

  enqueue(input: AdmittedMessage): Promise<void> {
    return this.serial(async () => {
      const records = await this.options.store.list()
      if (records.some(record => record.eventId === input.eventId)) return
      const binding = await this.requireActiveBinding()
      const now = this.now()
      const record: QueueRecord = {
        id: input.eventId,
        eventId: input.eventId,
        sequence: records.reduce((max, row) => Math.max(max, row.sequence), 0) + 1,
        bindingGeneration: binding.generation,
        sessionId: binding.sessionId,
        harnessMessageId: this.mintMessageId(),
        text: input.text,
        status: 'prepared',
        createdAt: now,
        updatedAt: now,
        attempts: 0,
      }
      // Write-ahead is the acknowledgement boundary: delivery happens only after this resolves.
      await this.options.store.put(record)
      await this.pump()
    })
  }

  steer(text: string): Promise<void> {
    return this.serial(async () => {
      const binding = await this.requireActiveBinding()
      const agent = await this.options.resolveAgent(binding.sessionId)
      agent.steer(this.message(this.mintMessageId(), text))
    })
  }

  stop(_message?: unknown): Promise<void> {
    return this.serial(async () => {
      const binding = await this.options.getBinding()
      if (binding === undefined) return
      const agent = await this.options.resolveAgent(binding.sessionId)
      const records = (await this.options.store.list())
        .filter(record => record.sessionId === binding.sessionId
          && record.bindingGeneration === binding.generation && unsettled(record))
      for (const record of records) {
        if (record.status === 'claimed') continue
        const removable = record.status === 'queued'
          ? agent.inbox.remove(MessageId(record.harnessMessageId))
          : true
        if (!removable) continue
        const now = this.now()
        await this.options.store.put({
          ...record, status: 'cancelled', cancelledAt: now,
          reason: 'remote-stop', updatedAt: now,
        })
      }
      agent.cancel({ kind: 'user' }, { keepInbox: true })
    })
  }

  onClaim(sessionId: string, messageId: string, turn: number): Promise<void> {
    return this.serial(async () => {
      const record = (await this.options.store.list()).find(row =>
        row.sessionId === sessionId && row.harnessMessageId === messageId && row.status === 'queued')
      if (record === undefined || record.status !== 'queued') return
      const now = this.now()
      await this.options.store.put({
        ...record, status: 'claimed', claimedAt: now,
        turnId: String(turn), updatedAt: now,
      })
    })
  }

  onTurnEnd(
    sessionId: string,
    turn: number,
    outcome: 'completed' | 'cancelled' | 'failed',
  ): Promise<void> {
    return this.serial(async () => {
      const record = (await this.options.store.list()).find(row =>
        row.sessionId === sessionId && row.status === 'claimed' && row.turnId === String(turn))
      if (record === undefined || record.status !== 'claimed') return
      await this.setTerminal(record, outcome)
      await this.pump()
    })
  }

  recover(): Promise<void> {
    return this.serial(async () => {
      const binding = await this.options.getBinding()
      if (binding === undefined || binding.state !== 'active') return
      const agent = await this.options.resolveAgent(binding.sessionId)
      const records = (await this.options.store.list())
        .filter(record => record.sessionId === binding.sessionId
          && record.bindingGeneration === binding.generation && unsettled(record))
        .sort((left, right) => left.sequence - right.sequence)
      const first = records[0]
      if (first?.status === 'claimed') {
        const turn = Number(first.turnId)
        if (Number.isSafeInteger(turn)
          && await agent.hasHistoricalMessage(MessageId(first.harnessMessageId), turn)) {
          await this.setTerminal(first, 'completed')
        }
      } else if (first?.status === 'queued') {
        if (await agent.hasHistoricalMessage(MessageId(first.harnessMessageId))) {
          const now = this.now()
          await this.options.store.put({
            ...first, status: 'terminal', claimedAt: first.queuedAt,
            terminalAt: now, turnId: 'recovered', outcome: 'completed', updatedAt: now,
          })
        } else if (!this.isPending(agent, first.harnessMessageId)) {
          const now = this.now()
          await this.options.store.put({ ...first, status: 'prepared', updatedAt: now })
        }
      }
      await this.pump()
    })
  }

  async pause(): Promise<void> {
    await this.serial(async () => {
      for (const record of await this.options.store.list()) {
        if (!unsettled(record) || record.status === 'claimed') continue
        const now = this.now()
        await this.options.store.put({
          ...record, status: 'paused', pausedAt: now,
          reason: 'plugin-disabled', updatedAt: now,
        })
      }
    })
  }

  async resume(): Promise<void> {
    await this.serial(async () => {
      for (const record of await this.options.store.list()) {
        if (record.status !== 'paused') continue
        const now = this.now()
        await this.options.store.put({ ...record, status: 'prepared', updatedAt: now })
      }
      await this.pump()
    })
  }

  private async pump(): Promise<void> {
    const binding = await this.options.getBinding()
    if (binding === undefined || binding.state !== 'active') return
    const records = (await this.options.store.list())
      .filter(record => record.sessionId === binding.sessionId
        && record.bindingGeneration === binding.generation && unsettled(record))
      .sort((left, right) => left.sequence - right.sequence)
    const first = records[0]
    if (first === undefined || first.status !== 'prepared') return
    const agent = await this.options.resolveAgent(binding.sessionId)
    if (this.isPending(agent, first.harnessMessageId)) {
      const now = this.now()
      await this.options.store.put({
        ...first, status: 'queued', queuedAt: now, updatedAt: now,
      })
      return
    }
    if (await agent.hasHistoricalMessage(MessageId(first.harnessMessageId))) {
      const now = this.now()
      await this.options.store.put({
        ...first, status: 'terminal', queuedAt: now, claimedAt: now,
        terminalAt: now, turnId: 'recovered', outcome: 'completed', updatedAt: now,
      })
      await this.pump()
      return
    }
    const attemptAt = this.now()
    const attempted: QueueRecord = { ...first, attempts: first.attempts + 1, updatedAt: attemptAt }
    await this.options.store.put(attempted)
    agent.followup(this.message(first.harnessMessageId, first.text))
    const queuedAt = this.now()
    await this.options.store.put({
      ...attempted, status: 'queued', queuedAt, updatedAt: queuedAt,
    })
  }

  private async setTerminal(
    record: Extract<QueueRecord, { status: 'claimed' }>,
    outcome: 'completed' | 'cancelled' | 'failed',
  ): Promise<void> {
    const now = this.now()
    await this.options.store.put({
      ...record, status: 'terminal', terminalAt: now, outcome, updatedAt: now,
    })
  }

  private message(id: string, text: string): UserMessage {
    return freezeMessage({
      id: MessageId(id), role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'dsh-lark' },
    })
  }

  private isPending(agent: RemoteAgent, id: string): boolean {
    return [...agent.inbox.nextTurn, ...agent.inbox.nextStep]
      .some(message => message.id === MessageId(id))
  }

  private async requireActiveBinding(): Promise<BindingRecord> {
    const binding = await this.options.getBinding()
    if (binding === undefined || binding.state !== 'active') throw new Error('Lark Session is not actively bound')
    return binding
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}
