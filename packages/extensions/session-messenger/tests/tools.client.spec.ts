import { Context } from '@deepseek-ai/cordis'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it, vi } from 'vitest'
import {
  activateSessionMessenger,
  createSessionMessengerToolDefinitions,
  registerSessionMessengerTools,
} from '../src/tools.ts'
import { DeliveryId } from '../src/types.ts'
import { fakeAgent } from './helpers.client.ts'

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
  it('registers exactly five global tools with no caller-controlled sender parameter', async () => {
    const ctx = await toolContext()
    const coordinator = { deliver: vi.fn(), replyToDelivery: vi.fn(), stopCollaboration: vi.fn() }
    const waiter = { wait: vi.fn(), dispose: vi.fn() }
    const dispose = registerSessionMessengerTools(
      ctx,
      () => coordinator,
      () => waiter,
    )

    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'send_message_to_session',
      'send_message_to_session_and_wait',
      'reply_to_session',
      'wait_for_session_reply',
      'stop_session_collaboration',
    ])
    for (const schema of ctx.tools.schemas()) {
      const properties = (schema.parameters as { properties?: Record<string, unknown> }).properties ?? {}
      expect(properties).not.toHaveProperty('sender')
      expect(properties).not.toHaveProperty('source_session_id')
    }
    const reply = ctx.tools.schemas().find(schema => schema.name === 'reply_to_session')!
    expect((reply.parameters as { required?: string[] }).required).toEqual([
      'delivery_id', 'message',
    ])
    expect((reply.parameters as { properties?: Record<string, unknown> }).properties)
      .not.toHaveProperty('reply_token')

    dispose()
  })

  it('forwards the exact collaboration receipt to the stop boundary', async () => {
    const ctx = await toolContext()
    const caller = fakeAgent('caller')
    const stopCollaboration = vi.fn().mockResolvedValue({
      deliveryId: DeliveryId('delivery-2'),
      rootDeliveryId: DeliveryId('delivery-1'),
      status: 'stopped',
      stoppedAt: 1_000,
    })
    registerSessionMessengerTools(
      ctx,
      () => ({ deliver: vi.fn(), replyToDelivery: vi.fn(), stopCollaboration }),
      () => ({ wait: vi.fn() }),
    )

    const result = await ctx.tools.execute({
      callId: ToolCallId('stop'), signal, agent: caller,
      name: 'stop_session_collaboration', arguments: { delivery_id: 'delivery-2' },
    })

    expect(stopCollaboration).toHaveBeenCalledWith(caller, DeliveryId('delivery-2'))
    expect(result.value).toMatchObject({ status: 'stopped', rootDeliveryId: 'delivery-1' })
  })

  it('wakes the target for sends and performs one receipt-bound collaboration wait', async () => {
    const ctx = await toolContext()
    const caller = fakeAgent('caller')
    const waitResult = {
      deliveryId: DeliveryId('delivery-2'), messageId: MessageId('reply-message'),
      status: 'replied', wakeRequested: true, errorCode: null, replyDeliveryId: DeliveryId('reply-2'),
    }
    const wait = vi.fn().mockResolvedValue(waitResult)
    const coordinator = {
      deliver: vi.fn()
        .mockResolvedValueOnce(result({ wakeRequested: true }))
        .mockResolvedValueOnce(result({ deliveryId: DeliveryId('delivery-2'), wakeRequested: true })),
      replyToDelivery: vi.fn(),
      stopCollaboration: vi.fn(),
    }
    registerSessionMessengerTools(ctx, () => coordinator, () => ({ wait }))

    const sent = await ctx.tools.execute({
      callId: ToolCallId('send'), signal, agent: caller,
      name: 'send_message_to_session', arguments: { target_session_id: 'target', message: 'wake' },
    })
    const collaborated = await ctx.tools.execute({
      callId: ToolCallId('collaborate'), signal, agent: caller,
      name: 'send_message_to_session_and_wait',
      arguments: { target_session_id: 'target', message: 'solve this', timeout_ms: 4_000 },
    })

    expect(coordinator.deliver).toHaveBeenNthCalledWith(1, caller, {
      targetSessionId: 'target', message: 'wake', mode: 'followup',
    }, signal)
    expect(coordinator.deliver).toHaveBeenNthCalledWith(2, caller, {
      targetSessionId: 'target', message: 'solve this', mode: 'followup',
    }, signal)
    expect(wait).toHaveBeenCalledWith(caller, DeliveryId('delivery-2'), 4_000, signal)
    expect(sent.value).toMatchObject({ status: 'delivered', errorCode: null, wakeRequested: true })
    expect(collaborated.value).toEqual(waitResult)
  })

  it('publishes one Codex-style collaboration protocol section while enabled', async () => {
    const ctx = await toolContext()
    const dispose = registerSessionMessengerTools(
      ctx,
      () => ({ deliver: vi.fn(), replyToDelivery: vi.fn(), stopCollaboration: vi.fn() }),
      () => ({ wait: vi.fn() }),
    )

    const section = (await ctx.systemPrompt.assemble()).sections
      .find(candidate => candidate.name === 'tool:session-collaboration')
    expect(section?.text).toContain('send_message_to_session_and_wait')
    expect(section?.text).toContain('reply_to_session')
    expect(section?.text).toContain('Delivery ID')
    expect(section?.text).toContain('Either ordinary session may initiate')

    dispose()
    expect((await ctx.systemPrompt.assemble()).sections
      .some(candidate => candidate.name === 'tool:session-collaboration')).toBe(false)
  })

  it('returns a stable caller-required value instead of guessing identity', async () => {
    const ctx = await toolContext()
    const coordinator = { deliver: vi.fn(), replyToDelivery: vi.fn(), stopCollaboration: vi.fn() }
    registerSessionMessengerTools(ctx, () => coordinator, () => ({ wait: vi.fn() }))

    const rejected = await ctx.tools.execute({
      callId: ToolCallId('missing'), signal,
      name: 'send_message_to_session', arguments: { target_session_id: 'target', message: 'hello' },
    })

    expect(rejected.value).toEqual({
      deliveryId: null,
      messageId: null,
      status: 'rejected',
      wakeRequested: true,
      errorCode: 'caller-required',
    })
    expect(coordinator.deliver).not.toHaveBeenCalled()
  })

  it('binds a reply to caller identity and delivery id without exposing a reply token', async () => {
    const ctx = await toolContext()
    const caller = fakeAgent('target')
    const replyToDelivery = vi.fn().mockResolvedValue(result())
    registerSessionMessengerTools(
      ctx,
      () => ({ deliver: vi.fn(), replyToDelivery, stopCollaboration: vi.fn() }),
      () => ({ wait: vi.fn() }),
    )

    const replied = await ctx.tools.execute({
      callId: ToolCallId('reply'), signal, agent: caller,
      name: 'reply_to_session',
      arguments: { delivery_id: 'delivery-1', message: 'answer' },
    })

    expect(replyToDelivery).toHaveBeenCalledWith(caller, {
      deliveryId: DeliveryId('delivery-1'), message: 'answer', wake: true,
    }, signal)
    expect(replied.value).toMatchObject({ status: 'delivered', errorCode: null })
  })

  it('sets the explicit wait tool budget to 60 seconds and forwards exec.signal', async () => {
    const caller = fakeAgent('caller')
    const forwarded = vi.fn().mockResolvedValue({
      deliveryId: DeliveryId('delivery-1'), messageId: MessageId('message-1'),
      status: 'wait-timeout', wakeRequested: false, errorCode: 'wait-timeout', replyDeliveryId: null,
    })
    const definitions = createSessionMessengerToolDefinitions(
      () => ({ deliver: vi.fn(), replyToDelivery: vi.fn(), stopCollaboration: vi.fn() }),
      () => ({ wait: forwarded }),
    )
    expect(definitions[3].timeoutMs).toBe(60_000)

    const ctx = await toolContext()
    for (const definition of definitions) ctx.tools.register(definition)
    await ctx.tools.execute({
      callId: ToolCallId('wait'), signal, agent: caller,
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
      deliver: vi.fn(), replyToDelivery: vi.fn(), receipt: vi.fn(), subscribe: vi.fn(() => vi.fn()),
    }
    const activation = activateSessionMessenger(ctx, (() => opening) as never)

    const waiting = await ctx.tools.execute({
      callId: ToolCallId('activation-window'), signal, agent: fakeAgent('caller'),
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
