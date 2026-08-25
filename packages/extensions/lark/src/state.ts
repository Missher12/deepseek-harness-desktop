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

/** Paired single-owner state schema. */
export const ownerRecordSchema = z.object({
  id: z.literal('owner'),
  openId: opaqueId,
  chatId: opaqueId,
  generation,
  pairedAt: safeTime,
  updatedAt: safeTime,
})
/** Paired single-owner state. */
export type OwnerRecord = z.infer<typeof ownerRecordSchema>

/** Accepted fast-path event marker schema. */
export const eventRecordSchema = z.object({
  id: opaqueId,
  receivedAt: safeTime,
})
/** Accepted fast-path event marker. */
export type EventRecord = z.infer<typeof eventRecordSchema>

/** Exact owner/project/Session binding schema. */
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
/** Exact owner/project/Session binding. */
export type BindingRecord = z.infer<typeof bindingRecordSchema>

const imageAttachmentSchema = z.object({
  kind: z.literal('image'),
  attachment: z.object({
    attachmentId: opaqueId,
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    width: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    name: z.string().min(1).max(512).optional(),
    originalDimensions: z.object({
      width: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    }).optional(),
  }),
})

const fileAttachmentSchema = z.object({
  kind: z.literal('file'),
  id: opaqueId,
  path: absolutePrivatePath,
  name: z.string().min(1).max(512),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: safeTime,
})

/** Durable image reference or private staged-file fact schema. */
export const queueAttachmentSchema = z.discriminatedUnion('kind', [
  imageAttachmentSchema, fileAttachmentSchema,
])
/** Durable image reference or private staged-file fact. */
export type QueueAttachment = z.infer<typeof queueAttachmentSchema>

const queueCommon = z.object({
  id: opaqueId,
  eventId: opaqueId,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  bindingGeneration: generation,
  sessionId: opaqueId,
  harnessMessageId: opaqueId,
  text: z.string().max(128 * 1024),
  attachments: z.array(queueAttachmentSchema).max(20).optional(),
  createdAt: safeTime,
  updatedAt: safeTime,
  attempts: z.number().int().nonnegative().max(100).default(0),
})

/** Strict durable FIFO record schema. */
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
/** Strict durable FIFO record. */
export type QueueRecord = z.infer<typeof queueRecordSchema>

/** Streamed card metadata schema. */
export const cardRecordSchema = z.object({
  id: opaqueId,
  sessionId: opaqueId,
  messageId: opaqueId,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(['placeholder', 'streaming', 'completed', 'failed']),
  createdAt: safeTime,
  updatedAt: safeTime,
})
/** Streamed card metadata. */
export type CardRecord = z.infer<typeof cardRecordSchema>

/** State-backed one-use callback action schema. */
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
/** State-backed one-use callback action. */
export type CallbackNonceRecord = z.infer<typeof callbackNonceRecordSchema>

/** Private expiring generic-file metadata schema. */
export const stagedFileRecordSchema = z.object({
  id: opaqueId,
  path: absolutePrivatePath,
  name: z.string().min(1).max(512),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: safeTime,
  createdAt: safeTime,
})
/** Private expiring generic-file metadata. */
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
