/** Deterministic document admission and local text extraction. */

import { createHash } from 'node:crypto'
import {
  AttachmentError,
  AttachmentId,
  DOCUMENT_DOTFILE_TEXT_NAMES,
  DOCUMENT_EXTENSIONLESS_TEXT_NAMES,
  DOCUMENT_EXTENSION_MEDIA_TYPES,
  type DocumentAttachmentLimits,
  type DocumentAttachmentRef,
  type DocumentMediaType,
  type SaveDocumentAttachment,
} from '@deepseek-ai/dsh-attachment'
import { XMLValidator } from 'fast-xml-parser'
import { extractOoxmlText } from './ooxml.ts'
import { extractPdfIsolated } from './pdf-isolate.ts'
import { fitUtf8 } from './text-budget.ts'

const PDF = 'application/pdf'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Fully extracted and content-addressed document before any storage write. */
export interface PreparedDocument {
  data: Uint8Array
  text: string
  ref: DocumentAttachmentRef
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function sanitizedName(value: string, mediaType: DocumentMediaType, maxBytes: number): string {
  const leaf = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim()
  const lower = leaf.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const extension = dot < 0 ? '' : lower.slice(dot + 1)
  const extensionType = DOCUMENT_EXTENSION_MEDIA_TYPES[extension as keyof typeof DOCUMENT_EXTENSION_MEDIA_TYPES]
  const extensionless = dot < 0 && mediaType === 'text/plain'
    && DOCUMENT_EXTENSIONLESS_TEXT_NAMES.some(name => name === lower)
  if (extensionType !== mediaType && !extensionless) {
    throw new AttachmentError('Document name does not match its declared type.', 'DOCUMENT_TYPE_MISMATCH')
  }
  const suffix = dot < 0 ? '' : leaf.slice(dot)
  const suffixBytes = new TextEncoder().encode(suffix).byteLength
  const stem = fitUtf8(dot < 0 ? leaf : leaf.slice(0, dot), Math.max(0, maxBytes - suffixBytes)).text
  const fitted = `${stem}${suffix}`
  const exactDotfile = dot === 0 && extensionType === mediaType
    && DOCUMENT_DOTFILE_TEXT_NAMES.some(name => name === lower)
  if ((!exactDotfile && stem === '') || fitted === '.' || fitted === '..') {
    throw new AttachmentError('Document display name is invalid.', 'DOCUMENT_NAME_INVALID')
  }
  return fitted
}

function hasPrefix(data: Uint8Array, prefix: string): boolean {
  const bytes = new TextEncoder().encode(prefix)
  return bytes.every((value, index) => data[index] === value)
}

function decodeText(data: Uint8Array, mediaType: DocumentMediaType): string {
  if (hasPrefix(data, '%PDF-') || (data[0] === 0x50 && data[1] === 0x4b)) {
    throw new AttachmentError('Declared text type does not match its bytes.', 'DOCUMENT_TYPE_MISMATCH')
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch (error) {
    throw new AttachmentError('Document text is not valid UTF-8.', 'INVALID_DOCUMENT', { cause: error })
  }
  if (text.includes('\u0000')) throw new AttachmentError('Document contains binary NUL bytes.', 'INVALID_DOCUMENT')
  if (mediaType === 'application/xml' && /<!DOCTYPE|<!ENTITY/iu.test(text)) {
    throw new AttachmentError('XML document contains a forbidden declaration.', 'INVALID_DOCUMENT')
  }
  if (mediaType === 'application/json') {
    try {
      JSON.parse(text)
    } catch (error) {
      throw new AttachmentError('JSON document is malformed.', 'INVALID_DOCUMENT', { cause: error })
    }
  }
  if (mediaType === 'application/xml' && XMLValidator.validate(text) !== true) {
    throw new AttachmentError('XML document is malformed.', 'INVALID_DOCUMENT')
  }
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

async function extractedText(
  data: Uint8Array,
  mediaType: DocumentMediaType,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (mediaType === PDF) return extractPdfIsolated(data, maxBytes)
  if (mediaType === DOCX || mediaType === XLSX) return extractOoxmlText(data, mediaType, maxBytes)
  return fitUtf8(decodeText(data, mediaType), maxBytes)
}

/**
 * Validate, extract, sanitize, and content-address one document without writing it.
 * @param input - proposed document bytes and metadata.
 * @param limits - deployment document admission and extraction limits.
 * @returns the validated source, bounded extraction, and immutable reference.
 */
export async function prepareDocument(
  input: SaveDocumentAttachment,
  limits: DocumentAttachmentLimits,
): Promise<PreparedDocument> {
  if (!limits.mediaTypes.includes(input.mediaType)) {
    throw new AttachmentError(`Document type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_DOCUMENT_TYPE')
  }
  if (input.data.byteLength === 0) throw new AttachmentError('Document is empty.', 'INVALID_DOCUMENT')
  if (input.data.byteLength > limits.maxDocumentBytes) {
    throw new AttachmentError('Document exceeds the configured byte limit.', 'DOCUMENT_TOO_LARGE')
  }
  const name = sanitizedName(input.name, input.mediaType, limits.maxDocumentNameBytes)
  const extraction = await extractedText(input.data, input.mediaType, limits.maxExtractedTextBytes)
  const source = input.data.slice()
  const textBytes = new TextEncoder().encode(extraction.text)
  return {
    data: source,
    text: extraction.text,
    ref: {
      attachmentId: AttachmentId(`sha256:${digest(source)}`),
      extractedTextId: AttachmentId(`sha256:${digest(textBytes)}`),
      mediaType: input.mediaType,
      name,
      bytes: source.byteLength,
      extractedBytes: textBytes.byteLength,
      truncated: extraction.truncated,
    },
  }
}
