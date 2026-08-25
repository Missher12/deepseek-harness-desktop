import { describe, expect, test, vi } from 'vitest'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { DurableLarkInbox, type LarkInboxStore, type RemoteAgent } from '../src/inbox.ts'
import type { BindingRecord, QueueRecord } from '../src/state.ts'

const binding: BindingRecord = {
  id: 'owner', ownerOpenId: 'ou_owner', chatId: 'oc_dm', projectPath: '/project',
  sessionId: 'session-1', generation: 1, state: 'active', boundAt: 1, updatedAt: 1,
}

function prepared(): QueueRecord {
  return {
    id: 'event-1', eventId: 'event-1', sequence: 1, bindingGeneration: 1,
    sessionId: 'session-1', harnessMessageId: 'stable-message', text: 'continue',
    status: 'prepared', createdAt: 100, updatedAt: 100, attempts: 0,
  }
}

describe('durable inbox restart recovery', () => {
  test('reuses the exact Message ID after a crash before enqueue', async () => {
    let record = prepared()
    const followup = vi.fn()
    const agent: RemoteAgent = {
      id: 'session-1', followup, steer: vi.fn(), cancel: vi.fn(),
      inbox: { nextTurn: [], nextStep: [], remove: vi.fn(() => false) },
      hasHistoricalMessage: vi.fn(() => false),
    }
    const store: LarkInboxStore = { list: async () => [record], put: async (value) => { record = value } }
    const inbox = new DurableLarkInbox({
      store, getBinding: async () => binding, resolveAgent: async () => agent,
      messageId: () => 'must-not-remint', now: () => 200,
    })
    await inbox.recover()
    expect(followup).toHaveBeenCalledWith(expect.objectContaining({ id: 'stable-message' }))
    expect(record.status).toBe('queued')
  })

  test('does not enqueue again when the exact persisted ID is already pending', async () => {
    let record = prepared()
    const existing = {
      id: MessageId('stable-message'), role: 'user' as const,
      content: [{ type: 'text' as const, text: 'continue' }],
      source: { kind: 'plugin' as const, plugin: 'dsh-lark' },
    } satisfies UserMessage
    const followup = vi.fn()
    const agent: RemoteAgent = {
      id: 'session-1', followup, steer: vi.fn(), cancel: vi.fn(),
      inbox: { nextTurn: [existing], nextStep: [], remove: vi.fn(() => false) },
      hasHistoricalMessage: vi.fn(() => false),
    }
    const store: LarkInboxStore = { list: async () => [record], put: async (value) => { record = value } }
    const inbox = new DurableLarkInbox({
      store, getBinding: async () => binding, resolveAgent: async () => agent,
      messageId: () => 'must-not-remint', now: () => 200,
    })
    await inbox.recover()
    expect(followup).not.toHaveBeenCalled()
    expect(record.status).toBe('queued')
  })

  test('settles a recovered claimed turn before advancing the next record', async () => {
    let records: QueueRecord[] = [
      { ...prepared(), status: 'claimed', queuedAt: 110, claimedAt: 120, turnId: '7' },
      { ...prepared(), id: 'event-2', eventId: 'event-2', sequence: 2, harnessMessageId: 'second' },
    ]
    const followup = vi.fn()
    const agent: RemoteAgent = {
      id: 'session-1', followup, steer: vi.fn(), cancel: vi.fn(),
      inbox: { nextTurn: [], nextStep: [], remove: vi.fn(() => false) },
      hasHistoricalMessage: vi.fn((_id, turn) => turn === 7),
    }
    const store: LarkInboxStore = {
      list: async () => records,
      put: async (value) => { records = records.map(row => row.id === value.id ? value : row) },
    }
    const inbox = new DurableLarkInbox({
      store, getBinding: async () => binding, resolveAgent: async () => agent,
      messageId: () => 'never', now: () => 200,
    })
    await inbox.recover()
    expect(records[0]?.status).toBe('terminal')
    expect(followup).toHaveBeenCalledWith(expect.objectContaining({ id: 'second' }))
  })
})
