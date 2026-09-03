/** Host-owned projection that strips durable document read authority before renderer transport. */

import { createHmac, randomBytes } from 'node:crypto'
import {
  DOCUMENT_MEDIA_TYPES,
  type DocumentAttachmentDisplayId,
  type DocumentAttachmentRef,
  type RendererDocumentAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionWireEvent } from './types.ts'

const DISPLAY_KEY = randomBytes(32)
const CONTENT_ADDRESS = /^sha256:[0-9a-f]{64}$/u
const DOCUMENT_MEDIA_TYPE_SET = new Set<string>(DOCUMENT_MEDIA_TYPES)
const MAX_DOCUMENT_NAME_BYTES = 255

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function durableAttachment(value: Record<string, unknown>): Record<string, unknown> | null {
  if (value['type'] !== 'document') return null
  const attachment = recordOf(value['attachment'])
  if (attachment === null) return null
  return typeof attachment['attachmentId'] === 'string'
    && CONTENT_ADDRESS.test(attachment['attachmentId'])
    && typeof attachment['extractedTextId'] === 'string'
    && CONTENT_ADDRESS.test(attachment['extractedTextId'])
    ? attachment
    : null
}

function byteCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function documentName(value: unknown): string {
  if (typeof value !== 'string') return 'document'
  const clean = value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/gu, '').trim()
  if (clean.length === 0) return 'document'
  const bytes = new TextEncoder().encode(clean)
  if (bytes.byteLength <= MAX_DOCUMENT_NAME_BYTES) return clean
  let end = MAX_DOCUMENT_NAME_BYTES
  while (end > 0 && ((bytes[end] as number) & 0xc0) === 0x80) end -= 1
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end))
}

function displayId(
  sessionId: SessionId,
  owner: string,
  path: readonly (string | number)[],
): DocumentAttachmentDisplayId {
  return `document-view:${createHmac('sha256', DISPLAY_KEY)
    .update(JSON.stringify([String(sessionId), owner, path]))
    .digest('base64url')}` as DocumentAttachmentDisplayId
}

function rendererDocument(
  attachment: Record<string, unknown>,
  sessionId: SessionId,
  owner: string,
  path: readonly (string | number)[],
): { readonly type: 'document'; readonly attachment: RendererDocumentAttachment } {
  const mediaType = typeof attachment['mediaType'] === 'string'
    && DOCUMENT_MEDIA_TYPE_SET.has(attachment['mediaType'])
    ? attachment['mediaType'] as DocumentAttachmentRef['mediaType']
    : 'text/plain'
  return {
    type: 'document',
    attachment: {
      displayId: displayId(sessionId, owner, path),
      name: documentName(attachment['name']),
      mediaType,
      bytes: byteCount(attachment['bytes']),
      extractedBytes: byteCount(attachment['extractedBytes']),
      truncated: attachment['truncated'] === true,
    },
  }
}

/**
 * Deep-project one already JSON-validated carrier.
 * Content-address predicates avoid rewriting unrelated plugin display objects.
 */
export function rendererValue(
  value: unknown,
  sessionId: SessionId,
  owner: string,
  path: readonly (string | number)[] = [],
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item, index) => rendererValue(item, sessionId, owner, [...path, index]))
  }
  const record = recordOf(value)
  if (record === null) return value as JsonValue
  const attachment = durableAttachment(record)
  if (attachment !== null) {
    return rendererDocument(attachment, sessionId, owner, path) as unknown as JsonValue
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [
    key,
    rendererValue(item, sessionId, owner, [...path, key]),
  ])) as JsonValue
}

/** Project one durable Session event to its authority-free renderer wire form. */
export function rendererSessionEvent(sessionId: SessionId, event: {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  readonly ignorable?: true
  readonly sourceEventSeqs?: number[]
  readonly surfaceOp?: unknown
}): SessionWireEvent {
  return rendererValue(event, sessionId, `event:${String(event.seq)}`) as unknown as SessionWireEvent
}
