import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentId, type DocumentAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import { prepareDocument } from '../src/document.ts'
import { readDocumentFile, saveDocumentFile } from '../src/document-store.ts'

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

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function minimalPdf(text: string): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
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
})
