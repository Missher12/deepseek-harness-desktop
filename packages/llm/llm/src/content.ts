/** Content-block structure helpers. @module @deepseek-ai/dsh-llm/content */

import type { ContentBlock, GenerateOptions } from './types.ts'
import type { Message } from './message.ts'
import type {
  AttachmentStore, DocumentAttachmentRef, ImageAttachmentRef, ImageMediaType, RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Model-facing stand-in for an image removed to fit a provider request bound. */
export const OFFLOADED_IMAGE_TEXT
  = '[image omitted to keep the request within its image limit; older images are omitted first. If this image is still needed, read its file again when a path is available; otherwise ask the user to attach it again.]'
/** Stable bounded replacement for a document excluded from one model request. */
export const OFFLOADED_DOCUMENT_TEXT
  = '[document omitted to keep the request within its document limits.]'

const DOCUMENT_PROJECTION_READ_CONCURRENCY = 2
const DOCUMENT_REQUEST_SAFETY_TOKENS = 1024
const UTF8_ENCODER = new TextEncoder()

/** Route-owned expansion allowance applied after verified document reads. */
export interface DocumentProjectionOptions {
  /** Additional tokens available beyond the fixed omission placeholders. */
  maxExpansionTokens?: number
}

/** Execution-world path that model tools can use to read one normalized attachment. */
export interface ImageAttachmentAccess {
  /** Absolute path to immutable normalized bytes; callers must treat it as read-only. */
  readonlyPath: string
}

/**
 * Resolve current execution-world access for one durable image reference.
 * @param ref - durable normalized attachment reference.
 * @returns a read-only execution-world path, or undefined when unavailable.
 */
export type ImageAttachmentAccessResolver = (ref: ImageAttachmentRef) => ImageAttachmentAccess | undefined

/**
 * Bridge one attachment provider's host object location into the mounted
 * tool execution world. The consumer supplies the current filesystem
 * provider's mapping without making attachment or LLM definitions depend on it.
 * @param attachments - provider that owns the normalized attachment object.
 * @param mapHostPath - map one absolute host path into the current tool execution world.
 * @param ref - durable normalized attachment reference.
 * @returns a read-only execution-world path, or undefined when either provider exposes no mapping.
 * @throws an attachment error when the durable reference is invalid.
 */
export function resolveImageAttachmentAccess(
  attachments: AttachmentStore,
  mapHostPath: (hostPath: string) => string | undefined,
  ref: ImageAttachmentRef,
): ImageAttachmentAccess | undefined {
  const hostPath = attachments.imageHostPath(ref)
  if (hostPath === undefined) return undefined
  const readonlyPath = mapHostPath(hostPath)
  return readonlyPath === undefined ? undefined : { readonlyPath }
}

function quoted(value: string): string {
  return JSON.stringify(value)
}

function imageIdentity(ref: ImageAttachmentRef): string {
  return ref.name === undefined
    ? String(ref.attachmentId)
    : `${quoted(ref.name)} (${ref.attachmentId})`
}

function extension(mediaType: ImageMediaType): string {
  switch (mediaType) {
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/webp': return '.webp'
    case 'image/gif': return '.gif'
    default: return assertNever(mediaType, 'image extension')
  }
}

function normalizedAccessText(ref: ImageAttachmentRef, access: ImageAttachmentAccess): string {
  return ` Normalized copy (read-only; may be resized or re-encoded): ${quoted(access.readonlyPath)} (${ref.width}x${ref.height}px, ${ref.mediaType}).`
    + ' Source dimensions, format, and byte size may differ.'
    + ` Copy to a writable path ending in ${extension(ref.mediaType)} before editing.`
}

/**
 * Stable text shown to a model that cannot accept one durable image reference.
 * @param ref - durable normalized attachment omitted from the request.
 * @returns deterministic text-only placeholder.
 */
export function textOnlyImageText(ref: ImageAttachmentRef): string {
  const digest = String(ref.attachmentId).slice('sha256:'.length, 'sha256:'.length + 8)
  return `[image omitted because this model accepts text only; attachment sha256:${digest}]`
}

/**
 * Stable model-facing handle for one exact request image. Identity comes from
 * the occurrence's own durable reference: request versions are prepared per
 * attachment id, so one shared version may serve occurrences whose display
 * names differ.
 * @param ref - the occurrence's durable normalized attachment.
 * @param version - exact request-image dimensions shown beside the text.
 * @param access - optional path resolved for the current tool execution world.
 * @returns attachment handle and request-image dimensions.
 */
export function requestImageHandleText(
  ref: ImageAttachmentRef,
  version: Pick<RequestImageAttachment, 'width' | 'height'>,
  access?: ImageAttachmentAccess,
): string {
  const preview = `Image ${imageIdentity(ref)}; request preview ${version.width}x${version.height}px.`
  return access === undefined
    ? `${preview} It may be resized or re-encoded; source dimensions, format, and byte size may differ.`
    : preview + normalizedAccessText(ref, access)
}

/**
 * Stable per-image placeholder for a request-limit omission.
 * @param ref - durable normalized attachment omitted from this request.
 * @param access - optional provider-resolved path for model tools.
 * @returns identity, normalized metadata, and the available recovery path.
 */
export function offloadedImageText(
  ref: ImageAttachmentRef,
  access?: ImageAttachmentAccess,
): string {
  const identity = `image omitted to fit request image limits; ${imageIdentity(ref)}.`
  if (access === undefined) {
    return `[${identity} No local normalized image path is available; ask the user to attach it again if needed.]`
  }
  return `[${identity}${normalizedAccessText(ref, access)}]`
}

/**
 * True when typed model content contains an image block, walking nested
 * tool-result content. This is the one recursive image walk shared by every
 * image policy (capability gating, text-only serialization, compaction
 * survey), so a consumer cannot silently diverge on nesting depth.
 * @param content - typed model content blocks.
 * @returns whether any nested block is an image.
 */
export function contentHasImage(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'image'
    || (block.type === 'tool-result' && contentHasImage(block.content)))
}

/**
 * Test typed model content for a document, including nested tool results.
 * @param content - typed model content blocks.
 * @returns whether any nested block is a document.
 */
export function contentHasDocument(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'document'
    || (block.type === 'tool-result' && contentHasDocument(block.content)))
}

/** Exact integrity and display identity used to deduplicate repeated document references. */
function documentRefKey(ref: DocumentAttachmentRef): string {
  return JSON.stringify([
    String(ref.attachmentId), String(ref.extractedTextId), ref.mediaType, ref.name,
    ref.bytes, ref.extractedBytes, ref.truncated,
  ])
}

interface DocumentOccurrence {
  key: string
  ref: DocumentAttachmentRef
  messageIndex: number
  included: boolean
}

/** Newest messages win; attachment order inside one message remains stable. */
function prioritizedDocumentOccurrences(
  occurrences: readonly DocumentOccurrence[],
): readonly DocumentOccurrence[] {
  return occurrences
    .map((occurrence, order) => ({ occurrence, order }))
    .sort((left, right) => (
      right.occurrence.messageIndex - left.occurrence.messageIndex
      || left.order - right.order
    ))
    .map(({ occurrence }) => occurrence)
}

/** Collect every projected occurrence in durable message order. */
function collectDocumentOccurrences(
  blocks: readonly ContentBlock[],
  occurrences: DocumentOccurrence[],
  messageIndex: number,
): void {
  for (const block of blocks) {
    if (block.type === 'document') {
      occurrences.push({
        key: documentRefKey(block.attachment),
        ref: block.attachment,
        messageIndex,
        included: false,
      })
    } else if (block.type === 'tool-result') {
      collectDocumentOccurrences(block.content, occurrences, messageIndex)
    }
  }
}

/** Select occurrences without exceeding any deployment-owned request budget. */
function planDocumentProjection(
  occurrences: DocumentOccurrence[],
  attachments: AttachmentStore,
): Map<string, DocumentAttachmentRef> {
  const limits = attachments.documentLimits
  const selected = new Map<string, DocumentAttachmentRef>()
  let count = 0
  let sourceBytes = 0
  let extractedBytes = 0
  for (const occurrence of prioritizedDocumentOccurrences(occurrences)) {
    const ref = occurrence.ref
    if (count >= limits.maxDocumentsPerMessage
      || ref.bytes > limits.maxMessageDocumentBytes - sourceBytes
      || ref.extractedBytes > limits.maxMessageExtractedTextBytes - extractedBytes) continue
    occurrence.included = true
    count += 1
    sourceBytes += ref.bytes
    extractedBytes += ref.extractedBytes
    selected.set(occurrence.key, ref)
  }
  return selected
}

/** UTF-8 bytes are a conservative upper bound for ordinary byte-token BPEs. */
function utf8TokenUpperBound(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength
}

/** JSON bytes for bounded metadata, preserving an upper-bound token estimate. */
function jsonTokenUpperBound(value: unknown): number {
  const json = JSON.stringify(value) as string | undefined
  return json === undefined ? 0 : utf8TokenUpperBound(json)
}

/** Model-request baseline with every document represented by its fixed placeholder. */
function baselineContentTokens(blocks: readonly ContentBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += utf8TokenUpperBound(block.text) + 32
        break
      case 'image':
        tokens += base64Length(block.attachment.bytes) + 256
        break
      case 'document':
        tokens += utf8TokenUpperBound(OFFLOADED_DOCUMENT_TEXT) + 32
        break
      case 'tool-call':
        tokens += utf8TokenUpperBound(block.name) + utf8TokenUpperBound(block.arguments) + 64
        break
      case 'tool-result':
        tokens += baselineContentTokens(block.content) + 64
        break
      default:
        tokens += jsonTokenUpperBound(block) + 64
    }
  }
  return tokens
}

/**
 * Compute the expansion budget left by one exact resolved model route. The
 * baseline prices every UTF-8 or inline-image byte as one token, includes the
 * requested output allowance, and leaves fixed provider-framing headroom.
 * @param options - exact provider request before document expansion.
 * @param contextWindow - resolved route context-window size.
 * @returns conservative token budget available for verified document text.
 */
export function documentExpansionTokenBudget(
  options: GenerateOptions,
  contextWindow: number,
): number {
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) return 0
  const outputTokens = options.maxTokens ?? Math.ceil(contextWindow / 4)
  let baseline = DOCUMENT_REQUEST_SAFETY_TOKENS
    + utf8TokenUpperBound(options.provider)
    + utf8TokenUpperBound(options.model)
    + jsonTokenUpperBound(options.system)
    + jsonTokenUpperBound(options.tools)
    + jsonTokenUpperBound(options.stop)
    + jsonTokenUpperBound(options.temperature)
    + jsonTokenUpperBound(options.reasoningEffort)
    + jsonTokenUpperBound(options.sessionId)
    + jsonTokenUpperBound(options.purpose)
  for (const message of options.messages) {
    baseline += jsonTokenUpperBound({ role: message.role, source: message.source })
      + baselineContentTokens(message.content)
      + 64
  }
  return Math.max(0, contextWindow - outputTokens - baseline)
}

/** Escape untrusted document metadata and text inside the deterministic model envelope. */
function escapeDocumentXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Build one provider-neutral bounded document projection. */
function documentText(ref: DocumentAttachmentRef, text: string): string {
  return `<dsh-document name="${escapeDocumentXml(ref.name)}" media-type="${escapeDocumentXml(ref.mediaType)}" truncated="${String(ref.truncated)}">\n${escapeDocumentXml(text)}\n</dsh-document>`
}

/** Replace document blocks recursively without mutating durable messages. */
function replaceDocuments(
  blocks: readonly ContentBlock[],
  occurrences: readonly DocumentOccurrence[],
  cursor: { index: number },
  texts: ReadonlyMap<string, string>,
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'document') {
      next ??= blocks.slice(0, index)
      const occurrence = occurrences[cursor.index]
      cursor.index += 1
      if (occurrence === undefined || occurrence.key !== documentRefKey(block.attachment)) {
        throw new Error('Document projection occurrence order diverged from message traversal.')
      }
      const text = occurrence.included ? texts.get(occurrence.key) : OFFLOADED_DOCUMENT_TEXT
      /* v8 ignore next -- selected reads are inserted under the exact occurrence key; keep a fail-closed invariant. */
      if (text === undefined) throw new Error('Document projection completed without verified text.')
      next.push({ type: 'text', text })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceDocuments(block.content, occurrences, cursor, texts)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/** Read selected unique documents through a fixed-size worker set. */
async function readProjectedDocuments(
  ordered: readonly [string, DocumentAttachmentRef][],
  attachments: AttachmentStore,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  const texts = new Map<string, string>()
  let cursor = 0
  const readNext = async (): Promise<void> => {
    while (cursor < ordered.length) {
      signal?.throwIfAborted()
      const entry = ordered[cursor]
      cursor += 1
      /* v8 ignore next -- the synchronous cursor reservation is guarded by the loop condition. */
      if (entry === undefined) throw new Error('Document projection worker exceeded its selected input.')
      const [key, ref] = entry
      const stored = await attachments.readDocument(ref, signal)
      texts.set(key, documentText(ref, stored.text))
    }
  }
  const workers = Math.min(DOCUMENT_PROJECTION_READ_CONCURRENCY, ordered.length)
  await Promise.all(Array.from({ length: workers }, readNext))
  return texts
}

/** Offload category-selected occurrences whose verified expansion cannot fit this route. */
function fitDocumentExpansion(
  occurrences: readonly DocumentOccurrence[],
  texts: ReadonlyMap<string, string>,
  maxExpansionTokens: number | undefined,
): void {
  if (maxExpansionTokens === undefined) return
  if (!Number.isSafeInteger(maxExpansionTokens) || maxExpansionTokens < 0) {
    throw new TypeError('Document expansion budget must be a non-negative safe integer.')
  }
  const placeholderTokens = utf8TokenUpperBound(OFFLOADED_DOCUMENT_TEXT)
  let consumed = 0
  for (const occurrence of prioritizedDocumentOccurrences(occurrences)) {
    if (!occurrence.included) continue
    const text = texts.get(occurrence.key)
    /* v8 ignore next -- selected reads are keyed by the same immutable reference descriptor. */
    if (text === undefined) throw new Error('Document projection completed without verified text.')
    const expansion = Math.max(0, utf8TokenUpperBound(text) - placeholderTokens)
    if (expansion > maxExpansionTokens - consumed) {
      occurrence.included = false
      continue
    }
    consumed += expansion
  }
}

/**
 * Verify durable documents and project their extracted text at the final model
 * boundary. Identical references are read once per request; session history
 * keeps the original document blocks.
 * @param messages - durable provider-neutral messages.
 * @param attachments - authoritative attachment reader.
 * @param signal - optional request cancellation.
 * @param options - route-specific document expansion limits.
 * @returns transient model messages with verified documents replaced by bounded text.
 */
export async function projectDocumentsForRequest(
  messages: readonly Message[],
  attachments: AttachmentStore,
  signal?: AbortSignal,
  options: DocumentProjectionOptions = {},
): Promise<readonly Message[]> {
  const occurrences: DocumentOccurrence[] = []
  for (const [messageIndex, message] of messages.entries()) {
    collectDocumentOccurrences(message.content, occurrences, messageIndex)
  }
  if (occurrences.length === 0) return messages
  const selected = planDocumentProjection(occurrences, attachments)
  const texts = await readProjectedDocuments([...selected.entries()], attachments, signal)
  fitDocumentExpansion(occurrences, texts, options.maxExpansionTokens)
  const cursor = { index: 0 }
  return messages.map((message) => {
    const content = replaceDocuments(message.content, occurrences, cursor, texts)
    return content === message.content ? message : { ...message, content }
  })
}

/** Base64 length of raw image bytes, including padding. */
function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

/** Byte accounting and quantized removal policy for one request representation. */
export interface RequestImageOffloadPolicy {
  /** Image count accepted by the route; omission leaves count unbounded. */
  maxImages?: number
  /** Accumulated image bytes accepted by the route; omission leaves bytes unbounded. */
  maxBytes?: number
  /** Number of excess images removed as one deterministic step. */
  countQuantum?: number
  /** Number of excess bytes removed as one deterministic step. */
  byteQuantum?: number
  /** Whether byte accounting uses raw file bytes or inline base64 length. */
  representation: 'raw' | 'base64'
  /** Resolve the encoded request-version length; omission uses normalized attachment bytes. */
  byteLength?: (ref: ImageAttachmentRef) => number
  /** Build the model-visible replacement for each omitted attachment. */
  placeholder: (ref: ImageAttachmentRef) => string
}

/** Collect represented image lengths in request and nested-block order. */
function collectImageLengths(
  blocks: readonly ContentBlock[],
  lengths: number[],
  policy: RequestImageOffloadPolicy,
): void {
  for (const block of blocks) {
    if (block.type === 'image') {
      const bytes = policy.byteLength === undefined
        ? block.attachment.bytes
        : policy.byteLength(block.attachment)
      lengths.push(policy.representation === 'base64' ? base64Length(bytes) : bytes)
    } else if (block.type === 'tool-result') {
      collectImageLengths(block.content, lengths, policy)
    }
  }
}

/** Replace the first `remaining.count` image occurrences without mutating durable messages. */
function replaceOldestImages(
  blocks: readonly ContentBlock[],
  remaining: { count: number },
  placeholder: (ref: ImageAttachmentRef) => string,
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'image' && remaining.count > 0) {
      remaining.count -= 1
      next ??= blocks.slice(0, index)
      next.push({ type: 'text', text: placeholder(block.attachment) })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceOldestImages(block.content, remaining, placeholder)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/** Replace every image occurrence, including nested tool results, for a text-only model. */
function replaceImagesForTextModel(blocks: readonly ContentBlock[]): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'image') {
      next ??= blocks.slice(0, index)
      next.push({ type: 'text', text: textOnlyImageText(block.attachment) })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceImagesForTextModel(block.content)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/**
 * Project durable image history into deterministic text for an exact text-only model.
 * @param messages - complete request history.
 * @returns the original list without images, otherwise shallow message copies with stable placeholders.
 */
export function projectImagesForTextModel(messages: readonly Message[]): readonly Message[] {
  if (!messages.some(message => contentHasImage(message.content))) return messages
  return messages.map((message) => {
    const content = replaceImagesForTextModel(message.content)
    return content === message.content ? message : { ...message, content }
  })
}

/**
 * Number of oldest image occurrences one request projection removes, in whole
 * count and byte quanta, once a route budget is exceeded. The result depends
 * only on the represented lengths, so provider request pricing reproduces the
 * exact serialization decision without building the projected messages.
 * @param lengths - represented byte length of every occurrence, in request order.
 * @param policy - count/byte budgets and removal quanta; unbounded when absent.
 * @returns how many leading occurrences the projection replaces with placeholders.
 */
export function offloadedImagePrefixCount(
  lengths: readonly number[],
  policy: Pick<RequestImageOffloadPolicy, 'maxImages' | 'maxBytes' | 'countQuantum' | 'byteQuantum'>,
): number {
  const total = lengths.reduce((sum, bytes) => sum + bytes, 0)
  const excessCount = policy.maxImages === undefined ? 0 : Math.max(0, lengths.length - policy.maxImages)
  const excessBytes = policy.maxBytes === undefined ? 0 : Math.max(0, total - policy.maxBytes)
  if (excessCount === 0 && excessBytes === 0) return 0
  const countQuantum = policy.countQuantum ?? 1
  const byteQuantum = policy.byteQuantum ?? 1
  const removeCount = excessCount === 0 ? 0 : Math.ceil(excessCount / countQuantum) * countQuantum
  const removeBytes = excessBytes === 0 ? 0 : Math.ceil(excessBytes / byteQuantum) * byteQuantum
  let count = 0
  let removedBytes = 0
  for (const imageBytes of lengths) {
    const byteTargetMet = removeBytes === 0
      || (byteQuantum === 1 ? removedBytes >= removeBytes : removedBytes > removeBytes)
    if (count >= removeCount && byteTargetMet) break
    removedBytes += imageBytes
    count += 1
  }
  return count
}

/**
 * Return a deterministic transient projection whose oldest images are replaced
 * in whole count and byte quanta after a route budget is exceeded. The target
 * depends only on complete durable history: at 129 one-megabyte images under
 * a 128 MiB bound with a 64 MiB quantum, the oldest 65 images are removed so
 * 64 MiB remain; that removed prefix stays fixed until total history exceeds
 * 192 MiB.
 * @param messages - complete request history, oldest first.
 * @param policy - route representation, budgets, and removal quanta.
 * @returns original messages below both bounds, otherwise shallow copies with deterministic placeholders.
 */
export function offloadRequestImagesWithPolicy(
  messages: readonly Message[],
  policy: RequestImageOffloadPolicy,
): readonly Message[] {
  const lengths: number[] = []
  for (const message of messages) collectImageLengths(message.content, lengths, policy)
  const count = offloadedImagePrefixCount(lengths, policy)
  if (count === 0) return messages
  const remaining = { count }
  return messages.map((message) => {
    const content = replaceOldestImages(message.content, remaining, policy.placeholder)
    return content === message.content ? message : { ...message, content }
  })
}
