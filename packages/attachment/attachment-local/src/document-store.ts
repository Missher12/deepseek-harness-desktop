/** Owner-private immutable storage for document source and extracted text. */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AttachmentError,
  DOCUMENT_MEDIA_TYPES,
  type DocumentAttachmentLimits,
  type DocumentAttachmentRef,
  type SaveDocumentAttachment,
  type StoredDocumentAttachment,
} from '@deepseek-ai/dsh-attachment'
import { prepareDocument, type PreparedDocument } from './document.ts'
import { publishImmutableObject } from './store.ts'

const ID_PATTERN = /^sha256:([a-f0-9]{64})$/u

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function refDigest(value: unknown): string {
  const match = ID_PATTERN.exec(String(value))
  if (match?.[1] === undefined) throw new AttachmentError('Document reference is invalid.', 'INVALID_ATTACHMENT_REF')
  return match[1]
}

function objectPath(root: string, kind: 'source' | 'text', sha256: string): string {
  return join(root, 'documents', kind, sha256.slice(0, 2), sha256)
}

async function commitObject(root: string, kind: 'source' | 'text', data: Uint8Array, sha256: string): Promise<void> {
  if (digest(data) !== sha256) throw new AttachmentError('Prepared document bytes do not match their reference.', 'ATTACHMENT_CORRUPT')
  await publishImmutableObject(root, objectPath(root, kind, sha256), data, sha256)
}

/**
 * Commit one already validated document source and extraction.
 * @param root - owner-private attachment storage root.
 * @param prepared - validated source, extraction, and immutable reference.
 * @returns the published durable document reference.
 */
export async function commitPreparedDocument(root: string, prepared: PreparedDocument): Promise<DocumentAttachmentRef> {
  const sourceDigest = refDigest(prepared.ref.attachmentId)
  const textDigest = refDigest(prepared.ref.extractedTextId)
  const textBytes = new TextEncoder().encode(prepared.text)
  if (prepared.data.byteLength !== prepared.ref.bytes || textBytes.byteLength !== prepared.ref.extractedBytes) {
    throw new AttachmentError('Prepared document metadata does not match its bytes.', 'ATTACHMENT_CORRUPT')
  }
  await commitObject(root, 'source', prepared.data, sourceDigest)
  await commitObject(root, 'text', textBytes, textDigest)
  return prepared.ref
}

/**
 * Validate, extract, and publish one document.
 * @param root - owner-private attachment storage root.
 * @param input - proposed document bytes and metadata.
 * @param limits - deployment document admission limits.
 * @returns the published durable document reference.
 */
export async function saveDocumentFile(
  root: string,
  input: SaveDocumentAttachment,
  limits: DocumentAttachmentLimits,
): Promise<DocumentAttachmentRef> {
  return commitPreparedDocument(root, await prepareDocument(input, limits))
}

function validateRef(
  ref: DocumentAttachmentRef,
  limits: DocumentAttachmentLimits,
): { source: string; text: string } {
  const source = refDigest(ref.attachmentId)
  const text = refDigest(ref.extractedTextId)
  if (!DOCUMENT_MEDIA_TYPES.includes(ref.mediaType)
    || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0 || ref.bytes > limits.maxDocumentBytes
    || !Number.isSafeInteger(ref.extractedBytes) || ref.extractedBytes < 0
    || ref.extractedBytes > limits.maxExtractedTextBytes
    || typeof ref.name !== 'string' || ref.name === ''
    || new TextEncoder().encode(ref.name).byteLength > limits.maxDocumentNameBytes
    || /[/\\\u0000-\u001f\u007f]/u.test(ref.name)
    || typeof ref.truncated !== 'boolean') {
    throw new AttachmentError('Document reference is invalid.', 'INVALID_ATTACHMENT_REF')
  }
  return { source, text }
}

/**
 * Read and verify both immutable objects named by a document reference.
 * @param root - owner-private attachment storage root.
 * @param ref - durable source and extraction reference.
 * @param limits - deployment document verification limits.
 * @param signal - optional cancellation for reads and integrity checks.
 * @returns the verified source bytes, extracted text, and immutable reference.
 */
export async function readDocumentFile(
  root: string,
  ref: DocumentAttachmentRef,
  limits: DocumentAttachmentLimits,
  signal?: AbortSignal,
): Promise<StoredDocumentAttachment> {
  signal?.throwIfAborted()
  const digests = validateRef(ref, limits)
  let source: Uint8Array
  let textBytes: Uint8Array
  try {
    [source, textBytes] = await Promise.all([
      readFile(objectPath(root, 'source', digests.source), { signal }).then(data => new Uint8Array(data)),
      readFile(objectPath(root, 'text', digests.text), { signal }).then(data => new Uint8Array(data)),
    ])
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new AttachmentError('Document attachment was not found.', 'ATTACHMENT_NOT_FOUND')
    }
    throw new AttachmentError('Unable to read document attachment.', 'ATTACHMENT_READ_FAILED', { cause: error })
  }
  signal?.throwIfAborted()
  if (source.byteLength !== ref.bytes || digest(source) !== digests.source
    || textBytes.byteLength !== ref.extractedBytes || digest(textBytes) !== digests.text) {
    throw new AttachmentError('Stored document failed integrity verification.', 'ATTACHMENT_CORRUPT')
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(textBytes)
  } catch (error) {
    throw new AttachmentError('Stored document text is corrupt.', 'ATTACHMENT_CORRUPT', { cause: error })
  }
  return { ref, data: source, text }
}
