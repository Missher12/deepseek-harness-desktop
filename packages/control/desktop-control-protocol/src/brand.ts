import type { Branded } from '@deepseek-ai/dsh-brand'
export { SessionId } from '@deepseek-ai/dsh-session/types'

/** Identifies one request across a control process boundary. */
export type RequestId = Branded<'DesktopControlRequestId'>
/** Identifies one Electron-authored control lease. */
export type ControlLeaseId = Branded<'DesktopControlLeaseId'>
/** Identifies one revision-bound browser element. */
export type BrowserRef = Branded<'DesktopBrowserRef'>
/** Identifies one revision-bound native accessibility element. */
export type ComputerRef = Branded<'DesktopComputerRef'>
/** Identifies one raw PNG transfer paired with JSON metadata. */
export type PngTransferId = Branded<'DesktopPngTransferId'>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const BROWSER_REF = /^browser:[0-9a-f]{32}$/
const COMPUTER_REF = /^computer:[0-9a-f]{32}$/

function checked<B extends string>(value: string, pattern: RegExp, label: string): Branded<B> {
  if (!pattern.test(value)) throw new Error(`${label} has an invalid format`)
  return value as Branded<B>
}

/**
 * Validate and brand a canonical lower-case UUID request id.
 * @param value - Untrusted request identifier.
 * @returns the validated branded identifier.
 */
export function RequestId(value: string): RequestId {
  return checked(value, UUID, 'requestId')
}

/**
 * Validate and brand a canonical lower-case UUID lease id.
 * @param value - Untrusted lease identifier.
 * @returns the validated branded identifier.
 */
export function ControlLeaseId(value: string): ControlLeaseId {
  return checked(value, UUID, 'leaseId')
}

/**
 * Validate and brand a browser reference.
 * @param value - Untrusted browser reference.
 * @returns the validated branded reference.
 */
export function BrowserRef(value: string): BrowserRef {
  return checked(value, BROWSER_REF, 'browser ref')
}

/**
 * Validate and brand a native accessibility reference.
 * @param value - Untrusted native reference.
 * @returns the validated branded reference.
 */
export function ComputerRef(value: string): ComputerRef {
  return checked(value, COMPUTER_REF, 'computer ref')
}

/**
 * Validate and brand a canonical lower-case UUID PNG transfer id.
 * @param value - Untrusted transfer identifier.
 * @returns the validated branded identifier.
 */
export function PngTransferId(value: string): PngTransferId {
  return checked(value, UUID, 'transferId')
}
