/** Closed structured-clone protocol between the attachment Host and PDF worker. */

export interface PdfWorkerRequest {
  readonly data: Uint8Array
  readonly maxBytes: number
}

/** Closed response emitted by the isolated PDF worker. */
export type PdfWorkerResponse =
  | { readonly ok: true; readonly text: string; readonly truncated: boolean }
  | { readonly ok: false }

/**
 * Cheap format check shared by the Host admission edge and isolated parser.
 * @param data - proposed PDF source bytes.
 * @returns whether the bytes begin with the PDF file signature.
 */
export function hasPdfSignature(data: Uint8Array): boolean {
  return data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44
    && data[3] === 0x46 && data[4] === 0x2d
}
