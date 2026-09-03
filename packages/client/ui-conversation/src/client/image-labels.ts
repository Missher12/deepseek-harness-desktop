/** Attachment error and limit copy owned by the conversation input flow. */

import type { DocumentAttachmentLimits, ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import { MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS } from '@deepseek-ai/dsh-attachment/types'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationKey } from './locales.ts'

/**
 * Byte count as user-facing megabytes (`10MB`, `2.5MB`).
 * @param bytes - the byte count.
 * @returns the rounded megabyte text.
 */
export function imageSizeText(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)}MB`
}

/**
 * Product copy for a host attachment rejection (the `details.reason` of
 * `session/attachment-invalid` or `subagent/attachment-invalid`).
 * User-solvable reasons name the limit and the way out;
 * reasons the user cannot act on fold into one send-failed line carrying the
 * reason code for a bug report.
 * @param t - the conversation-namespace translate.
 * @param reason - the wire `details.reason` code.
 * @param imageLimits - projected image limits interpolated into count/size copy, when known.
 * @param documentLimits - projected document limits interpolated into count/size copy, when known.
 * @returns the banner text.
 */
export function attachmentErrorText(
  t: Translate<ConversationKey>,
  reason: string,
  imageLimits?: ImageAttachmentLimits,
  documentLimits?: DocumentAttachmentLimits,
): string {
  switch (reason) {
    case 'ATTACHMENTS_TOO_LARGE':
      return t('attachment.totalTooLarge', {
        size: imageSizeText(MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS),
      })
    case 'MODEL_DOES_NOT_SUPPORT_IMAGES': return t('image.modelUnsupported')
    case 'IMAGE_TOO_MANY_PIXELS': return t('image.tooManyPixels')
    case 'IMAGE_DIMENSION_TOO_LARGE':
      if (imageLimits !== undefined) return t('image.dimensionTooLarge', { size: imageLimits.maxImageDimension })
      break
    // Undecodable bytes or a declared type its bytes contradict: solvable by
    // replacing or re-exporting the file, so it reads as a format problem.
    case 'INVALID_IMAGE':
    case 'IMAGE_TYPE_MISMATCH':
      return t('image.unsupportedType')
    case 'TOO_MANY_IMAGES':
      if (imageLimits !== undefined) return t('image.tooMany', { count: imageLimits.maxImagesPerMessage })
      break
    case 'IMAGE_TOO_LARGE':
      if (imageLimits !== undefined) return t('image.fileTooLarge', { size: imageSizeText(imageLimits.maxImageBytes) })
      break
    case 'IMAGES_TOO_LARGE':
      if (imageLimits !== undefined) return t('image.totalTooLarge', { size: imageSizeText(imageLimits.maxMessageImageBytes) })
      break
    case 'TOO_MANY_DOCUMENTS':
      if (documentLimits !== undefined) return t('document.tooMany', { count: documentLimits.maxDocumentsPerMessage })
      break
    case 'DOCUMENT_TOO_LARGE':
      if (documentLimits !== undefined) {
        return t('document.fileTooLarge', { size: imageSizeText(documentLimits.maxDocumentBytes) })
      }
      break
    case 'DOCUMENTS_TOO_LARGE':
      if (documentLimits !== undefined) {
        return t('document.totalTooLarge', { size: imageSizeText(documentLimits.maxMessageDocumentBytes) })
      }
      break
    case 'UNSUPPORTED_DOCUMENT_TYPE': return t('document.unsupportedType')
    case 'DOCUMENT_NAME_INVALID': return t('document.nameTooLong')
    case 'DOCUMENT_ENCRYPTED': return t('document.encrypted')
    case 'DOCUMENT_MACROS_UNSUPPORTED': return t('document.macrosUnsupported')
    case 'INVALID_DOCUMENT':
    case 'INVALID_DOCUMENT_BASE64':
    case 'DOCUMENT_TYPE_MISMATCH': return t('document.invalid')
    default: break
  }
  return reason.includes('DOCUMENT') ? t('document.sendFailed', { reason }) : t('image.sendFailed', { reason })
}
