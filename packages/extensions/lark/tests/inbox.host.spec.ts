import { describe, expect, test, vi } from 'vitest'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { DurableLarkInbox, type LarkInboxStore, type RemoteAgent } from '../src/inbox.ts'
import type { BindingRecord, QueueRecord } from '../src/state.ts'

const binding: BindingRecord = {
  id: 'owner', ownerOpenId: 'ou_owner', chatId: 'oc_dm', workspaceId: 'w1',
  projectPath: '/project', sessionId: 'session-1', generation: 1,
  state: 'active', boundAt: 1, updatedAt: 1,
}

function harness(seed: QueueRecord[] = [], currentBinding: BindingRecord | null = binding) {
  const records = new Map(seed.map(record => [record.id, record]))
  const pending: UserMessage[] = []
  const followup = vi.fn((message: UserMessage) => { pending.push(message) })
  const steer = vi.fn()
  const cancel = vi.fn()
  const remove = vi.fn((id: ReturnType<typeof MessageId>) => {
    const index = pending.findIndex(message => message.id === id)
    if (index < 0) return false
    pending.splice(index, 1)
    return true
  })
  const agent: RemoteAgent = {
    id: 'session-1', followup, steer, cancel,
    inbox: { nextTurn: pending, nextStep: [], remove },
    hasHistoricalMessage: vi.fn(() => false),
  }
  const store: LarkInboxStore = {
    list: async () => [...records.values()],
    put: async (record) => { records.set(record.id, record) },
  }
  let id = 0
  let now = 1000
  const inbox = new DurableLarkInbox({
    store, getBinding: async () => currentBinding ?? undefined, resolveAgent: async () => agent,
    messageId: () => `harness-${++id}`, now: () => ++now,
  })
  return { inbox, agent, records, pending, followup, steer, cancel, remove }
}

const inbound = (eventId: string, text = eventId) => ({
  eventId, messageId: `om:${eventId}`, openId: 'ou_owner', chatId: 'oc_dm', text,
})

describe('strict durable Feishu FIFO', () => {
  test('submits paired-owner text as a visible Harness user message', async () => {
    const h = harness()
    await h.inbox.enqueue(inbound('event-1', 'first'))
    await h.inbox.enqueue(inbound('event-2', 'second'))

    expect(h.followup).toHaveBeenCalledTimes(1)
    expect(h.pending[0]).toMatchObject({
      id: 'harness-1', content: [{ type: 'text', text: 'first' }],
      source: { kind: 'user' },
    })
    expect([...h.records.values()].map(record => [record.sequence, record.status]))
      .toEqual([[1, 'queued'], [2, 'prepared']])

    await h.inbox.onClaim('session-1', 'harness-1', 7)
    expect(h.followup).toHaveBeenCalledTimes(1)
    await h.inbox.onTurnEnd('session-1', 8, 'completed')
    expect(h.followup).toHaveBeenCalledTimes(1)
    await h.inbox.onTurnEnd('session-1', 7, 'completed')
    expect(h.followup).toHaveBeenCalledTimes(2)
    expect(h.followup.mock.calls[1]![0]).toMatchObject({ id: 'harness-2' })
  })

  test('deduplicates Feishu event IDs and mints monotonically increasing sequences', async () => {
    const h = harness()
    await h.inbox.enqueue(inbound('same'))
    await h.inbox.enqueue(inbound('same'))
    await h.inbox.enqueue(inbound('next'))
    expect(h.records.size).toBe(2)
    expect([...h.records.values()].map(record => record.sequence)).toEqual([1, 2])
  })

  test('reports an inactive binding without accepting the message', async () => {
    const h = harness([], null)

    await expect(h.inbox.enqueue(inbound('unbound'))).resolves.toBe('unbound')

    expect(h.records.size).toBe(0)
    expect(h.followup).not.toHaveBeenCalled()
  })

  test('preserves durable image references and private staged-file facts in the Harness turn', async () => {
    const h = harness()
    await h.inbox.enqueue({
      ...inbound('media', 'inspect these'),
      attachments: [
        {
          kind: 'image', attachment: {
            attachmentId: 'att-1', mediaType: 'image/png', bytes: 4, width: 1, height: 1,
          },
        },
        {
          kind: 'file', id: 'file-1', path: '/private/dsh/lark/files/file-1.bin',
          name: 'spec.pdf', size: 8, sha256: 'a'.repeat(64), expiresAt: 2_000,
        },
      ],
    })
    const sent = h.followup.mock.calls[0]?.[0]
    const text = sent?.content[0]
    const image = sent?.content[1]
    expect(text?.type).toBe('text')
    if (text?.type !== 'text') throw new Error('expected a text content part')
    expect(text.text).toContain('/private/dsh/lark/files/file-1.bin')
    expect(image?.type).toBe('image')
    if (image?.type !== 'image') throw new Error('expected an image content part')
    expect(image.attachment.attachmentId).toBe('att-1')
    expect(h.records.get('media')?.attachments).toHaveLength(2)
  })

  test('/插话 uses only steer with a visible Harness user message', async () => {
    const h = harness()
    await h.inbox.steer('urgent correction')
    expect(h.steer).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: 'urgent correction' }],
      source: { kind: 'user' },
    }))
    expect(h.followup).not.toHaveBeenCalled()
  })

  test('/停止 removes only unclaimed remote IDs and preserves the rest of the inbox', async () => {
    const h = harness()
    const other = {
      id: MessageId('other-source'), role: 'user' as const,
      content: [{ type: 'text' as const, text: 'keep me' }], source: { kind: 'user' as const },
    }
    h.pending.push(other)
    await h.inbox.enqueue(inbound('event-1'))
    await h.inbox.enqueue(inbound('event-2'))
    await h.inbox.stop()
    expect(h.pending).toEqual([other])
    expect(h.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    expect([...h.records.values()].every(record => record.status === 'cancelled')).toBe(true)
  })
})
