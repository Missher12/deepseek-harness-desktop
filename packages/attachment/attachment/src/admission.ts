/** Wire-form admission of base64-encoded image uploads. @module @deepseek-ai/dsh-attachment/admission */

import { Buffer } from 'node:buffer'
import { AttachmentError } from './error.ts'
import type { AttachmentStore } from './index.ts'
import type {
  AdmittedPromptContentPart,
  DocumentAttachmentRef,
  EncodedDocumentAttachment,
  EncodedImageAttachment,
  ImageAttachmentRef,
  PromptContentPart,
  SaveDocumentAttachment,
  SaveImageAttachment,
} from './types.ts'
import {
  isCanonicalAttachmentBase64,
  MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS,
} from './types.ts'

/**
 * Bound the combined image/document base64 payload before any decode or
 * browser File read can allocate the full request representation.
 * @param lengths - encoded ASCII code-unit lengths in prompt order.
 */
export function assertPromptAttachmentBase64CodeUnits(lengths: readonly number[]): void {
  let remaining = MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS
  for (const length of lengths) {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new AttachmentError(
        'Attachment payload length is invalid.',
        'INVALID_ATTACHMENT_PAYLOAD_LENGTH',
      )
    }
    if (length > remaining) {
      throw new AttachmentError(
        'Combined image and document payload exceeds the request carrier limit.',
        'ATTACHMENTS_TOO_LARGE',
      )
    }
    remaining -= length
  }
}

/** Encoded length of a canonical base64 representation for `bytes`. */
function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

/** Validate canonical document spelling and return the exact decoded byte length without decoding. */
function decodedDocumentBase64Length(data: string): number {
  if (!isCanonicalAttachmentBase64(data)) {
    throw new AttachmentError('Document upload is not canonical base64.', 'INVALID_DOCUMENT_BASE64')
  }
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return data.length / 4 * 3 - padding
}

/** Decode one image only after rejecting non-canonical base64 spelling. */
function decodeImageBase64(data: string): Uint8Array {
  if (!isCanonicalAttachmentBase64(data)) {
    throw new AttachmentError('Image upload is not canonical base64.', 'INVALID_IMAGE_BASE64')
  }
  return new Uint8Array(Buffer.from(data, 'base64'))
}

/** Decode a document whose complete batch has already passed canonical preflight. */
function decodePreflightedDocumentBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'))
}

/** Reject a complete encoded document batch before allocating any decoded buffer. */
function validateEncodedDocumentBatch(
  attachments: AttachmentStore,
  documents: readonly EncodedDocumentAttachment[],
): void {
  const { maxDocumentBytes, maxDocumentsPerMessage, maxMessageDocumentBytes, mediaTypes } = attachments.documentLimits
  if (documents.length > maxDocumentsPerMessage) {
    throw new AttachmentError('Document batch exceeds the configured document-count limit.', 'TOO_MANY_DOCUMENTS')
  }
  const maxEncodedLength = base64Length(maxDocumentBytes)
  let totalBytes = 0
  for (const document of documents) {
    if (document.data.length > maxEncodedLength) {
      throw new AttachmentError('Document exceeds the configured byte limit.', 'DOCUMENT_TOO_LARGE')
    }
    const bytes = decodedDocumentBase64Length(document.data)
    if (bytes > maxDocumentBytes) {
      throw new AttachmentError('Document exceeds the configured byte limit.', 'DOCUMENT_TOO_LARGE')
    }
    if (bytes > maxMessageDocumentBytes - totalBytes) {
      throw new AttachmentError('Document batch exceeds the configured aggregate byte limit.', 'DOCUMENTS_TOO_LARGE')
    }
    totalBytes += bytes
    if (!mediaTypes.includes(document.mediaType)) {
      throw new AttachmentError(
        `Document type ${document.mediaType} is not accepted by this deployment.`,
        'UNSUPPORTED_DOCUMENT_TYPE',
      )
    }
  }
}

/** Store input for one decoded upload. */
function saveInput(image: EncodedImageAttachment): SaveImageAttachment {
  return {
    data: decodeImageBase64(image.data),
    mediaType: image.mediaType,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

function saveDocumentInput(document: EncodedDocumentAttachment): SaveDocumentAttachment {
  return {
    data: decodePreflightedDocumentBase64(document.data),
    mediaType: document.mediaType,
    name: document.name,
  }
}

/**
 * Admit one wire image batch: enforce canonical base64 on every member, then
 * delegate batch admission — count and aggregate-byte limits, media-type and
 * per-image validation, ordered commit — to {@link AttachmentStore.saveImages}.
 * The shared entry for every RPC endpoint accepting browser uploads.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param images - base64-encoded uploads in caller order.
 * @returns durable references in the same order as `images`.
 * @throws AttachmentError on a non-canonical payload or a refused batch.
 */
export async function admitEncodedImages(
  attachments: AttachmentStore,
  images: readonly EncodedImageAttachment[],
): Promise<readonly ImageAttachmentRef[]> {
  return attachments.saveImages(images.map(saveInput))
}

/**
 * Decode and admit one ordered document batch through the authoritative store.
 * @param attachments - deployment attachment store owning batch policy.
 * @param documents - canonical base64 document uploads in caller order.
 * @returns durable references in the exact input order.
 */
export async function admitEncodedDocuments(
  attachments: AttachmentStore,
  documents: readonly EncodedDocumentAttachment[],
): Promise<readonly DocumentAttachmentRef[]> {
  validateEncodedDocumentBatch(attachments, documents)
  return attachments.saveDocuments(documents.map(saveDocumentInput))
}

/**
 * Admit one browser prompt and replace each uploaded attachment with its durable reference.
 * Text-only prompts do not access the attachment store.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param content - browser prompt parts in message order.
 * @returns admitted prompt parts in the same order as `content`.
 * @throws AttachmentError when either category batch is refused.
 */
export async function admitPromptContent(
  attachments: AttachmentStore,
  content: readonly PromptContentPart[],
): Promise<AdmittedPromptContentPart[]> {
  if (content.every(part => part.type === 'text')) {
    return content.map(part => ({ type: 'text', text: part.text }))
  }
  const images = content.filter(part => part.type === 'image')
  const documents = content.filter(part => part.type === 'document')
  assertPromptAttachmentBase64CodeUnits([
    ...images.map(image => image.data.length),
    ...documents.map(document => document.data.length),
  ])
  const [imageRefs, documentRefs] = await Promise.all([
    images.length === 0 ? Promise.resolve([]) : admitEncodedImages(attachments, images),
    documents.length === 0 ? Promise.resolve([]) : admitEncodedDocuments(attachments, documents),
  ])
  let nextImage = 0
  let nextDocument = 0
  return content.map((part): AdmittedPromptContentPart => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image') {
      return { type: 'image', attachment: imageRefs[nextImage++] as ImageAttachmentRef }
    }
    return {
      type: 'document',
      attachment: documentRefs[nextDocument++] as DocumentAttachmentRef,
    }
  })
}
