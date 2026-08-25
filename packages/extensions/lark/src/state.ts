import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const safeTime = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const opaqueId = z.string().min(1).max(256)
const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const absolutePrivatePath = z.string().min(1).max(4096).refine(
  value => (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value))
    && !value.split(/[\\/]+/).includes('..')
    && !value.includes('\0'),
  'staged path must be absolute and traversal-free',
)

export const ownerRecordSchema = z.object({
  id: z.literal('owner'),
  openId: opaqueId,
  chatId: opaqueId,
  generation,
  pairedAt: safeTime,
  updatedAt: safeTime,
})
export type OwnerRecord = z.infer<typeof ownerRecordSchema>

export const eventRecordSchema = z.object({
  id: opaqueId,
  receivedAt: safeTime,
})
export type EventRecord = z.infer<typeof eventRecordSchema>

export const bindingRecordSchema = z.object({
  id: z.literal('owner'),
  ownerOpenId: opaqueId,
  chatId: opaqueId,
  projectPath: absolutePrivatePath,
  workspaceId: opaqueId.optional(),
  sessionId: opaqueId,
  generation,
  state: z.enum(['active', 'paused']),
  boundAt: safeTime,
  updatedAt: safeTime,
})
export type BindingRecord = z.infer<typeof bindingRecordSchema>

const attachmentRefSchema = z.object({
  kind: z.enum(['image', 'file']),
  key: opaqueId,
  name: z.string().min(1).max(512),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})

const queueCommon = z.object({
  id: opaqueId,
  eventId: opaqueId,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  bindingGeneration: generation,
  sessionId: opaqueId,
  harnessMessageId: opaqueId,
  text: z.string().max(128 * 1024),
  attachments: z.array(attachmentRefSchema).max(20).optional(),
  createdAt: safeTime,
  updatedAt: safeTime,
  attempts: z.number().int().nonnegative().max(100).default(0),
})

export const queueRecordSchema = z.discriminatedUnion('status', [
  queueCommon.extend({ status: z.literal('prepared') }),
  queueCommon.extend({ status: z.literal('queued'), queuedAt: safeTime }),
  queueCommon.extend({
    status: z.literal('claimed'), queuedAt: safeTime, claimedAt: safeTime, turnId: opaqueId,
  }),
  queueCommon.extend({
    status: z.literal('terminal'), queuedAt: safeTime, claimedAt: safeTime,
    terminalAt: safeTime, turnId: opaqueId, outcome: z.enum(['completed', 'cancelled', 'failed']),
  }),
  queueCommon.extend({
    status: z.literal('paused'), pausedAt: safeTime, reason: z.string().min(1).max(256),
  }),
  queueCommon.extend({
    status: z.literal('cancelled'), cancelledAt: safeTime, reason: z.string().min(1).max(256),
  }),
])
export type QueueRecord = z.infer<typeof queueRecordSchema>

export const cardRecordSchema = z.object({
  id: opaqueId,
  sessionId: opaqueId,
  messageId: opaqueId,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(['placeholder', 'streaming', 'completed', 'failed']),
  createdAt: safeTime,
  updatedAt: safeTime,
})
export type CardRecord = z.infer<typeof cardRecordSchema>

export const callbackNonceRecordSchema = z.object({
  id: opaqueId,
  ownerOpenId: opaqueId,
  chatId: opaqueId,
  generation,
  action: z.enum(['select-project', 'select-session', 'approve-once', 'deny', 'resume', 'clear']),
  data: z.record(z.string().max(64), z.string().max(512))
    .refine(value => Object.keys(value).length <= 4).optional(),
  expiresAt: safeTime,
  createdAt: safeTime,
  usedAt: safeTime.optional(),
})
export type CallbackNonceRecord = z.infer<typeof callbackNonceRecordSchema>

export const stagedFileRecordSchema = z.object({
  id: opaqueId,
  path: absolutePrivatePath,
  name: z.string().min(1).max(512),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: safeTime,
  createdAt: safeTime,
})
export type StagedFileRecord = z.infer<typeof stagedFileRecordSchema>

/** Durable plugin state; credentials deliberately live outside this domain. */
export const larkDomainSpec = defineDomain({
  name: 'dsh_lark',
  version: 1,
  tables: {
    owners: domainTable<string, OwnerRecord>(ownerRecordSchema),
    events: domainTable<string, EventRecord>(eventRecordSchema),
    bindings: domainTable<string, BindingRecord>(bindingRecordSchema),
    inbox: domainTable<string, QueueRecord>(queueRecordSchema),
    cards: domainTable<string, CardRecord>(cardRecordSchema),
    nonces: domainTable<string, CallbackNonceRecord>(callbackNonceRecordSchema),
    files: domainTable<string, StagedFileRecord>(stagedFileRecordSchema),
  },
})
