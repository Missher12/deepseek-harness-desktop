import { MessageId, freezeMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { BindingRecord, QueueAttachment, QueueRecord } from './state.ts'
import type { AdmittedMessage } from './commands.ts'

/** Durable queue persistence required by the remote FIFO. */
export interface LarkInboxStore {
  list(): Promise<QueueRecord[]>
  put(record: QueueRecord): Promise<void>
}

/** Existing Harness Agent surface reused by the remote FIFO. */
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
    this.now = options.now ?? (() => Date.now())
    this.mintMessageId = options.messageId ?? (() => crypto.randomUUID())
  }

  /**
   * Write-ahead persist and schedule one admitted Feishu message.
   * @param input - Owner-gated normalized message.
   */
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
        ...(input.attachments === undefined ? {} : { attachments: [...input.attachments] }),
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

  /**
   * Steer the currently bound Agent without joining the FIFO.
   * @param text - Owner-supplied interruption text.
   */
  steer(text: string): Promise<void> {
    return this.serial(async () => {
      const binding = await this.requireActiveBinding()
      const agent = await this.options.resolveAgent(binding.sessionId)
      agent.steer(this.message(this.mintMessageId(), text))
    })
  }

  /**
   * Cancel the active remote turn and remove only unclaimed plugin messages.
   * @param _message - Optional command payload retained for router compatibility.
   */
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

  /**
   * Correlate an exact queued Message ID with its claimed Harness turn.
   * @param sessionId - Exact bound Session identifier.
   * @param messageId - Pre-created Harness Message ID.
   * @param turn - Claimed Harness turn number.
   */
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

  /**
   * Settle only the queued item claimed by the exact terminal turn.
   * @param sessionId - Exact bound Session identifier.
   * @param turn - Terminal Harness turn number.
   * @param outcome - Projected terminal outcome.
   */
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

  /** Reconcile durable queue state with the real Agent inbox and Session history. */
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

  /** Pause undispatched remote items when the plugin is disabled. */
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

  /** Resume locally confirmed paused items in original sequence order. */
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
    agent.followup(this.message(first.harnessMessageId, first.text, first.attachments))
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

  private message(id: string, text: string, attachments: readonly QueueAttachment[] = []): UserMessage {
    const fileText = attachments
      .filter((item): item is Extract<QueueAttachment, { kind: 'file' }> => item.kind === 'file')
      .map(item => `飞书文件：${item.name}\n临时路径：${item.path}\nSHA-256：${item.sha256}\n到期时间：${new Date(item.expiresAt).toISOString()}`)
      .join('\n\n')
    const visibleText = [text.trim(), fileText].filter(Boolean).join('\n\n')
    return freezeMessage({
      id: MessageId(id), role: 'user',
      content: [
        ...(visibleText === '' ? [] : [{ type: 'text' as const, text: visibleText }]),
        ...attachments
          .filter((item): item is Extract<QueueAttachment, { kind: 'image' }> => item.kind === 'image')
          .map(item => ({ type: 'image' as const, attachment: item.attachment as ImageAttachmentRef })),
      ],
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
