import { Context } from '@deepseek-ai/cordis'
import { CallId, MessageId } from '@deepseek-ai/dsh-llm'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it, vi } from 'vitest'
import {
  activateSessionMessenger,
  createSessionMessengerToolDefinitions,
  registerSessionMessengerTools,
} from '../src/tools.ts'
import { DeliveryId } from '../src/types.ts'
import { fakeAgent } from './helpers.ts'

const signal = new AbortController().signal

async function toolContext() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    deliveryId: DeliveryId('delivery-1'),
    messageId: MessageId('message-1'),
    status: 'delivered' as const,
    wakeRequested: false,
    ...overrides,
  }
}

describe('session messenger tools', () => {
  it('registers exactly four global tools with no caller-controlled sender parameter', async () => {
    const ctx = await toolContext()
    const coordinator = { deliver: vi.fn(), reply: vi.fn() }
    const waiter = { wait: vi.fn(), dispose: vi.fn() }
    const dispose = registerSessionMessengerTools(
      ctx,
      () => coordinator,
      () => waiter,
    )

    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'send_message_to_session',
      'followup_session',
      'reply_to_session',
      'wait_for_session_reply',
    ])
    for (const schema of ctx.tools.schemas()) {
      const properties = (schema.parameters as { properties?: Record<string, unknown> }).properties ?? {}
      expect(properties).not.toHaveProperty('sender')
      expect(properties).not.toHaveProperty('source_session_id')
    }
    const reply = ctx.tools.schemas().find(schema => schema.name === 'reply_to_session')!
    expect((reply.parameters as { required?: string[] }).required).toEqual([
      'delivery_id', 'reply_token', 'message',
    ])

    dispose()
  })

  it('derives caller identity only from exec.agent and preserves send versus follow-up mode', async () => {
    const ctx = await toolContext()
    const caller = fakeAgent('caller')
    const coordinator = {
      deliver: vi.fn()
        .mockResolvedValueOnce(result())
        .mockResolvedValueOnce(result({ deliveryId: DeliveryId('delivery-2'), wakeRequested: true })),
      reply: vi.fn(),
    }
    registerSessionMessengerTools(ctx, () => coordinator, () => ({ wait: vi.fn() }))

    const sent = await ctx.tools.execute({
      callId: CallId('send'), signal, agent: caller,
      name: 'send_message_to_session', arguments: { target_session_id: 'target', message: 'quiet' },
    })
    const followed = await ctx.tools.execute({
      callId: CallId('follow'), signal, agent: caller,
      name: 'followup_session', arguments: { target_session_id: 'target', message: 'wake' },
    })

    expect(coordinator.deliver).toHaveBeenNthCalledWith(1, caller, {
      targetSessionId: 'target', message: 'quiet', mode: 'inject',
    }, signal)
    expect(coordinator.deliver).toHaveBeenNthCalledWith(2, caller, {
      targetSessionId: 'target', message: 'wake', mode: 'followup',
    }, signal)
    expect(sent.value).toMatchObject({ status: 'delivered', errorCode: null, wakeRequested: false })
    expect(followed.value).toMatchObject({ status: 'delivered', errorCode: null, wakeRequested: true })
  })

  it('returns a stable caller-required value instead of guessing identity', async () => {
    const ctx = await toolContext()
    const coordinator = { deliver: vi.fn(), reply: vi.fn() }
    registerSessionMessengerTools(ctx, () => coordinator, () => ({ wait: vi.fn() }))

    const rejected = await ctx.tools.execute({
      callId: CallId('missing'), signal,
      name: 'send_message_to_session', arguments: { target_session_id: 'target', message: 'hello' },
    })

    expect(rejected.value).toEqual({
      deliveryId: null,
      messageId: null,
      status: 'rejected',
      wakeRequested: false,
      errorCode: 'caller-required',
    })
    expect(coordinator.deliver).not.toHaveBeenCalled()
  })

  it('sets the explicit wait tool budget to 60 seconds and forwards exec.signal', async () => {
    const caller = fakeAgent('caller')
    const forwarded = vi.fn().mockResolvedValue({
      deliveryId: DeliveryId('delivery-1'), messageId: MessageId('message-1'),
      status: 'wait-timeout', wakeRequested: false, errorCode: 'wait-timeout', replyDeliveryId: null,
    })
    const definitions = createSessionMessengerToolDefinitions(
      () => ({ deliver: vi.fn(), reply: vi.fn() }),
      () => ({ wait: forwarded }),
    )
    expect(definitions[3].timeoutMs).toBe(60_000)

    const ctx = await toolContext()
    for (const definition of definitions) ctx.tools.register(definition)
    await ctx.tools.execute({
      callId: CallId('wait'), signal, agent: caller,
      name: 'wait_for_session_reply', arguments: { delivery_id: 'delivery-1', timeout_ms: 4_000 },
    })
    expect(forwarded).toHaveBeenCalledWith(caller, DeliveryId('delivery-1'), 4_000, signal)
  })

  it('fails a name collision before the coordinator factory can open or mutate storage', async () => {
    const ctx = await toolContext()
    ctx.tools.register(defineTool({
      name: 'send_message_to_session', description: 'collision', parameters: {},
      output: { schema: { type: 'null' }, render: () => [] },
      execute: () => Promise.resolve(null),
    }))
    const createCoordinator = vi.fn()

    await expect(activateSessionMessenger(ctx, createCoordinator as never)).rejects.toThrow()
    expect(createCoordinator).not.toHaveBeenCalled()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['send_message_to_session'])
  })

  it('returns canonical disposed during async activation and later returns the coordinator', async () => {
    const ctx = await toolContext()
    let release!: (coordinator: unknown) => void
    const opening = new Promise<unknown>((resolve) => { release = resolve })
    const coordinator = {
      deliver: vi.fn(), reply: vi.fn(), receipt: vi.fn(), subscribe: vi.fn(() => vi.fn()),
    }
    const activation = activateSessionMessenger(ctx, (() => opening) as never)

    const waiting = await ctx.tools.execute({
      callId: CallId('activation-window'), signal, agent: fakeAgent('caller'),
      name: 'wait_for_session_reply', arguments: { delivery_id: 'delivery-1' },
    })
    expect(waiting.isError).toBe(false)
    expect(waiting.value).toEqual({
      deliveryId: DeliveryId('delivery-1'),
      messageId: null,
      status: 'disposed',
      wakeRequested: false,
      errorCode: 'disposed',
      replyDeliveryId: null,
    })

    release(coordinator)
    await expect(activation).resolves.toBe(coordinator)
  })
})
