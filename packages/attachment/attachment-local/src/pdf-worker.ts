/* v8 ignore file -- spawn-only glue is exercised through real source and built Worker smokes. */
/** Spawn-only PDF parser entrypoint. */

import { parentPort, workerData } from 'node:worker_threads'
import { extractPdfInProcess } from './pdf-extraction.ts'
import type { PdfWorkerRequest, PdfWorkerResponse } from './pdf-protocol.ts'

if (parentPort === null) throw new Error('PDF extraction worker requires a parent port.')

async function main(): Promise<void> {
  const request = workerData as Partial<PdfWorkerRequest>
  if (!(request.data instanceof Uint8Array)
    || !Number.isSafeInteger(request.maxBytes)
    || (request.maxBytes as number) <= 0) {
    parentPort?.postMessage({ ok: false } satisfies PdfWorkerResponse)
    return
  }
  try {
    const result = await extractPdfInProcess(request.data, request.maxBytes as number)
    parentPort?.postMessage({ ok: true, ...result } satisfies PdfWorkerResponse)
  } catch {
    parentPort?.postMessage({ ok: false } satisfies PdfWorkerResponse)
  }
}

void main()
