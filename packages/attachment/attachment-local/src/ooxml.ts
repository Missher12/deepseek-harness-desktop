/** Bounded, non-executing OOXML text extraction. */

import { posix } from 'node:path'
import { AttachmentError, type DocumentMediaType } from '@deepseek-ai/dsh-attachment'
import { unzipSync, type UnzipFileInfo } from 'fflate'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { fitUtf8 } from './text-budget.ts'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_ENTRIES = 256
const MAX_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024
const MAX_PATH_DEPTH = 8

type XmlRecord = Record<string, unknown>

function invalid(message = 'Document container is invalid.'): AttachmentError {
  return new AttachmentError(message, 'INVALID_DOCUMENT')
}

function validateEntry(info: UnzipFileInfo, state: { count: number; bytes: number }): boolean {
  state.count += 1
  state.bytes += info.originalSize
  const path = info.name.replaceAll('\\', '/')
  const segments = path.split('/')
  if (path.startsWith('/') || segments.some(segment => segment === '..' || segment === '') || segments.length > MAX_PATH_DEPTH) {
    throw invalid('Document container contains an unsafe entry path.')
  }
  if (state.count > MAX_ENTRIES || info.originalSize > MAX_ENTRY_BYTES || state.bytes > MAX_EXPANDED_BYTES) {
    throw invalid('Document container exceeds its expansion limits.')
  }
  const lower = path.toLowerCase()
  if (lower === 'encryptioninfo' || lower === 'encryptedpackage') {
    throw new AttachmentError('Encrypted Office documents are not supported.', 'DOCUMENT_ENCRYPTED')
  }
  if (lower.endsWith('vbaproject.bin') || lower.endsWith('vbadata.xml')) {
    throw new AttachmentError('Macro-enabled Office documents are not supported.', 'DOCUMENT_MACROS_UNSUPPORTED')
  }
  return lower === '[content_types].xml'
    || lower === 'word/document.xml'
    || lower === 'xl/workbook.xml'
    || lower === 'xl/_rels/workbook.xml.rels'
    || lower === 'xl/sharedstrings.xml'
    || /^xl\/worksheets\/[^/]+\.xml$/u.test(lower)
}

function unzipOoxml(data: Uint8Array): Readonly<Record<string, Uint8Array>> {
  if (data.byteLength < 4 || data[0] !== 0x50 || data[1] !== 0x4b) throw invalid()
  const state = { count: 0, bytes: 0 }
  try {
    return unzipSync(data, { filter: info => validateEntry(info, state) })
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw invalid()
  }
}

function xmlText(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new AttachmentError('Office XML is not valid UTF-8.', 'INVALID_DOCUMENT', { cause: error })
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(text) || XMLValidator.validate(text) !== true) throw invalid('Office XML is invalid.')
  return text
}

function object(value: unknown): XmlRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as XmlRecord : undefined
}

function array(value: unknown): readonly unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function scalar(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  const record = object(value)
  return record === undefined ? '' : scalar(record['#text'])
}

function collectNamed(value: unknown, name: string, output: string[]): void {
  if (Array.isArray(value)) {
    for (const child of value) collectNamed(child, name, output)
    return
  }
  const record = object(value)
  if (record === undefined) return
  for (const [key, child] of Object.entries(record)) {
    if (key === name) output.push(scalar(child))
    else collectNamed(child, name, output)
  }
}

function docxText(entries: Readonly<Record<string, Uint8Array>>): string {
  const source = entries['word/document.xml']
  if (source === undefined) throw invalid('DOCX document part is missing.')
  const parser = new XMLParser({
    ignoreAttributes: false,
    preserveOrder: true,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: false,
  })
  const parsed: unknown = parser.parse(xmlText(source))
  const paragraphs: string[] = []
  const inline = (value: unknown, output: string[]): void => {
    if (Array.isArray(value)) {
      for (const child of value) inline(child, output)
      return
    }
    const record = object(value)
    if (record === undefined) return
    for (const [key, child] of Object.entries(record)) {
      if (key === 't') collectNamed(child, '#text', output)
      else if (key === 'tab') output.push('\t')
      else if (key === 'br' || key === 'cr') output.push('\n')
      else inline(child, output)
    }
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    const record = object(value)
    if (record === undefined) return
    for (const [key, child] of Object.entries(record)) {
      if (key === 'p') {
        const fragments: string[] = []
        inline(child, fragments)
        paragraphs.push(fragments.join(''))
      } else {
        visit(child)
      }
    }
  }
  visit(parsed)
  return paragraphs.join('\n')
}

function safeWorkbookTarget(target: string): string | undefined {
  if (target.startsWith('/') || target.includes('\\')) return undefined
  const resolved = posix.normalize(posix.join('xl', target))
  return resolved.startsWith('xl/worksheets/') && !resolved.includes('/../') ? resolved : undefined
}

function xlsxText(entries: Readonly<Record<string, Uint8Array>>): string {
  const workbookSource = entries['xl/workbook.xml']
  const relationshipsSource = entries['xl/_rels/workbook.xml.rels']
  if (workbookSource === undefined || relationshipsSource === undefined) throw invalid('XLSX workbook parts are missing.')
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: false })
  const workbook = object(parser.parse(xmlText(workbookSource)))
  const relationships = object(parser.parse(xmlText(relationshipsSource)))
  const relationshipRows = array(object(relationships?.Relationships)?.Relationship)
  const targets = new Map<string, string>()
  for (const row of relationshipRows) {
    const record = object(row)
    if (record?.['@_TargetMode'] === 'External') continue
    const id = scalar(record?.['@_Id'])
    const target = safeWorkbookTarget(scalar(record?.['@_Target']))
    if (id !== '' && target !== undefined) targets.set(id, target)
  }

  const shared: string[] = []
  const sharedSource = entries['xl/sharedStrings.xml']
  if (sharedSource !== undefined) {
    const parsed = object(parser.parse(xmlText(sharedSource)))
    for (const item of array(object(parsed?.sst)?.si)) {
      const fragments: string[] = []
      collectNamed(item, 't', fragments)
      shared.push(fragments.join(''))
    }
  }

  const sheets = array(object(object(workbook?.workbook)?.sheets)?.sheet)
  const output: string[] = []
  for (const [index, sheet] of sheets.entries()) {
    const record = object(sheet)
    const name = scalar(record?.['@_name']) || `Sheet ${String(index + 1)}`
    const path = targets.get(scalar(record?.['@_id']))
    const source = path === undefined ? undefined : entries[path]
    if (source === undefined) continue
    const worksheet = object(parser.parse(xmlText(source)))
    const rows = array(object(object(worksheet?.worksheet)?.sheetData)?.row)
    output.push(`[Sheet: ${name}]`)
    for (const row of rows) {
      const cells: string[] = []
      for (const cell of array(object(row)?.c)) {
        const cellRecord = object(cell)
        const type = scalar(cellRecord?.['@_t'])
        const raw = scalar(cellRecord?.v)
        if (type === 's') {
          const indexValue = Number(raw)
          cells.push(Number.isSafeInteger(indexValue) && indexValue >= 0 ? shared[indexValue] ?? '' : '')
        } else if (type === 'inlineStr') {
          const fragments: string[] = []
          collectNamed(cellRecord?.is, 't', fragments)
          cells.push(fragments.join(''))
        } else {
          cells.push(raw)
        }
      }
      output.push(cells.join('\t'))
    }
  }
  if (output.length === 0) throw invalid('XLSX contains no readable worksheets.')
  return output.join('\n')
}

/** Extract bounded display text from a validated OOXML container. */
export function extractOoxmlText(
  data: Uint8Array,
  mediaType: Extract<DocumentMediaType, typeof DOCX | typeof XLSX>,
  maxTextBytes: number,
): { text: string; truncated: boolean } {
  const entries = unzipOoxml(data)
  const contentTypes = entries['[Content_Types].xml']
  if (contentTypes === undefined) throw invalid('Office content types are missing.')
  const typesText = xmlText(contentTypes)
  if (/macroEnabled|vbaProject/iu.test(typesText)) {
    throw new AttachmentError('Macro-enabled Office documents are not supported.', 'DOCUMENT_MACROS_UNSUPPORTED')
  }
  if (mediaType === DOCX && !typesText.includes('wordprocessingml.document.main+xml')) {
    throw new AttachmentError('Declared DOCX type does not match its container.', 'DOCUMENT_TYPE_MISMATCH')
  }
  if (mediaType === XLSX && !typesText.includes('spreadsheetml.sheet.main+xml')) {
    throw new AttachmentError('Declared XLSX type does not match its container.', 'DOCUMENT_TYPE_MISMATCH')
  }
  return fitUtf8(mediaType === DOCX ? docxText(entries) : xlsxText(entries), maxTextBytes)
}
