/** Heap- and wall-time-bounded PDF worker orchestration. */

import { Worker } from 'node:worker_threads'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import { hasPdfSignature, type PdfWorkerRequest, type PdfWorkerResponse } from './pdf-protocol.ts'

const PDF_WORKER_TIMEOUT_MS = 30_000
const PDF_WORKER_MAX_OLD_GENERATION_MB = 128
const PDF_WORKER_ENTRIES = {
  '.ts': './pdf-worker.ts',
  '.js': './pdf-worker.cjs',
} as const
const moduleExtension = extname(fileURLToPath(import.meta.url)) as keyof typeof PDF_WORKER_ENTRIES
const PDF_WORKER_ENTRY = PDF_WORKER_ENTRIES[moduleExtension]
const PDF_WORKER_PATH = fileURLToPath(new URL(PDF_WORKER_ENTRY, import.meta.url))

function extractionFailure(): AttachmentError {
  return new AttachmentError('PDF text extraction failed.', 'INVALID_DOCUMENT')
}

function workerResult(value: unknown, maxBytes: number): { text: string; truncated: boolean } | undefined {
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) return undefined
  const response = value as Partial<PdfWorkerResponse>
  if (response.ok !== true || typeof response.text !== 'string' || typeof response.truncated !== 'boolean') return undefined
  if (new TextEncoder().encode(response.text).byteLength > maxBytes) return undefined
  return { text: response.text, truncated: response.truncated }
}

/**
 * Parse one admitted PDF outside the Host event loop and heap.
 * @param data - admitted PDF source bytes copied into the worker.
 * @param maxBytes - maximum UTF-8 bytes accepted from the worker.
 * @returns bounded text and whether source content was truncated.
 */
export function extractPdfIsolated(
  data: Uint8Array,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!hasPdfSignature(data)) {
    return Promise.reject(new AttachmentError(
      'Declared PDF type does not match its bytes.',
      'DOCUMENT_TYPE_MISMATCH',
    ))
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return Promise.reject(extractionFailure())
  const transferable = data.slice()
  const request: PdfWorkerRequest = { data: transferable, maxBytes }
  let worker: Worker
  try {
    worker = new Worker(PDF_WORKER_PATH, {
      workerData: request,
      transferList: [transferable.buffer],
      execArgv: [],
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_MAX_OLD_GENERATION_MB },
      stdout: true,
      stderr: true,
    })
  } catch {
    return Promise.reject(extractionFailure())
  }
  return new Promise((resolve, reject) => {
    let settled = false

    function finish(result: { text: string; truncated: boolean } | undefined): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate().then(
        () => {
          if (result === undefined) reject(extractionFailure())
          else resolve(result)
        },
        () => { reject(extractionFailure()) },
      )
    }

    const timer = setTimeout(() => { finish(undefined) }, PDF_WORKER_TIMEOUT_MS)
    timer.unref()
    worker.once('message', (message: unknown) => { finish(workerResult(message, maxBytes)) })
    worker.once('error', () => { finish(undefined) })
    worker.once('exit', () => { finish(undefined) })
    // pdf.js emits parser warnings for recoverable PDFs. Both pipes remain detached from Host
    // output and are drained with stream backpressure, so document-controlled text is neither
    // logged nor retained in memory while the worker remains able to make progress.
    worker.stdout.resume()
    worker.stderr.resume()
  })
}
