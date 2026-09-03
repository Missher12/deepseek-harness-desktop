import { beforeEach, describe, expect, it, vi } from 'vitest'

const pdfControl = vi.hoisted(() => ({
  chunks: [] as unknown[],
  numPages: 1,
  loadError: undefined as Error | undefined,
  destroy: vi.fn(() => Promise.resolve()),
  releaseLock: vi.fn(),
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: vi.fn(() => ({
    destroy: pdfControl.destroy,
    promise: pdfControl.loadError === undefined ? Promise.resolve({
      numPages: pdfControl.numPages,
      getPage: vi.fn(() => Promise.resolve({
        streamTextContent: vi.fn(() => ({
          getReader: vi.fn(() => ({
            read: vi.fn(() => Promise.resolve(pdfControl.chunks.shift())),
            releaseLock: pdfControl.releaseLock,
          })),
        })),
      })),
    }) : Promise.reject(pdfControl.loadError),
  })),
}))

import { extractPdfInProcess } from '../src/pdf-extraction.ts'

function preparePdf(maxExtractedTextBytes = 64) {
  return extractPdfInProcess(new TextEncoder().encode('%PDF-test'), maxExtractedTextBytes)
}

describe('bounded PDF text streams', () => {
  beforeEach(() => {
    pdfControl.chunks.length = 0
    pdfControl.numPages = 1
    pdfControl.loadError = undefined
    pdfControl.destroy.mockClear()
    pdfControl.releaseLock.mockClear()
  })

  it('rejects a mismatched signature before asking PDF.js to parse', async () => {
    await expect(extractPdfInProcess(new TextEncoder().encode('not a PDF'), 64))
      .rejects.toMatchObject({ code: 'DOCUMENT_TYPE_MISMATCH' })
  })

  it('rejects a document above the fixed page-count limit', async () => {
    pdfControl.numPages = 501
    await expect(preparePdf()).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })

  it('maps an untyped parser failure into the closed document error', async () => {
    pdfControl.loadError = new Error('parser internals')
    await expect(preparePdf()).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })

  it('rejects malformed stream chunks and releases the reader', async () => {
    pdfControl.chunks.push(null)
    await expect(preparePdf()).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    expect(pdfControl.releaseLock).toHaveBeenCalledOnce()
  })

  it('rejects malformed stream page content', async () => {
    pdfControl.chunks.push({ done: false, value: null })
    await expect(preparePdf()).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })

  it('finishes a valid stream and separates multiple pages', async () => {
    pdfControl.numPages = 2
    pdfControl.chunks.push(
      { done: false, value: { items: [{ str: 'A' }] } },
      { done: true },
      { done: false, value: { items: [{ str: 'B' }] } },
      { done: true },
    )
    await expect(preparePdf()).resolves.toEqual({ text: 'A\nB', truncated: false })
  })

  it('stops before a page whose separator would exceed the output budget', async () => {
    pdfControl.numPages = 2
    pdfControl.chunks.push(
      { done: false, value: { items: [{ str: 'A' }] } },
      { done: true },
      { done: false, value: { items: [{ str: 'unreachable' }] } },
      { done: true },
    )
    await expect(preparePdf(1)).resolves.toEqual({ text: 'A', truncated: true })
  })

  it('ignores non-text items and stops before an over-budget item separator', async () => {
    pdfControl.chunks.push(
      { done: false, value: { items: [null, {}, { str: 1 }, { str: 'A' }, { str: 'B' }] } },
      { done: true },
    )
    await expect(preparePdf(1)).resolves.toMatchObject({
      text: 'A',
      truncated: true,
    })
    expect(pdfControl.destroy).toHaveBeenCalledOnce()
  })

  it('does not encode an arbitrarily long text item before applying the output budget', async () => {
    pdfControl.chunks.push(
      { done: false, value: { items: [{ str: 'x'.repeat(1_000_000) }] } },
      { done: true },
    )
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    try {
      await expect(preparePdf(64)).resolves.toMatchObject({
        text: 'x'.repeat(64),
        truncated: true,
      })
      expect(Math.max(...encode.mock.calls.map(([value]) => value?.length ?? 0))).toBeLessThanOrEqual(65)
    } finally {
      encode.mockRestore()
    }
  })

  it('truncates one PDF text item at the fixed character-work limit', async () => {
    pdfControl.chunks.push(
      { done: false, value: { items: [{ str: 'x'.repeat(200_000) }] } },
      { done: true },
    )
    await expect(preparePdf(200_000)).resolves.toMatchObject({
      text: 'x'.repeat(128 * 1024),
      truncated: true,
    })
  })

  it('stops after the fixed text-item work limit even when items contain no text', async () => {
    pdfControl.chunks.push(
      { done: false, value: { items: Array.from({ length: 4097 }, () => null) } },
      { done: true },
    )
    await expect(preparePdf()).resolves.toEqual({ text: '', truncated: true })
  })
})
