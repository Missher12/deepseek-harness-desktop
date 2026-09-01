/** Deterministic document admission and local text extraction. */

import { createHash } from 'node:crypto'
import {
  AttachmentError,
  AttachmentId,
  type DocumentAttachmentLimits,
  type DocumentAttachmentRef,
  type DocumentMediaType,
  type SaveDocumentAttachment,
} from '@deepseek-ai/dsh-attachment'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { XMLValidator } from 'fast-xml-parser'
import { extractOoxmlText } from './ooxml.ts'
import { fitUtf8 } from './text-budget.ts'

const PDF = 'application/pdf'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_PDF_PAGES = 500

const EXTENSIONS: Readonly<Record<DocumentMediaType, readonly string[]>> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/plain': [
    '.txt', '.log', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.kt', '.swift',
    '.c', '.h', '.cc', '.cpp', '.cs', '.rb', '.php', '.sh', '.zsh', '.fish', '.sql', '.css', '.scss', '.html',
  ],
  'text/markdown': ['.md', '.markdown'],
  'application/json': ['.json'],
  'text/csv': ['.csv'],
  'application/yaml': ['.yaml', '.yml'],
  'application/xml': ['.xml'],
}

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
  const extension = EXTENSIONS[mediaType].find(candidate => lower.endsWith(candidate))
  if (extension === undefined) {
    throw new AttachmentError('Document name does not match its declared type.', 'DOCUMENT_TYPE_MISMATCH')
  }
  const suffix = leaf.slice(leaf.length - extension.length)
  const suffixBytes = new TextEncoder().encode(suffix).byteLength
  const stem = fitUtf8(leaf.slice(0, -extension.length), Math.max(0, maxBytes - suffixBytes)).text
  const fitted = `${stem}${suffix}`
  if (stem === '' || fitted === '.' || fitted === '..') {
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

async function extractPdf(data: Uint8Array, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!hasPrefix(data, '%PDF-')) throw new AttachmentError('Declared PDF type does not match its bytes.', 'DOCUMENT_TYPE_MISMATCH')
  const loading = getDocument({
    data: data.slice(),
    disableFontFace: true,
    stopAtErrors: true,
    useSystemFonts: false,
  })
  let pdf
  try {
    pdf = await loading.promise
    if (pdf.numPages > MAX_PDF_PAGES) throw new AttachmentError('PDF exceeds the page-count limit.', 'INVALID_DOCUMENT')
    let output = ''
    let truncated = false
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const line = content.items.flatMap(item => 'str' in item && typeof item.str === 'string' ? [item.str] : []).join(' ')
      const fitted = fitUtf8(output === '' ? line : `${output}\n${line}`, maxBytes)
      output = fitted.text
      if (fitted.truncated) {
        truncated = true
        break
      }
    }
    return { text: output, truncated }
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('PDF text extraction failed.', 'INVALID_DOCUMENT', { cause: error })
  } finally {
    void pdf
    await loading.destroy().catch(() => {})
  }
}

async function extractedText(
  data: Uint8Array,
  mediaType: DocumentMediaType,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (mediaType === PDF) return extractPdf(data, maxBytes)
  if (mediaType === DOCX || mediaType === XLSX) return extractOoxmlText(data, mediaType, maxBytes)
  return fitUtf8(decodeText(data, mediaType), maxBytes)
}

/** Validate, extract, sanitize, and content-address one document without writing it. */
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
