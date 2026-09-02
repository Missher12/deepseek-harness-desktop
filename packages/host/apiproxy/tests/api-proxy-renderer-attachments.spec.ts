/** Host-to-renderer attachment projection: durable content addresses never cross the wire. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const SOURCE_DIGEST = AttachmentId(`sha256:${'f'.repeat(64)}`)
const TEXT_DIGEST = AttachmentId(`sha256:${'e'.repeat(64)}`)

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`renderer-attachment-${String(nextRpc++)}`), payload }
}

function documentBlock(): ContentBlock {
  return {
    type: 'document',
    attachment: {
      attachmentId: SOURCE_DIGEST,
      extractedTextId: TEXT_DIGEST,
      sourceSha256: SOURCE_DIGEST,
      textSha256: TEXT_DIGEST,
      mediaType: 'text/markdown',
      name: 'launch-plan.md',
      bytes: 12,
      extractedBytes: 12,
      truncated: false,
    },
  } as never
}

function documentMessage(source: UserMessage['source'] = { kind: 'user' }): UserMessage {
  return createUserMessage({ content: [documentBlock()], source })
}

async function harness(): Promise<{ ctx: Context; session: Session; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(defineContentToolFixture({
    name: 'echo-document',
    description: 'echo a document result into the renderer presentation',
    parameters: {},
    execute: async () => [documentBlock()],
    presentResult: (_args, result) => ({ card: 'generic', content: result.content }),
  }))
  const session = ctx.sessions.create()
  const agent = {
    id: session.id,
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx,
  } as Agent
  ctx.agents.register(agent)
  return { ctx, session, agent }
}

/** Append one merge-extensible event without importing its owning package. */
function appendExtension(session: Session, type: string, data: unknown): SessionEvent {
  return (session.append as unknown as (eventType: string, eventData: unknown) => SessionEvent)(type, data)
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
  expect(serialized).not.toContain('sourceSha256')
  expect(serialized).not.toContain('textSha256')
  return String(attachment['displayId'])
}

async function nextFrame(
  iterator: AsyncIterator<RpcRequest<MuxFrame>>,
  type: MuxFrame['type'],
): Promise<MuxFrame> {
  while (true) {
    const next = await iterator.next()
    if (next.done === true) throw new Error(`mux ended before ${type}`)
    if (next.value.payload.type === type) return next.value.payload
  }
}

async function nextFrames(
  iterator: AsyncIterator<RpcRequest<MuxFrame>>,
  types: readonly MuxFrame['type'][],
): Promise<Map<MuxFrame['type'], MuxFrame>> {
  const pending = new Set(types)
  const found = new Map<MuxFrame['type'], MuxFrame>()
  while (pending.size > 0) {
    const next = await iterator.next()
    if (next.done === true) throw new Error(`mux ended before ${[...pending].join(', ')}`)
    const payload = next.value.payload
    if (!pending.delete(payload.type)) continue
    found.set(payload.type, payload)
  }
  return found
}

describe('Host renderer attachment projection', () => {
  it('projects history documents to stable bounded metadata without durable content addresses', async () => {
    const { ctx, session } = await harness()
    session.append('user/message', documentMessage(), { surfaceOp: 'append' })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })

    const first = await api.sessions.history(request({ sessionId: session.id }))
    const second = await api.sessions.history(request({ sessionId: session.id }))
    expect(first.result.ok).toBe(true)
    expect(second.result.ok).toBe(true)
    if (!first.result.ok || !second.result.ok) return
    const firstEvent = first.result.value.events[0]?.event
    const secondEvent = second.result.value.events[0]?.event
    expect(firstEvent?.type).toBe('user/message')
    expect(secondEvent?.type).toBe('user/message')
    if (firstEvent?.type !== 'user/message' || secondEvent?.type !== 'user/message') return
    const firstId = expectRendererDocument(firstEvent.data.content[0])
    const secondId = expectRendererDocument(secondEvent.data.content[0])
    expect(secondId).toBe(firstId)

    await ctx.fiber.dispose()
  })

  it('projects live events and queue snapshots, preserving a queue display id across mux generations', async () => {
    const { ctx, agent } = await harness()
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })
    const firstAbort = new AbortController()
    const first = api.events.mux(request({}), firstAbort.signal)[Symbol.asyncIterator]()
    await nextFrame(first, 'session/subscribed')

    agent.inbox.append('next-turn', documentMessage())
    const frames = await nextFrames(first, ['session/event', 'session/queue'])
    const live = frames.get('session/event')
    const queue = frames.get('session/queue')
    expect(live).toBeDefined()
    expect(queue).toBeDefined()
    if (live === undefined || queue === undefined) return
    expect(live.type).toBe('session/event')
    expect(queue.type).toBe('session/queue')
    if (live.type !== 'session/event' || queue.type !== 'session/queue') return
    expect(live.event.type).toBe('agent/inbox/spliced')
    if (live.event.type !== 'agent/inbox/spliced') return
    expectRendererDocument(live.event.data.inserted[0]?.content[0])
    const firstQueueId = expectRendererDocument(queue.items[0]?.message.content[0])

    firstAbort.abort()
    await first.return?.()

    const secondAbort = new AbortController()
    const second = api.events.mux(request({}), secondAbort.signal)[Symbol.asyncIterator]()
    await nextFrame(second, 'session/subscribed')
    const replayedQueue = await nextFrame(second, 'session/queue')
    expect(replayedQueue.type).toBe('session/queue')
    if (replayedQueue.type !== 'session/queue') return
    expect(expectRendererDocument(replayedQueue.items[0]?.message.content[0])).toBe(firstQueueId)

    secondAbort.abort()
    await second.return?.()
    await ctx.fiber.dispose()
  })

  it('does not rewrite unrelated plugin metadata that merely resembles a document block', async () => {
    const { ctx, session } = await harness()
    const collision = {
      type: 'document',
      attachment: { label: 'plugin-owned metadata', revision: 3 },
    }
    session.append('user/message', documentMessage({
      kind: 'user',
      collision,
    } as never), { surfaceOp: 'append' })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })

    const history = await api.sessions.history(request({ sessionId: session.id }))
    expect(history.result.ok).toBe(true)
    if (!history.result.ok) return
    const event = history.result.value.events[0]?.event
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') return
    expect((event.data.source as unknown as { collision: unknown }).collision).toEqual(collision)
    expectRendererDocument(event.data.content[0])

    await ctx.fiber.dispose()
  })

  it('projects presenter content on both live and history paths', async () => {
    const { ctx, session } = await harness()
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })
    session.append('turn/start', { turn: 1 })
    const abort = new AbortController()
    const stream = api.events.mux(request({}), abort.signal)[Symbol.asyncIterator]()
    await nextFrame(stream, 'session/subscribed')

    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: CallId('renderer-document-view'),
      name: 'echo-document',
      arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('renderer-document-view'),
        content: [documentBlock()],
        isError: false,
      }),
    }, { surfaceOp: 'append' })

    let liveResult: Extract<MuxFrame, { type: 'session/event' }> | undefined
    while (liveResult === undefined) {
      const frame = await nextFrame(stream, 'session/event')
      if (frame.type === 'session/event' && frame.event.type === 'tool/result') liveResult = frame
    }
    expect(liveResult.view?.for).toBe('result')
    if (liveResult.view?.for === 'result' && 'content' in liveResult.view.view) {
      expectRendererDocument(liveResult.view.view.content?.[0])
    }

    const history = await api.sessions.history(request({ sessionId: session.id }))
    expect(history.result.ok).toBe(true)
    if (!history.result.ok) return
    const historyResult = history.result.value.events.find(entry => entry.event.type === 'tool/result')
    expect(historyResult?.view?.for).toBe('result')
    if (historyResult?.view?.for === 'result' && 'content' in historyResult.view.view) {
      expectRendererDocument(historyResult.view.view.content?.[0])
    }

    abort.abort()
    await stream.return?.()
    await ctx.fiber.dispose()
  })

  it('projects every known content carrier and a digest-bearing extension carrier', async () => {
    const { ctx, session } = await harness()
    appendExtension(session, 'compaction/summary', {
      summary: [documentBlock()],
      rawOutput: [documentBlock()],
    })
    appendExtension(session, 'tool/code-dispatch', { content: [documentBlock()] })
    appendExtension(session, 'team/message/queued', { message: { content: [documentBlock()] } })
    appendExtension(session, 'plugin/document-carrier', {
      nested: { value: documentBlock() },
    })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })

    const history = await api.sessions.history(request({ sessionId: session.id }))
    expect(history.result.ok).toBe(true)
    if (!history.result.ok) return
    const byType = new Map<string, unknown>(
      history.result.value.events.map(entry => [entry.event.type, entry.event] as const),
    )
    expectRendererDocument((byType.get('compaction/summary') as never as { data: { summary: unknown[] } }).data.summary[0])
    expectRendererDocument((byType.get('compaction/summary') as never as { data: { rawOutput: unknown[] } }).data.rawOutput[0])
    expectRendererDocument((byType.get('tool/code-dispatch') as never as { data: { content: unknown[] } }).data.content[0])
    expectRendererDocument((byType.get('team/message/queued') as never as { data: { message: { content: unknown[] } } }).data.message.content[0])
    expectRendererDocument((byType.get('plugin/document-carrier') as never as {
      data: { nested: { value: unknown } }
    }).data.nested.value)

    await ctx.fiber.dispose()
  })

  it('fails closed when a content-addressed extension wrapper has malformed display metadata', async () => {
    const { ctx, session } = await harness()
    const malformedAttachment = (name: unknown) => ({
      attachmentId: SOURCE_DIGEST,
      extractedTextId: TEXT_DIGEST,
      mediaType: 'application/x-not-allowed',
      name,
      bytes: -1,
      extractedBytes: Number.MAX_SAFE_INTEGER + 1,
      truncated: 'yes',
    })
    appendExtension(session, 'plugin/malformed-document', {
      payload: {
        type: 'document',
        attachment: malformedAttachment('x'.repeat(300)),
      },
      fallback: { type: 'document', attachment: malformedAttachment(42) },
      blank: { type: 'document', attachment: malformedAttachment('\u0000\n') },
      unicode: { type: 'document', attachment: malformedAttachment(`${'a'.repeat(254)}😀`) },
    })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })

    const history = await api.sessions.history(request({ sessionId: session.id }))
    expect(history.result.ok).toBe(true)
    if (!history.result.ok) return
    const event = history.result.value.events[0]?.event as unknown as {
      data: {
        payload: { attachment: Record<string, unknown> }
        fallback: { attachment: Record<string, unknown> }
        blank: { attachment: Record<string, unknown> }
        unicode: { attachment: Record<string, unknown> }
      }
    }
    const attachment = event.data.payload.attachment
    expect(attachment['displayId']).toMatch(/^document-view:/u)
    expect(attachment).toEqual({
      displayId: attachment['displayId'],
      name: 'x'.repeat(255),
      mediaType: 'text/plain',
      bytes: 0,
      extractedBytes: 0,
      truncated: false,
    })
    expect(JSON.stringify(event)).not.toContain(String(SOURCE_DIGEST))
    expect(JSON.stringify(event)).not.toContain(String(TEXT_DIGEST))
    expect(event.data.fallback.attachment['name']).toBe('document')
    expect(event.data.blank.attachment['name']).toBe('document')
    expect(event.data.unicode.attachment['name']).toBe('a'.repeat(254))

    await ctx.fiber.dispose()
  })
})
