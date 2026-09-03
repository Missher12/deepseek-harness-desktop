import { z } from 'zod'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import {
  DeliveryId,
  ReplyToken,
  type Receipt,
} from './types.ts'

/** Largest accepted relay body after UTF-8 encoding. */
export const MAX_MESSAGE_BYTES = 16 * 1024
/** Default and durable receipt lifetime. */
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000
/** Largest permitted reply-chain hop. */
export const MAX_HOP = 8

const safeTime = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const deliveryIdSchema = z.string().min(1).max(256).transform(DeliveryId)
const sessionIdSchema = z.string().min(1).max(256).transform(value => value as SessionId)
const messageIdSchema = z.string().min(1).max(256).transform(value => value as MessageId)
const replyTokenSchema = z.string().min(1).max(256).transform(ReplyToken)

/** Durable reconstruction body with a byte-accurate UTF-8 limit. */
export const relayEnvelopeSchema = z.object({
  body: z.string().refine(value => new TextEncoder().encode(value).byteLength <= MAX_MESSAGE_BYTES, {
    message: `relay message must not exceed ${MAX_MESSAGE_BYTES} UTF-8 bytes`,
  }),
})

const common = z.object({
  id: deliveryIdSchema,
  sourceSessionId: sessionIdSchema,
  targetSessionId: sessionIdSchema,
  messageId: messageIdSchema,
  mode: z.enum(['inject', 'followup']),
  createdAt: safeTime,
  updatedAt: safeTime,
  expiresAt: safeTime,
  replyToken: replyTokenSchema,
  hop: z.number().int().min(0).max(MAX_HOP),
  wakeRequested: z.boolean(),
  replyToDeliveryId: deliveryIdSchema.optional(),
  continuationOfDeliveryId: deliveryIdSchema.optional(),
  collaborationStoppedAt: safeTime.optional(),
})

const recoverable = [
  common.extend({
    status: z.literal('prepared'),
    envelope: relayEnvelopeSchema,
  }),
  common.extend({
    status: z.literal('delivery-recovery-pending'),
    envelope: relayEnvelopeSchema,
    recoveryReason: z.string().min(1).max(256),
  }),
] as const

const bodyless = [
  common.extend({ status: z.literal('delivered'), deliveredAt: safeTime }),
  common.extend({ status: z.literal('claimed'), deliveredAt: safeTime, claimedAt: safeTime }),
  common.extend({
    status: z.literal('replied'),
    deliveredAt: safeTime,
    repliedAt: safeTime,
    replyDeliveryId: deliveryIdSchema,
  }),
  ...(['discarded', 'failed', 'aborted', 'rejected', 'expired'] as const).map(status => common.extend({
    status: z.literal(status),
    settledAt: safeTime,
    errorCode: z.string().min(1).max(128),
  })),
] as const

/** Version-1 durable receipt union. Unknown fields are stripped at the boundary. */
export const receiptSchema = z.discriminatedUnion('status', [...recoverable, ...bodyless])
  .superRefine((receipt, ctx) => {
    if (receipt.expiresAt !== receipt.createdAt + RECEIPT_TTL_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: `receipt lifetime must be exactly ${RECEIPT_TTL_MS} milliseconds`,
      })
    }
    if (receipt.updatedAt < receipt.createdAt) {
      ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: 'updatedAt precedes createdAt' })
    }
  }) as z.ZodType<Receipt>

/** Plugin-owned versioned receipt domain. */
export const sessionMessengerDomainSpec = defineDomain({
  name: 'session_messenger',
  version: 1,
  tables: { receipts: domainTable<DeliveryId, Receipt>(receiptSchema) },
})
