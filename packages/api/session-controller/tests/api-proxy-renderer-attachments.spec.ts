/** Session Controller renderer projection: durable document addresses never cross the wire. */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import {
  ToolCallId,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { SessionControlController } from '../src/control.ts'
import { SessionHistoryController } from '../src/history.ts'
import type {
  SessionControlFrame,
  SessionHistoryRecord,
  SessionWireEvent,
} from '../src/types.ts'
import { installSessionReadTestServices } from './test-remote.ts'

const SOURCE_DIGEST = AttachmentId(`sha256:${'f'.repeat(64)}`)
const TEXT_DIGEST = AttachmentId(`sha256:${'e'.repeat(64)}`)

function documentBlock(attachment: Record<string, unknown> = {}): ContentBlock {
  return {
    type: 'document',
    attachment: {
      attachmentId: SOURCE_DIGEST,
      extractedTextId: TEXT_DIGEST,
      mediaType: 'text/markdown',
      name: 'launch-plan.md',
      bytes: 12,
      extractedBytes: 12,
      truncated: false,
      ...attachment,
    },
  } as never
}

function documentMessage(source: UserMessage['source'] = { kind: 'user' }): UserMessage {
  return createUserMessage({ content: [documentBlock()], source })
}

async function harness(): Promise<{
  ctx: Context
  session: Session
  agent: Agent
  inbox: Inbox
  history: SessionHistoryController
  control: SessionControlController
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  const session = ctx.sessions.create(SessionId('renderer-session'), { meta: { cwd: '/workspace' } })
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const agent = { id: session.id, session, inbox, status: 'idle', ctx } as Agent
  ctx.agents.register(agent)
  return {
    ctx,
    session,
    agent,
    inbox,
    history: new SessionHistoryController(ctx, observation => observation[Symbol.dispose]()),
    control: new SessionControlController(ctx),
  }
}

function appendExtension(session: Session, type: string, data: unknown): SessionEvent {
  return (session.append as unknown as (kind: string, value: unknown) => SessionEvent)(type, data)
}

function eventRecords(records: readonly SessionHistoryRecord[]): SessionWireEvent[] {
  return records.flatMap(record => record.type === 'event' ? [record.event] : [])
}

function rendererDocument(value: unknown): Record<string, unknown> {
  const block = value as { attachment?: Record<string, unknown> }
  if (block.attachment === undefined) throw new Error('expected a document attachment')
  return block.attachment
}

function expectRendererDocument(value: unknown): string {
  const attachment = rendererDocument(value)
  expect(attachment['displayId']).toMatch(/^document-view:[A-Za-z0-9_-]+$/u)
  expect(attachment).toEqual({
    displayId: attachment['displayId'],
    name: 'launch-plan.md',
    mediaType: 'text/markdown',
    bytes: 12,
    extractedBytes: 12,
    truncated: false,
  })
  const serialized = JSON.stringify(value)
  expect(serialized).not.toContain(String(SOURCE_DIGEST))
  expect(serialized).not.toContain(String(TEXT_DIGEST))
  expect(serialized).not.toContain('attachmentId')
  expect(serialized).not.toContain('extractedTextId')
  return String(attachment['displayId'])
}

async function nextControl(
  iterator: AsyncIterator<SessionControlFrame>,
  type: SessionControlFrame['type'],
): Promise<SessionControlFrame> {
  while (true) {
    const next = await iterator.next()
    if (next.done === true) throw new Error(`control stream ended before ${type}`)
    if (next.value.type === type) return next.value
  }
}

describe('Session Controller renderer attachment projection', () => {
  it('projects history documents to stable bounded metadata', async () => {
    const { ctx, session, history } = await harness()
    const event = session.append('user/message', documentMessage(), { surfaceOp: 'append' })
    const request = {
      address: { kind: 'session' as const, sessionId: session.id },
      throughSeq: event.seq,
    }

    const first = await history.page(request, new AbortController().signal)
    const second = await history.page(request, new AbortController().signal)
    const firstEvent = eventRecords(first.records)[0]
    const secondEvent = eventRecords(second.records)[0]
    const firstId = expectRendererDocument(
      (firstEvent?.data as { content: unknown[] }).content[0],
    )
    expect(expectRendererDocument(
      (secondEvent?.data as { content: unknown[] }).content[0],
    )).toBe(firstId)
    expect(session.snapshotEvents()[0]).toBe(event)
    expect(JSON.stringify(session.snapshotEvents()[0])).toContain(String(SOURCE_DIGEST))
    await ctx.fiber.dispose()
  })

  it('projects live events and queue baselines with stable per-message display ids', async () => {
    const { ctx, session, inbox, history, control } = await harness()
    const followAbort = new AbortController()
    const follow = history.follow({
      address: { kind: 'session', sessionId: session.id },
    }, followAbort.signal)[Symbol.asyncIterator]()
    await expect(follow.next()).resolves.toMatchObject({ value: { type: 'snapshot' } })
    const controlAbort = new AbortController()
    const controlStream = control.control(controlAbort.signal)[Symbol.asyncIterator]()
    await nextControl(controlStream, 'baseline')

    inbox.append('next-turn', documentMessage())
    const live = await follow.next()
    if (live.done || live.value.type !== 'event') throw new Error('missing live inbox event')
    const inserted = (live.value.event.data as { inserted: { content: unknown[] }[] }).inserted[0]
    expectRendererDocument(inserted?.content[0])

    const queue = await nextControl(controlStream, 'queue')
    if (queue.type !== 'queue') throw new Error('missing queue projection')
    const firstId = expectRendererDocument(queue.items[0]?.message.content[0])

    controlAbort.abort()
    await controlStream.next()
    const replayAbort = new AbortController()
    const replay = control.control(replayAbort.signal)[Symbol.asyncIterator]()
    const baseline = await nextControl(replay, 'baseline')
    if (baseline.type !== 'baseline') throw new Error('missing replay baseline')
    const replayed = baseline.value.queues[session.id]?.[0]
    expect(expectRendererDocument(replayed?.message.content[0])).toBe(firstId)

    followAbort.abort()
    replayAbort.abort()
    await follow.next()
    await replay.next()
    await ctx.fiber.dispose()
  })

  it('does not rewrite unrelated plugin metadata that merely resembles a document block', async () => {
    const { ctx, session, history } = await harness()
    const collision = { type: 'document', attachment: { label: 'plugin metadata', revision: 3 } }
    const event = session.append('user/message', documentMessage({
      kind: 'user', collision,
    } as never), { surfaceOp: 'append' })
    const page = await history.page({
      address: { kind: 'session', sessionId: session.id }, throughSeq: event.seq,
    }, new AbortController().signal)
    const wire = eventRecords(page.records)[0]
    expect((wire?.data as { source: { collision: unknown } }).source.collision).toEqual(collision)
    expectRendererDocument((wire?.data as { content: unknown[] }).content[0])
    await ctx.fiber.dispose()
  })

  it('projects tool results and merge-extensible content carriers', async () => {
    const { ctx, session, history } = await harness()
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('document-result'), content: [documentBlock()], isError: false,
      }),
    }, { surfaceOp: 'append' })
    appendExtension(session, 'compaction/summary', {
      summary: [documentBlock()], rawOutput: [documentBlock()],
    })
    appendExtension(session, 'tool/code-dispatch', { content: [documentBlock()] })
    appendExtension(session, 'team/message/queued', { message: { content: [documentBlock()] } })
    const last = appendExtension(
      session,
      'plugin/document-carrier',
      { nested: { value: documentBlock() } },
    )
    const page = await history.page({
      address: { kind: 'session', sessionId: session.id },
      throughSeq: last.seq,
    }, new AbortController().signal)
    const byType = new Map(eventRecords(page.records).map(event => [event.type, event] as const))
    expectRendererDocument((byType.get('tool/result')?.data as {
      message: { content: { content: unknown[] }[] }
    }).message.content[0]?.content[0])
    expectRendererDocument((byType.get('compaction/summary')?.data as { summary: unknown[] }).summary[0])
    expectRendererDocument((byType.get('compaction/summary')?.data as { rawOutput: unknown[] }).rawOutput[0])
    expectRendererDocument((byType.get('tool/code-dispatch')?.data as { content: unknown[] }).content[0])
    expectRendererDocument((byType.get('team/message/queued')?.data as { message: { content: unknown[] } }).message.content[0])
    expectRendererDocument((byType.get('plugin/document-carrier')?.data as {
      nested: { value: unknown }
    }).nested.value)
    await ctx.fiber.dispose()
  })

  it('bounds malformed display metadata while stripping valid durable addresses', async () => {
    const { ctx, session, history } = await harness()
    const event = appendExtension(session, 'plugin/malformed-document', {
      payload: documentBlock({
        mediaType: 'application/x-not-allowed',
        name: `${'a'.repeat(254)}😀`,
        bytes: -1,
        extractedBytes: Number.MAX_SAFE_INTEGER + 1,
        truncated: 'yes',
      }),
    })
    const page = await history.page({
      address: { kind: 'session', sessionId: session.id }, throughSeq: event.seq,
    }, new AbortController().signal)
    const projected = (eventRecords(page.records)[0]?.data as { payload: unknown }).payload
    const attachment = rendererDocument(projected)
    expect(attachment).toEqual({
      displayId: attachment['displayId'],
      name: 'a'.repeat(254),
      mediaType: 'text/plain',
      bytes: 0,
      extractedBytes: 0,
      truncated: false,
    })
    expect(JSON.stringify(projected)).not.toContain(String(SOURCE_DIGEST))
    expect(JSON.stringify(projected)).not.toContain(String(TEXT_DIGEST))
    await ctx.fiber.dispose()
  })
})
