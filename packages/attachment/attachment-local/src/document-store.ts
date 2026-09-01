/** Owner-private immutable storage for document source and extracted text. */

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import {
  AttachmentError,
  DOCUMENT_MEDIA_TYPES,
  type DocumentAttachmentLimits,
  type DocumentAttachmentRef,
  type SaveDocumentAttachment,
  type StoredDocumentAttachment,
} from '@deepseek-ai/dsh-attachment'
import { prepareDocument, type PreparedDocument } from './document.ts'

const ID_PATTERN = /^sha256:([a-f0-9]{64})$/u
const durableHomes = new Set<string>()

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

async function syncDirectory(path: string): Promise<void> {
  /* v8 ignore next -- Windows directory handles cannot be fsynced. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- POSIX durability peer exercised on macOS/Linux. */
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  /* v8 ignore stop */
}

async function ensureDirectory(path: string, boundary: string): Promise<void> {
  const target = resolve(path)
  const stop = resolve(boundary)
  await mkdir(target, { recursive: true, mode: 0o700 })
  await chmod(target, 0o700)
  let current = target
  while (current !== stop) {
    const parent = dirname(current)
    await syncDirectory(parent)
    /* v8 ignore next -- boundary is always a proven ancestor. */
    if (parent === current) break
    current = parent
  }
}

async function durableBoundary(root: string): Promise<string> {
  const home = dirname(dirname(resolve(root)))
  if (!durableHomes.has(home)) {
    await ensureDirectory(home, parse(home).root)
    durableHomes.add(home)
  }
  return home
}

async function commitObject(root: string, kind: 'source' | 'text', data: Uint8Array, sha256: string): Promise<void> {
  if (digest(data) !== sha256) throw new AttachmentError('Prepared document bytes do not match their reference.', 'ATTACHMENT_CORRUPT')
  const bucket = join(root, 'documents', kind, sha256.slice(0, 2))
  const staging = join(root, 'documents', 'tmp')
  const boundary = await durableBoundary(root)
  await ensureDirectory(bucket, boundary)
  await ensureDirectory(staging, boundary)
  const temporary = join(staging, randomUUID())
  const target = objectPath(root, kind, sha256)
  let handle
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = undefined
    try {
      await link(temporary, target)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      const existing = new Uint8Array(await readFile(target))
      if (digest(existing) !== sha256) throw new AttachmentError('Stored document failed integrity verification.', 'ATTACHMENT_CORRUPT')
    }
    await syncDirectory(bucket)
    await syncDirectory(join(root, 'documents', kind))
    await unlink(temporary)
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => {})
    try {
      await unlink(temporary)
    } catch (cleanupError) {
      if (!(cleanupError instanceof Error && 'code' in cleanupError && cleanupError.code === 'ENOENT')) {
        throw new AttachmentError(
          'Unable to clean up a failed document write.',
          'ATTACHMENT_WRITE_FAILED',
          { cause: new AggregateError([error, cleanupError]) },
        )
      }
    }
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unable to persist document attachment.', 'ATTACHMENT_WRITE_FAILED', { cause: error })
  }
}

/** Commit one already validated document source and extraction. */
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

/** Validate, extract, and publish one document. */
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

/** Read and verify both immutable objects named by a document reference. */
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
      readFile(objectPath(root, 'source', digests.source)).then(data => new Uint8Array(data)),
      readFile(objectPath(root, 'text', digests.text)).then(data => new Uint8Array(data)),
    ])
  } catch (error) {
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
