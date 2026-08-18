/** Four global model-facing adapters over the durable session messenger core. */
import type { Context } from '@deepseek-ai/cordis'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  createSessionMessengerCoordinator,
  type DeliveryResult,
  type SessionMessengerCoordinator,
} from './coordinator.ts'
import {
  createContextTargetAvailabilityPolicy,
  SessionReplyWaiter,
  type ReplyWaitResult,
} from './waits.ts'
import {
  DeliveryId,
  MessengerError,
  type MessengerErrorCode,
} from './types.ts'

/** Tool-facing coordinator seam used by unit tests and activation ordering. */
export interface MessengerToolCoordinator {
  deliver: SessionMessengerCoordinator['deliver']
  replyToDelivery: SessionMessengerCoordinator['replyToDelivery']
}

/** Tool-facing wait seam. */
export interface MessengerToolWaiter {
  wait: SessionReplyWaiter['wait']
}

/** Canonical send/reply value. Secret reply tokens are intentionally absent. */
export interface MessengerToolValue {
  readonly deliveryId: DeliveryId | null
  readonly messageId: MessageId | null
  readonly status: string
  readonly wakeRequested: boolean
  readonly errorCode: MessengerErrorCode | null
}

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    deliveryId: { required: true as const, oneOf: [{ type: 'string' as const }, { type: 'null' as const }] },
    messageId: { required: true as const, oneOf: [{ type: 'string' as const }, { type: 'null' as const }] },
    status: { type: 'string' as const, required: true as const },
    wakeRequested: { type: 'boolean' as const, required: true as const },
    errorCode: { required: true as const, oneOf: [{ type: 'string' as const }, { type: 'null' as const }] },
  },
} as const

const WAIT_OUTPUT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    ...OUTPUT_SCHEMA.properties,
    replyDeliveryId: { required: true as const, oneOf: [{ type: 'string' as const }, { type: 'null' as const }] },
  },
} as const

/**
 * Build all definitions without registering or opening durable storage.
 * @param coordinator - lazy accessor for the activated delivery coordinator.
 * @param waiter - lazy accessor for the activated reply waiter.
 * @returns the four global session-messenger Tool definitions.
 */
export function createSessionMessengerToolDefinitions(
  coordinator: () => MessengerToolCoordinator,
  waiter: () => MessengerToolWaiter,
): readonly [ToolDefinition, ToolDefinition, ToolDefinition, ToolDefinition] {
  return [
    defineTool({
      name: 'send_message_to_session',
      description: 'Inject a message into another ordinary DeepSeek Harness session without waking it. Use the exact copied session id.',
      parameters: {
        target_session_id: { type: 'string', required: true, description: 'Exact ordinary target session id.' },
        message: { type: 'string', required: true, description: 'Message body, up to 16 KiB UTF-8.' },
      },
      output: { schema: OUTPUT_SCHEMA, render: renderDelivery },
      async execute(args, exec): Promise<MessengerToolValue> {
        const caller = exec.agent
        if (caller === undefined) return failure('caller-required', false)
        try {
          return success(await coordinator().deliver(caller, {
            targetSessionId: args.target_session_id,
            message: args.message,
            mode: 'inject',
          }, exec.signal))
        } catch (error: unknown) {
          return failure(codeOf(error), false)
        }
      },
    }),
    defineTool({
      name: 'followup_session',
      description: 'Queue a message as the next turn of another ordinary DeepSeek Harness session and wake it when possible.',
      parameters: {
        target_session_id: { type: 'string', required: true, description: 'Exact ordinary target session id.' },
        message: { type: 'string', required: true, description: 'Message body, up to 16 KiB UTF-8.' },
      },
      output: { schema: OUTPUT_SCHEMA, render: renderDelivery },
      async execute(args, exec): Promise<MessengerToolValue> {
        const caller = exec.agent
        if (caller === undefined) return failure('caller-required', true)
        try {
          return success(await coordinator().deliver(caller, {
            targetSessionId: args.target_session_id,
            message: args.message,
            mode: 'followup',
          }, exec.signal))
        } catch (error: unknown) {
          return failure(codeOf(error), true)
        }
      },
    }),
    defineTool({
      name: 'reply_to_session',
      description: 'Reply once to a cross-session delivery using its exact delivery id. The destination and one-use authority are derived from the Host receipt.',
      parameters: {
        delivery_id: { type: 'string', required: true, description: 'Delivery id shown in the received relay.' },
        message: { type: 'string', required: true, description: 'Reply body, up to 16 KiB UTF-8.' },
        wake: { type: 'boolean', description: 'Wake the original session. Defaults to false.' },
      },
      output: { schema: OUTPUT_SCHEMA, render: renderDelivery },
      async execute(args, exec): Promise<MessengerToolValue> {
        const caller = exec.agent
        const wake = args.wake ?? false
        if (caller === undefined) return failure('caller-required', wake)
        try {
          return success(await coordinator().replyToDelivery(caller, {
            deliveryId: DeliveryId(args.delivery_id),
            message: args.message,
            wake,
          }, exec.signal))
        } catch (error: unknown) {
          return failure(codeOf(error), wake)
        }
      },
    }),
    defineTool({
      name: 'wait_for_session_reply',
      description: 'Wait only for the reply bound to one delivery receipt. Unrelated assistant output and Agent idleness do not complete this wait.',
      parameters: {
        delivery_id: { type: 'string', required: true, description: 'Original delivery id returned by send or follow-up.' },
        timeout_ms: { type: 'integer', description: 'Wait between 1000 and 55000 ms. Defaults to 30000.' },
      },
      output: { schema: WAIT_OUTPUT_SCHEMA, render: renderWait },
      timeoutMs: 60_000,
      async execute(args, exec): Promise<ReplyWaitResult> {
        const deliveryId = DeliveryId(args.delivery_id)
        const caller = exec.agent
        if (caller === undefined) {
          return {
            deliveryId,
            messageId: null,
            status: 'rejected',
            wakeRequested: false,
            errorCode: 'caller-required',
            replyDeliveryId: null,
          }
        }
        try {
          return await waiter().wait(caller, deliveryId, args.timeout_ms, exec.signal)
        } catch (error: unknown) {
          const errorCode = codeOf(error)
          return {
            deliveryId,
            messageId: null,
            status: errorCode === 'disposed' ? 'disposed' : 'rejected',
            wakeRequested: false,
            errorCode,
            replyDeliveryId: null,
          }
        }
      },
    }),
  ] as const
}

/**
 * Register exactly four names, rolling back partial registration on collision.
 * @param ctx - Cordis context providing the global Tool registry.
 * @param coordinator - lazy accessor for the activated delivery coordinator.
 * @param waiter - lazy accessor for the activated reply waiter.
 * @returns an idempotent disposer for every registered Tool definition.
 */
export function registerSessionMessengerTools(
  ctx: Context,
  coordinator: () => MessengerToolCoordinator,
  waiter: () => MessengerToolWaiter,
): () => void {
  const disposers: Array<() => void> = []
  try {
    for (const definition of createSessionMessengerToolDefinitions(coordinator, waiter)) {
      disposers.push(ctx.tools.register(definition))
    }
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const dispose of disposers.reverse()) dispose()
  }
}

/**
 * Register names first, then open/recover storage so collisions have zero durable side effects.
 * @param ctx - Cordis context providing Tools, storage, Agents, and lifecycle ownership.
 * @param createCoordinator - injectable coordinator factory used by production and tests.
 * @returns the activated, recovered session-messenger coordinator.
 */
export async function activateSessionMessenger(
  ctx: Context,
  createCoordinator: (ctx: Context) => Promise<SessionMessengerCoordinator> = createSessionMessengerCoordinator,
): Promise<SessionMessengerCoordinator> {
  let coordinator: SessionMessengerCoordinator | undefined
  let waiter: SessionReplyWaiter | undefined
  const getCoordinator = (): SessionMessengerCoordinator => {
    if (coordinator === undefined) throw new MessengerError('disposed', 'session messenger is not ready')
    return coordinator
  }
  const getWaiter = (): SessionReplyWaiter => {
    if (waiter === undefined) throw new MessengerError('disposed', 'session messenger is not ready')
    return waiter
  }
  const disposeTools = registerSessionMessengerTools(ctx, getCoordinator, getWaiter)
  try {
    coordinator = await createCoordinator(ctx)
    waiter = new SessionReplyWaiter(coordinator, createContextTargetAvailabilityPolicy(ctx))
  } catch (error: unknown) {
    disposeTools()
    throw error
  }
  ctx.effect(() => () => {
    waiter.dispose()
    disposeTools()
  }, 'session-messenger: global tools and explicit waits')
  return coordinator
}

function success(result: DeliveryResult): MessengerToolValue {
  return { ...result, errorCode: null }
}

function failure(errorCode: MessengerErrorCode, wakeRequested: boolean): MessengerToolValue {
  return { deliveryId: null, messageId: null, status: 'rejected', wakeRequested, errorCode }
}

function codeOf(error: unknown): MessengerErrorCode {
  return error instanceof MessengerError ? error.code : 'delivery-failed'
}

function renderDelivery(_args: unknown, value: MessengerToolValue) {
  const text = value.errorCode === null
    ? `${value.status}: ${value.deliveryId}`
    : `session message rejected: ${value.errorCode}`
  return [{ type: 'text' as const, text }]
}

function renderWait(_args: unknown, value: ReplyWaitResult) {
  const text = value.errorCode === null
    ? `reply received for ${value.deliveryId}`
    : `reply wait settled: ${value.errorCode}`
  return [{ type: 'text' as const, text }]
}
