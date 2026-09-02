import { describe, expect, it } from 'vitest'
import { extractPdfIsolated } from '../src/pdf-isolate.ts'

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

describe('isolated PDF extraction', () => {
  it('extracts a real PDF in a bounded worker and returns only bounded text facts', async () => {
    await expect(extractPdfIsolated(minimalPdf('isolated'), 1024)).resolves.toEqual({
      text: 'isolated',
      truncated: false,
    })
  })

  it('maps a worker-side parser failure to the closed document error', async () => {
    await expect(extractPdfIsolated(new TextEncoder().encode('%PDF-invalid'), 1024))
      .rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })
})
