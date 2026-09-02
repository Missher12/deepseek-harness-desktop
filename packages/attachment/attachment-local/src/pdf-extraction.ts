/** In-worker bounded PDF.js text extraction. */

import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { hasPdfSignature } from './pdf-protocol.ts'
import { Utf8BudgetBuilder } from './text-budget.ts'

const MAX_PDF_PAGES = 500
const MAX_PDF_TEXT_ITEMS_PER_PAGE = 4096
const MAX_PDF_TEXT_ITEM_CHARACTERS = 128 * 1024

/**
 * Parse one already-admitted PDF inside the dedicated worker process boundary.
 * @param data - admitted PDF source bytes.
 * @param maxBytes - maximum UTF-8 bytes retained from extracted text.
 * @returns bounded text and whether source content was truncated.
 */
export async function extractPdfInProcess(
  data: Uint8Array,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!hasPdfSignature(data)) {
    throw new AttachmentError('Declared PDF type does not match its bytes.', 'DOCUMENT_TYPE_MISMATCH')
  }
  const loading = getDocument({
    data: data.slice(),
    disableFontFace: true,
    stopAtErrors: true,
    useSystemFonts: false,
  })
  let pdf
  try {
    pdf = await loading.promise
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new AttachmentError('PDF exceeds the page-count limit.', 'INVALID_DOCUMENT')
    }
    const output = new Utf8BudgetBuilder(maxBytes)
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (output.byteLength > 0 && !output.append('\n')) break
      const page = await pdf.getPage(pageNumber)
      const reader = page.streamTextContent().getReader()
      let stop = false
      let textItems = 0
      let emittedItems = 0
      try {
        while (!stop) {
          const chunk: unknown = await reader.read()
          if (typeof chunk !== 'object' || chunk === null || !('done' in chunk)) {
            throw new AttachmentError('PDF text extraction returned an invalid stream chunk.', 'INVALID_DOCUMENT')
          }
          if (chunk.done === true) break
          if (!('value' in chunk) || typeof chunk.value !== 'object' || chunk.value === null
            || !('items' in chunk.value) || !Array.isArray(chunk.value.items)) {
            throw new AttachmentError('PDF text extraction returned invalid page content.', 'INVALID_DOCUMENT')
          }
          const items = chunk.value.items as unknown[]
          for (const item of items) {
            textItems += 1
            if (textItems > MAX_PDF_TEXT_ITEMS_PER_PAGE) {
              output.markTruncated()
              stop = true
              break
            }
            if (typeof item !== 'object' || item === null || !('str' in item) || typeof item.str !== 'string') continue
            if (emittedItems > 0 && !output.append(' ')) {
              stop = true
              break
            }
            emittedItems += 1
            if (!output.appendBounded(item.str, MAX_PDF_TEXT_ITEM_CHARACTERS)) {
              stop = true
              break
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
      if (stop) break
    }
    return output.result()
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('PDF text extraction failed.', 'INVALID_DOCUMENT', { cause: error })
  } finally {
    void pdf
    await loading.destroy().catch(
      /* v8 ignore next -- pdf.js cleanup failure is subordinate to the extraction result. */
      () => {},
    )
  }
}
