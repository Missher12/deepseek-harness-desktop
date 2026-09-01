/** Wire-form admission of base64-encoded image uploads. @module @deepseek-ai/dsh-attachment/admission */

import { Buffer } from 'node:buffer'
import { AttachmentError } from './error.ts'
import type { AttachmentStore } from './index.ts'
import type {
  DocumentAttachmentRef,
  EncodedDocumentAttachment,
  EncodedImageAttachment,
  ImageAttachmentRef,
  SaveDocumentAttachment,
  SaveImageAttachment,
} from './types.ts'

/** Decode one upload payload while rejecting non-canonical base64 forms. */
function decodeBase64(data: string, kind: 'Image' | 'Document'): Uint8Array {
  const decoded = Buffer.from(data, 'base64')
  if (data.length === 0 || decoded.toString('base64') !== data) {
    throw new AttachmentError(
      `${kind} upload is not canonical base64.`,
      kind === 'Image' ? 'INVALID_IMAGE_BASE64' : 'INVALID_DOCUMENT_BASE64',
    )
  }
  return new Uint8Array(decoded)
}

/** Store input for one decoded upload. */
function saveInput(image: EncodedImageAttachment): SaveImageAttachment {
  return {
    data: decodeBase64(image.data, 'Image'),
    mediaType: image.mediaType,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

function saveDocumentInput(document: EncodedDocumentAttachment): SaveDocumentAttachment {
  return {
    data: decodeBase64(document.data, 'Document'),
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

/** Decode and admit one ordered document batch through the authoritative store. */
export async function admitEncodedDocuments(
  attachments: AttachmentStore,
  documents: readonly EncodedDocumentAttachment[],
): Promise<readonly DocumentAttachmentRef[]> {
  return attachments.saveDocuments(documents.map(saveDocumentInput))
}
