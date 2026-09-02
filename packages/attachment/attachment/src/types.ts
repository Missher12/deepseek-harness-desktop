/** Durable attachment vocabulary. @module @deepseek-ai/dsh-attachment/types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AttachmentId, ImageVariantId } from './brand.ts'

export type { AttachmentId } from './brand.ts'

/**
 * Maximum combined base64 data carried by image and document parts in one
 * browser prompt. The default 300 MiB HTTP envelope keeps 4 MiB for JSON,
 * text, names, and RPC framing around this ASCII payload.
 */
export const MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS = 296 * 1024 * 1024

/**
 * Exact canonical-base64 code units required for a decoded byte length.
 * @param bytes - non-negative safe integer byte length.
 * @returns canonical padded base64 length without allocating encoded data.
 */
export function promptAttachmentBase64CodeUnits(bytes: number): number {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError('attachment byte length must be a non-negative safe integer')
  }
  return Math.ceil(bytes / 3) * 4
}

const CANONICAL_ATTACHMENT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const ATTACHMENT_BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Validate RFC 4648 spelling including zero-valued unused padding bits.
 * Regex-only checks accept alternate encodings such as `AB==` and `AAB=`.
 * @param data - complete base64 payload without whitespace.
 * @returns whether the payload has one canonical RFC 4648 spelling.
 */
export function isCanonicalAttachmentBase64(data: string): boolean {
  if (data.length === 0 || !CANONICAL_ATTACHMENT_BASE64.test(data)) return false
  if (data.endsWith('==')) {
    return ATTACHMENT_BASE64_ALPHABET.indexOf(data.charAt(data.length - 3)) % 16 === 0
  }
  if (data.endsWith('=')) {
    return ATTACHMENT_BASE64_ALPHABET.indexOf(data.charAt(data.length - 2)) % 4 === 0
  }
  return true
}

/** Closed document formats accepted by the provider-neutral attachment path. */
export const DOCUMENT_MEDIA_TYPES = Object.freeze([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'application/yaml',
  'application/xml',
] as const)

/** Media types with deterministic, non-executing local text extraction. */
export type DocumentMediaType = typeof DOCUMENT_MEDIA_TYPES[number]

/** Closed filename-extension mapping shared by browser intake and local extraction. */
export const DOCUMENT_EXTENSION_MEDIA_TYPES = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  log: 'text/plain',
  ts: 'text/plain',
  tsx: 'text/plain',
  js: 'text/plain',
  jsx: 'text/plain',
  mjs: 'text/plain',
  cjs: 'text/plain',
  py: 'text/plain',
  rs: 'text/plain',
  go: 'text/plain',
  java: 'text/plain',
  kt: 'text/plain',
  kts: 'text/plain',
  swift: 'text/plain',
  c: 'text/plain',
  h: 'text/plain',
  cc: 'text/plain',
  cpp: 'text/plain',
  hpp: 'text/plain',
  cs: 'text/plain',
  rb: 'text/plain',
  php: 'text/plain',
  sh: 'text/plain',
  bash: 'text/plain',
  zsh: 'text/plain',
  fish: 'text/plain',
  sql: 'text/plain',
  css: 'text/plain',
  scss: 'text/plain',
  html: 'text/plain',
  toml: 'text/plain',
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  env: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
} satisfies Readonly<Record<string, DocumentMediaType>>)

/** Well-known extensionless text filenames admitted by the shared filename contract. */
export const DOCUMENT_EXTENSIONLESS_TEXT_NAMES = Object.freeze(['dockerfile', 'license', 'makefile', 'readme'] as const)

/** Well-known dotfile text filenames admitted without a non-empty stem. */
export const DOCUMENT_DOTFILE_TEXT_NAMES = Object.freeze(['.env'] as const)

/** Durable reference to immutable source bytes and their immutable extracted text. */
export interface DocumentAttachmentRef {
  /** Content address for the original source bytes. */
  attachmentId: AttachmentId
  /** Content address for the exact UTF-8 extracted text. */
  extractedTextId: AttachmentId
  /** Media type verified against the source container or UTF-8 content. */
  mediaType: DocumentMediaType
  /** Sanitized leaf display name; never an absolute or relative path. */
  name: string
  /** Exact original source byte length. */
  bytes: number
  /** Exact UTF-8 byte length of the stored extracted text. */
  extractedBytes: number
  /** Whether extraction was deterministically cut at the configured text budget. */
  truncated: boolean
}

/**
 * Process-scoped presentation identity for one document occurrence.
 *
 * This value is not a storage reference, content fingerprint, bearer token,
 * or read authority. A Host wire projection mints it from a process-random
 * secret plus the owning session/event-or-message position.
 */
export type DocumentAttachmentDisplayId = Branded<'DocumentAttachmentDisplayId'>

/** Bounded document metadata safe to expose to an untrusted renderer. */
export interface RendererDocumentAttachment {
  /** Opaque presentation identity; never accepted by attachment read APIs. */
  readonly displayId: DocumentAttachmentDisplayId
  /** Sanitized leaf display name; never an absolute or relative path. */
  readonly name: string
  /** Host-verified document media type. */
  readonly mediaType: DocumentMediaType
  /** Exact original source byte length. */
  readonly bytes: number
  /** Exact UTF-8 byte length of the extracted text. */
  readonly extractedBytes: number
  /** Whether extraction stopped at the configured text limit. */
  readonly truncated: boolean
}

/** Deployment-owned document admission and extraction limits. */
export interface DocumentAttachmentLimits {
  maxDocumentBytes: number
  maxDocumentsPerMessage: number
  maxMessageDocumentBytes: number
  maxExtractedTextBytes: number
  maxMessageExtractedTextBytes: number
  maxDocumentNameBytes: number
  mediaTypes: readonly DocumentMediaType[]
}

/** Base64-encoded document supplied by one authenticated prompt request. */
export interface EncodedDocumentAttachment {
  mediaType: DocumentMediaType
  data: string
  name: string
}

/** Request to validate, extract, and durably commit one document. */
export interface SaveDocumentAttachment {
  data: Uint8Array
  mediaType: DocumentMediaType
  name: string
}

/** Verified original and extracted bytes loaded for one durable document reference. */
export interface StoredDocumentAttachment {
  ref: DocumentAttachmentRef
  data: Uint8Array
  text: string
}

/** Raster image formats accepted by the version-one attachment path. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Durable, serializable reference to one immutable normalized image. */
export interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Optional display name stripped of local path information. */
  name?: string
  /**
   * Input dimensions after applying EXIF orientation and before normalization
   * scaling. Present only when normalization reduced the image.
   */
  originalDimensions?: {
    width: number
    height: number
  }
}

/** Deployment-resolved limits used by upload admission and request buffering. */
export interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  /** Maximum intrinsic width and maximum intrinsic height in pixels for one image. */
  maxImageDimension: number
  mediaTypes: readonly ImageMediaType[]
}

/** Base64-encoded image upload accompanying one wire request. */
export interface EncodedImageAttachment {
  /** Declared media type, verified against the decoded bytes during admission. */
  mediaType: ImageMediaType
  /** Canonical base64 encoding of the image bytes. */
  data: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}

/** Request to validate and durably commit one image. */
export interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}

/** Stored image bytes returned after reference and digest verification. */
export interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}

/** Deterministic request-image policy selected by one exact model route. */
export interface ImageRequestPolicy {
  /** Maximum width multiplied by height after aspect-preserving projection. */
  maxPixels: number
  /** Encoded-byte cap before base64 expansion or Files API upload. */
  maxBytes: number
}

/** Cached request version derived from one provider-independent normalized attachment. */
export interface RequestImageAttachment {
  /** Cache and upload-index key over the attachment id, policy, and fixed encoder parameters. */
  variantId: ImageVariantId
  /** Durable normalized attachment from which this request version was derived. */
  attachment: ImageAttachmentRef
  /** Encoded request bytes. */
  data: Uint8Array
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  /** Provider-compatible sample depth proven after request encoding. */
  depth: 'uchar'
  /** Provider-compatible color space proven after request encoding. */
  space: 'srgb'
  /** Whether the encoded request version retains an alpha channel. */
  hasAlpha: boolean
}
