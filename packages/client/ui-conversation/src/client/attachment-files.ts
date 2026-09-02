import {
  DOCUMENT_DOTFILE_TEXT_NAMES,
  DOCUMENT_EXTENSIONLESS_TEXT_NAMES,
  DOCUMENT_EXTENSION_MEDIA_TYPES,
} from '@deepseek-ai/dsh-attachment/types'
import type { DocumentMediaType, ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Closed browser-side classification used for previews and early limit checks. */
export type ComposerFileClassification =
  | { readonly kind: 'image'; readonly mediaType: ImageMediaType }
  | { readonly kind: 'document'; readonly mediaType: DocumentMediaType }

/** Native file-picker accept list derived from the same closed filename contract as Host extraction. */
export const COMPOSER_ATTACHMENT_ACCEPT = Object.freeze([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  ...Object.keys(DOCUMENT_EXTENSION_MEDIA_TYPES).map(extension => `.${extension}`),
]).join(',')

/** Unsupported browser-declared image type, localized by the UI boundary. */
export class UnsupportedImageMediaTypeError extends Error {
  /** Browser-declared MIME value, possibly empty. */
  readonly mediaType: string

  /** @param mediaType - Browser-declared MIME value, possibly empty. */
  constructor(mediaType: string) {
    super(`unsupported image media type: ${mediaType || '(empty)'}`)
    this.name = 'UnsupportedImageMediaTypeError'
    this.mediaType = mediaType
  }
}

/** Unsupported browser document type, localized by the UI boundary. */
export class UnsupportedDocumentMediaTypeError extends Error {
  /** Browser display name, never interpreted as a path. */
  readonly fileName: string
  /** Browser-declared MIME value, possibly empty. */
  readonly mediaType: string

  /**
   * @param fileName - browser display name.
   * @param mediaType - browser-declared MIME value, possibly empty.
   */
  constructor(fileName: string, mediaType: string) {
    super(`unsupported document type: ${fileName || '(unnamed)'} (${mediaType || 'empty MIME'})`)
    this.name = 'UnsupportedDocumentMediaTypeError'
    this.fileName = fileName
    this.mediaType = mediaType
  }
}

/**
 * Classify one browser file without reading bytes.
 * @param file - browser-owned file selected or dropped by the user.
 * @returns the closed draft kind and declared media type.
 */
export function classifyComposerFile(file: File): ComposerFileClassification {
  if (file.type.startsWith('image/')) return { kind: 'image', mediaType: imageMediaType(file.type) }
  const normalizedName = file.name.trim().toLowerCase()
  const dot = normalizedName.lastIndexOf('.')
  const extension = dot < 0 ? '' : normalizedName.slice(dot + 1)
  const mediaType = (DOCUMENT_EXTENSION_MEDIA_TYPES as Readonly<Record<string, DocumentMediaType | undefined>>)[extension]
  const exactDotfile = dot === 0 && DOCUMENT_DOTFILE_TEXT_NAMES.some(name => name === normalizedName)
  if (mediaType !== undefined && (dot !== 0 || exactDotfile)) return { kind: 'document', mediaType }
  if (dot < 0 && DOCUMENT_EXTENSIONLESS_TEXT_NAMES.some(name => name === normalizedName)) {
    return { kind: 'document', mediaType: 'text/plain' }
  }
  throw new UnsupportedDocumentMediaTypeError(file.name, file.type)
}

/**
 * Narrow one browser-declared image MIME value to the closed accepted set.
 * @param value - browser-declared MIME value.
 * @returns the accepted image media type.
 */
export function imageMediaType(value: string): ImageMediaType {
  switch (value) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return value
    default:
      throw new UnsupportedImageMediaTypeError(value)
  }
}
