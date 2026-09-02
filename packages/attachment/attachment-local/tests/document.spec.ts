import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  AttachmentId,
  DOCUMENT_MEDIA_TYPES,
  type DocumentAttachmentLimits,
  type DocumentAttachmentRef,
} from '@deepseek-ai/dsh-attachment'
import { prepareDocument } from '../src/document.ts'
import { commitPreparedDocument, readDocumentFile, saveDocumentFile } from '../src/document-store.ts'

const fsControl = vi.hoisted(() => ({ readSignals: [] as AbortSignal[] }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile(...args: Parameters<typeof actual.readFile>): ReturnType<typeof actual.readFile> {
      const options = args[1]
      if (typeof options === 'object' && options !== null) {
        const signal = (options as { signal?: AbortSignal }).signal
        if (signal !== undefined) fsControl.readSignals.push(signal)
      }
      return actual.readFile(...args)
    },
  }
})

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const LIMITS: DocumentAttachmentLimits = {
  maxDocumentBytes: 20 * 1024 * 1024,
  maxDocumentsPerMessage: 5,
  maxMessageDocumentBytes: 50 * 1024 * 1024,
  maxExtractedTextBytes: 12,
  maxMessageExtractedTextBytes: 256 * 1024,
  maxDocumentNameBytes: 255,
  mediaTypes: ['text/plain', 'application/json', 'application/pdf'],
}

const FULL_LIMITS: DocumentAttachmentLimits = {
  ...LIMITS,
  maxExtractedTextBytes: 1024,
  mediaTypes: DOCUMENT_MEDIA_TYPES,
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function minimalPdf(text: string, declaredPageCount = 1): Uint8Array {
  const contentObject = 3 + declaredPageCount
  const fontObject = contentObject + 1
  const pageObjects = Array.from({ length: declaredPageCount }, (_, index) => 3 + index)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjects.map(value => `${String(value)} 0 R`).join(' ')}] /Count ${String(declaredPageCount)} >>`,
    ...pageObjects.map(() => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 ${String(fontObject)} 0 R >> >> /Contents ${String(contentObject)} 0 R >>`),
    `<< /Length ${String(33 + text.length)} >>\nstream\nBT /F1 18 Tf 20 80 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(body).byteLength)
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`
  }
  const xref = new TextEncoder().encode(body).byteLength
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

function pdfWithTextItems(count: number): Uint8Array {
  const content = `BT /F1 1 Tf\n${Array.from({ length: count }, (_, index) => (
    `1 0 0 1 0 ${String(index)} Tm (x) Tj`
  )).join('\n')}\nET`
  const contentBytes = new TextEncoder().encode(content)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 ${String(count + 1)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${String(contentBytes.byteLength)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(body).byteLength)
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`
  }
  const xref = new TextEncoder().encode(body).byteLength
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

function documentArchive(entries: Readonly<Record<string, string>>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])))
}

describe('prepareDocument', () => {
  it('sanitizes a Windows path, preserves valid UTF-8, and records explicit truncation', async () => {
    const prepared = await prepareDocument({
      data: new TextEncoder().encode('alpha beta gamma'),
      mediaType: 'text/plain',
      name: 'C:\\Users\\person\\notes.txt',
    }, LIMITS)
    expect(prepared.ref).toMatchObject({
      name: 'notes.txt',
      mediaType: 'text/plain',
      bytes: 16,
      extractedBytes: 12,
      truncated: true,
    })
    expect(prepared.text).toBe('alpha beta g')
    expect(prepared.ref.attachmentId).toBe(AttachmentId(`sha256:${sha256(prepared.data)}`))
    expect(prepared.ref.extractedTextId).toBe(AttachmentId(`sha256:${sha256(new TextEncoder().encode(prepared.text))}`))
  })

  it('extracts a small PDF locally without returning source paths', async () => {
    const prepared = await prepareDocument({ data: minimalPdf('Quarterly report'), mediaType: 'application/pdf', name: 'report.pdf' }, {
      ...LIMITS,
      maxExtractedTextBytes: 1024,
    })
    expect(prepared.text).toContain('Quarterly report')
    expect(JSON.stringify(prepared.ref)).not.toContain('/Users/')
  })

  it('rejects invalid UTF-8, NUL bytes, malformed JSON, type mismatch, and oversized input', async () => {
    await expect(prepareDocument({ data: Uint8Array.of(0xff), mediaType: 'text/plain', name: 'bad.txt' }, LIMITS))
      .rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    await expect(prepareDocument({ data: Uint8Array.of(0), mediaType: 'text/plain', name: 'bad.txt' }, LIMITS))
      .rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    await expect(prepareDocument({ data: new TextEncoder().encode('{'), mediaType: 'application/json', name: 'bad.json' }, LIMITS))
      .rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    await expect(prepareDocument({ data: minimalPdf('x'), mediaType: 'text/plain', name: 'wrong.txt' }, LIMITS))
      .rejects.toMatchObject({ code: 'DOCUMENT_TYPE_MISMATCH' })
    await expect(prepareDocument({ data: Uint8Array.of(1, 2), mediaType: 'text/plain', name: 'huge.txt' }, {
      ...LIMITS,
      maxDocumentBytes: 1,
    })).rejects.toMatchObject({ code: 'DOCUMENT_TOO_LARGE' })
  })

  it('normalizes accepted text formats and rejects unsafe names and XML', async () => {
    await expect(prepareDocument({
      data: new TextEncoder().encode('{"ok":true}'), mediaType: 'application/json', name: '/tmp/ok.json',
    }, FULL_LIMITS)).resolves.toMatchObject({ text: '{"ok":true}', ref: { name: 'ok.json' } })
    await expect(prepareDocument({
      data: new TextEncoder().encode('<root>safe</root>'), mediaType: 'application/xml', name: 'safe.xml',
    }, FULL_LIMITS)).resolves.toMatchObject({ text: '<root>safe</root>' })
    await expect(prepareDocument({
      data: new TextEncoder().encode('a\r\nb\rc'), mediaType: 'text/markdown', name: 'notes.md',
    }, FULL_LIMITS)).resolves.toMatchObject({ text: 'a\nb\nc' })
    await expect(prepareDocument({
      data: new TextEncoder().encode('header'), mediaType: 'text/plain', name: 'include/value.hpp',
    }, FULL_LIMITS)).resolves.toMatchObject({ ref: { name: 'value.hpp' } })
    await expect(prepareDocument({
      data: new TextEncoder().encode('guide'), mediaType: 'text/plain', name: 'README',
    }, FULL_LIMITS)).resolves.toMatchObject({ ref: { name: 'README' } })
    await expect(prepareDocument({
      data: new TextEncoder().encode('KEY=value'), mediaType: 'text/plain', name: '.env',
    }, FULL_LIMITS)).resolves.toMatchObject({ ref: { name: '.env' } })

    await expect(prepareDocument({
      data: new TextEncoder().encode('x'), mediaType: 'text/plain', name: 'wrong.md',
    }, FULL_LIMITS)).rejects.toMatchObject({ code: 'DOCUMENT_TYPE_MISMATCH' })
    await expect(prepareDocument({
      data: new TextEncoder().encode('x'), mediaType: 'text/plain', name: '.txt',
    }, FULL_LIMITS)).rejects.toMatchObject({ code: 'DOCUMENT_NAME_INVALID' })
    await expect(prepareDocument({
      data: new TextEncoder().encode('<!DOCTYPE root><root/>'), mediaType: 'application/xml', name: 'bad.xml',
    }, FULL_LIMITS)).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    await expect(prepareDocument({
      data: new TextEncoder().encode('<root>'), mediaType: 'application/xml', name: 'bad.xml',
    }, FULL_LIMITS)).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })

  it('rejects empty, deployment-disabled, mismatched, and malformed binary documents', async () => {
    await expect(prepareDocument({ data: new Uint8Array(), mediaType: 'text/plain', name: 'empty.txt' }, LIMITS))
      .rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    await expect(prepareDocument({
      data: new TextEncoder().encode('disabled'), mediaType: 'text/markdown', name: 'disabled.md',
    }, LIMITS)).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCUMENT_TYPE' })
    await expect(prepareDocument({
      data: new TextEncoder().encode('not a pdf'), mediaType: 'application/pdf', name: 'bad.pdf',
    }, FULL_LIMITS)).rejects.toMatchObject({ code: 'DOCUMENT_TYPE_MISMATCH' })
    await expect(prepareDocument({
      data: new TextEncoder().encode('%PDF-not-valid'), mediaType: 'application/pdf', name: 'bad.pdf',
    }, FULL_LIMITS)).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })

  it('truncates extracted PDF text within the configured UTF-8 budget', async () => {
    await expect(prepareDocument({ data: minimalPdf('Quarterly report'), mediaType: 'application/pdf', name: 'short.pdf' }, {
      ...FULL_LIMITS,
      maxExtractedTextBytes: 5,
    })).resolves.toMatchObject({ text: 'Quart', ref: { truncated: true, extractedBytes: 5 } })
  })

  it('extracts multiple PDF pages without merging their lines', async () => {
    await expect(prepareDocument({ data: minimalPdf('page', 2), mediaType: 'application/pdf', name: 'two.pdf' }, FULL_LIMITS))
      .resolves.toMatchObject({ text: 'page\npage', ref: { truncated: false } })
  })

  it('stops before a later PDF page when its separator exceeds the text budget', async () => {
    await expect(prepareDocument({ data: minimalPdf('page', 2), mediaType: 'application/pdf', name: 'two.pdf' }, {
      ...FULL_LIMITS,
      maxExtractedTextBytes: 4,
    })).resolves.toMatchObject({ text: 'page', ref: { truncated: true } })
  })

  it('rejects a PDF whose declared page tree exceeds the bounded page limit', async () => {
    await expect(prepareDocument({ data: minimalPdf('x', 501), mediaType: 'application/pdf', name: 'long.pdf' }, FULL_LIMITS))
      .rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })

  it('stops a PDF page after its bounded text-item work limit', async () => {
    const prepared = await prepareDocument({
      data: pdfWithTextItems(4097), mediaType: 'application/pdf', name: 'dense.pdf',
    }, {
      ...FULL_LIMITS,
      maxExtractedTextBytes: 64 * 1024,
    })
    expect({ truncated: prepared.ref.truncated, items: prepared.text.split(' ').length })
      .toEqual({ truncated: true, items: 4096 })
  })

  it('routes both Office media types through bounded local extraction', async () => {
    const docx = documentArchive({
      '[Content_Types].xml': '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      'word/document.xml': '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Doc</w:t></w:r></w:p></w:body></w:document>',
    })
    const xlsx = documentArchive({
      '[Content_Types].xml': '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
      'xl/workbook.xml': '<workbook><sheets><sheet name="One" r:id="r1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c><v>7</v></c></row></sheetData></worksheet>',
    })
    await expect(prepareDocument({ data: docx, mediaType: DOCUMENT_MEDIA_TYPES[1], name: 'doc.docx' }, FULL_LIMITS))
      .resolves.toMatchObject({ text: 'Doc' })
    await expect(prepareDocument({ data: xlsx, mediaType: DOCUMENT_MEDIA_TYPES[2], name: 'book.xlsx' }, FULL_LIMITS))
      .resolves.toMatchObject({ text: '[Sheet: One]\n7' })
  })

  it('rejects ZIP bytes declared as plain text', async () => {
    await expect(prepareDocument({
      data: documentArchive({ 'file.txt': 'x' }), mediaType: 'text/plain', name: 'fake.txt',
    }, FULL_LIMITS)).rejects.toMatchObject({ code: 'DOCUMENT_TYPE_MISMATCH' })
  })
})

describe('document storage', () => {
  it('publishes immutable source and extracted text and verifies both on read', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-document-store-'))
    roots.push(home)
    const root = join(home, 'attachments', 'v1')
    const input = { data: new TextEncoder().encode('stored text'), mediaType: 'text/plain' as const, name: 'stored.txt' }
    const ref = await saveDocumentFile(root, input, LIMITS)
    await expect(readDocumentFile(root, ref, LIMITS)).resolves.toMatchObject({ ref, text: 'stored text' })
  })

  it('rejects corrupted source or extracted bytes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-document-store-'))
    roots.push(home)
    const root = join(home, 'attachments', 'v1')
    const ref = await saveDocumentFile(root, {
      data: new TextEncoder().encode('stored text'), mediaType: 'text/plain', name: 'stored.txt',
    }, LIMITS)
    const digest = String(ref.extractedTextId).slice('sha256:'.length)
    const path = join(root, 'documents', 'text', digest.slice(0, 2), digest)
    await mkdir(join(root, 'documents', 'text', digest.slice(0, 2)), { recursive: true })
    expect((await readFile(path)).byteLength).toBeGreaterThan(0)
    await writeFile(path, 'tampered')
    await expect(readDocumentFile(root, ref, LIMITS)).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('forwards read cancellation to both immutable object reads', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-document-store-'))
    roots.push(home)
    const root = join(home, 'attachments', 'v1')
    const ref = await saveDocumentFile(root, {
      data: new TextEncoder().encode('stored text'), mediaType: 'text/plain', name: 'stored.txt',
    }, LIMITS)
    const controller = new AbortController()
    fsControl.readSignals.length = 0

    await expect(readDocumentFile(root, ref, LIMITS, controller.signal)).resolves.toMatchObject({ ref })
    expect(fsControl.readSignals).toEqual([controller.signal, controller.signal])
  })

  it('rejects invalid or unavailable document references without exposing paths', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-document-store-'))
    roots.push(home)
    const root = join(home, 'attachments', 'v1')
    const valid = await saveDocumentFile(root, {
      data: new TextEncoder().encode('stored text'), mediaType: 'text/plain', name: 'stored.txt',
    }, LIMITS)
    const invalidRefs: DocumentAttachmentRef[] = [
      { ...valid, attachmentId: AttachmentId('bad') },
      { ...valid, extractedTextId: AttachmentId('bad') },
      { ...valid, mediaType: 'application/octet-stream' as never },
      { ...valid, bytes: 0 },
      { ...valid, bytes: LIMITS.maxDocumentBytes + 1 },
      { ...valid, extractedBytes: -1 },
      { ...valid, extractedBytes: LIMITS.maxExtractedTextBytes + 1 },
      { ...valid, name: '' },
      { ...valid, name: 'x'.repeat(LIMITS.maxDocumentNameBytes + 1) },
      { ...valid, name: 'bad/name.txt' },
      { ...valid, truncated: undefined as never },
    ]
    for (const ref of invalidRefs) {
      await expect(readDocumentFile(root, ref, LIMITS)).rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_REF' })
    }

    await expect(readDocumentFile(root, {
      ...valid,
      attachmentId: AttachmentId(`sha256:${'0'.repeat(64)}`),
    }, LIMITS)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })
  })

  it('maps non-missing filesystem errors to read failure and preserves pre-abort', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-document-store-'))
    roots.push(home)
    const root = join(home, 'attachments', 'v1')
    const ref = await saveDocumentFile(root, {
      data: new TextEncoder().encode('stored text'), mediaType: 'text/plain', name: 'stored.txt',
    }, LIMITS)
    const digest = String(ref.attachmentId).slice('sha256:'.length)
    const sourcePath = join(root, 'documents', 'source', digest.slice(0, 2), digest)
    await rm(sourcePath)
    await mkdir(sourcePath)
    await expect(readDocumentFile(root, ref, LIMITS)).rejects.toMatchObject({ code: 'ATTACHMENT_READ_FAILED' })

    const controller = new AbortController()
    controller.abort(new Error('cancelled by test'))
    await expect(readDocumentFile(root, ref, LIMITS, controller.signal)).rejects.toThrow('cancelled by test')
  })

  it('rejects corrupt extracted UTF-8 even when the immutable digest is correct', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-document-store-'))
    roots.push(home)
    const root = join(home, 'attachments', 'v1')
    const source = new TextEncoder().encode('source')
    const text = Uint8Array.of(0xff)
    const sourceDigest = sha256(source)
    const textDigest = sha256(text)
    const sourcePath = join(root, 'documents', 'source', sourceDigest.slice(0, 2), sourceDigest)
    const textPath = join(root, 'documents', 'text', textDigest.slice(0, 2), textDigest)
    await mkdir(join(root, 'documents', 'source', sourceDigest.slice(0, 2)), { recursive: true })
    await mkdir(join(root, 'documents', 'text', textDigest.slice(0, 2)), { recursive: true })
    await writeFile(sourcePath, source)
    await writeFile(textPath, text)
    const ref: DocumentAttachmentRef = {
      attachmentId: AttachmentId(`sha256:${sourceDigest}`),
      extractedTextId: AttachmentId(`sha256:${textDigest}`),
      mediaType: 'text/plain', name: 'bad.txt', bytes: source.byteLength, extractedBytes: text.byteLength, truncated: false,
    }
    await expect(readDocumentFile(root, ref, LIMITS)).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('rejects mismatched prepared metadata, bytes, and corrupt deduplicated objects', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-document-store-'))
    roots.push(home)
    const root = join(home, 'attachments', 'v1')
    const prepared = await prepareDocument({
      data: new TextEncoder().encode('stored text'), mediaType: 'text/plain', name: 'stored.txt',
    }, LIMITS)
    await expect(commitPreparedDocument(root, {
      ...prepared,
      data: new TextEncoder().encode('stored zest'),
    })).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
    await expect(commitPreparedDocument(root, {
      ...prepared,
      ref: { ...prepared.ref, extractedBytes: prepared.ref.extractedBytes + 1 },
    })).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })

    const digest = String(prepared.ref.attachmentId).slice('sha256:'.length)
    const sourcePath = join(root, 'documents', 'source', digest.slice(0, 2), digest)
    await mkdir(join(root, 'documents', 'source', digest.slice(0, 2)), { recursive: true })
    await writeFile(sourcePath, 'corrupt')
    await expect(commitPreparedDocument(root, prepared)).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('deduplicates identical immutable objects without rewriting their contents', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-document-store-'))
    roots.push(home)
    const root = join(home, 'attachments', 'v1')
    const input = { data: new TextEncoder().encode('same text'), mediaType: 'text/plain' as const, name: 'same.txt' }
    const first = await saveDocumentFile(root, input, LIMITS)
    const second = await saveDocumentFile(root, input, LIMITS)
    expect(second).toEqual(first)
    await expect(readDocumentFile(root, second, LIMITS)).resolves.toMatchObject({ text: 'same text' })
  })
})
