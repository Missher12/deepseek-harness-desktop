import {
  BrowserRef as brandBrowserRef,
  ImmutablePng,
  PngTransferId as brandPngTransferId,
  PROTOCOL_LIMITS,
  SessionId as brandSessionId,
  type BridgeRequest,
  type BrowserRef,
  type BrowserSnapshotResult,
  type BrowserStopRequest,
  type DesktopControlErrorCode,
  type DesktopControlResultMap,
  type PngMetadata,
  type SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'

/** Maximum model-driven browser actions accepted within one turn. */
export const MAX_BROWSER_ACTIONS_PER_TURN = 64

/** Browser requests routed through {@link BrowserControl.act}. */
export type BrowserActionRequest = Exclude<
  Extract<BridgeRequest, { readonly requestKind: `browser.${string}` }>,
  Extract<BridgeRequest, { readonly requestKind: 'browser.snapshot' }> | BrowserStopRequest
>

/** Closed protocol result union for a browser action request. */
export type BrowserActionResult = DesktopControlResultMap[BrowserActionRequest['requestKind']]

/** Browser snapshot result whose protocol metadata declares no image transfer. */
export type BrowserSnapshotWithoutImage = Omit<BrowserSnapshotResult, 'image'> & {
  readonly image?: never
}

/** Browser snapshot result whose protocol metadata requires one adjacent verified PNG. */
export type BrowserSnapshotWithImage = Omit<BrowserSnapshotResult, 'image'> & {
  readonly image: NonNullable<BrowserSnapshotResult['image']>
}

/** Service-owned snapshot envelope that encodes image metadata/bytes co-presence in its type. */
export type BrowserSnapshotEnvelope =
  | Readonly<{ readonly result: BrowserSnapshotWithoutImage; readonly png?: never }>
  | Readonly<{ readonly result: BrowserSnapshotWithImage; readonly png: ImmutablePng }>

/** Authoritative browser surface scope used to validate one opaque reference. */
export interface BrowserReferenceScope {
  /** Session that exclusively owns the browser surface. */
  readonly sessionId: SessionId
  /** Provider-owned opaque surface identity. */
  readonly surfaceId: string
  /** Monotonic surface mount generation. */
  readonly surfaceGeneration: number
  /** Navigation/tree revision from the current semantic snapshot. */
  readonly snapshotRevision: number
}

/** Immutable provider-side ownership record for one protocol browser reference. */
export interface BrowserReferenceBinding extends BrowserReferenceScope {
  /** Opaque protocol reference exposed outside the provider. */
  readonly ref: BrowserRef
}

/** Typed contract failure that an adapter maps into the protocol error vocabulary. */
export class BrowserControlError extends Error {
  /**
   * Create a browser-control contract failure.
   * @param code - Existing closed protocol error code.
   * @param message - Local diagnostic without page content or credentials.
   */
  constructor(readonly code: DesktopControlErrorCode, message: string) {
    super(message)
    this.name = 'BrowserControlError'
  }
}

const utf8 = new TextEncoder()
const SHA256 = /^[0-9a-f]{64}$/

function assertPlainObject(value: unknown, name: string): object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be a plain object`)
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a plain object`)
  }
  return value
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${key} must be an own data property`)
  }
  return descriptor.value
}

function assertBoundedText(value: unknown, name: string, maxBytes: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string primitive`)
  if ((!allowEmpty && value.length === 0) || utf8.encode(value).byteLength > maxBytes) {
    throw new BrowserControlError('QUOTA_EXCEEDED', `${name} exceeds its service bound`)
  }
  return value
}

function assertSafeInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0)
    || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be a safe integer in the supported range`)
  }
  return value
}

function assertPositiveRevision(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < PROTOCOL_LIMITS.minRevision) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return value
}

function freezePngMetadata(value: unknown): PngMetadata {
  const image = assertPlainObject(value, 'image')
  const rawTransferId = ownData(image, 'transferId')
  if (typeof rawTransferId !== 'string') throw new TypeError('transferId must be a string primitive')
  const transferId = brandPngTransferId(assertBoundedText(
    rawTransferId,
    'transferId',
    PROTOCOL_LIMITS.identifierBytes,
  ))
  const byteLength = assertSafeInteger(
    ownData(image, 'byteLength'),
    'byteLength',
    PROTOCOL_LIMITS.minPngBytes,
    PROTOCOL_LIMITS.pngBytes,
  )
  const sha256 = assertBoundedText(ownData(image, 'sha256'), 'sha256', PROTOCOL_LIMITS.sha256Bytes)
  if (!SHA256.test(sha256)) throw new TypeError('sha256 must be lower-case hexadecimal')
  const width = assertSafeInteger(
    ownData(image, 'width'),
    'width',
    PROTOCOL_LIMITS.minPngDimension,
    PROTOCOL_LIMITS.maxPngDimension,
  )
  const height = assertSafeInteger(
    ownData(image, 'height'),
    'height',
    PROTOCOL_LIMITS.minPngDimension,
    PROTOCOL_LIMITS.maxPngDimension,
  )
  return Object.freeze({ transferId, byteLength, sha256, width, height })
}

/**
 * Validate and freeze one provider-owned browser reference binding.
 * @param input - Opaque ref plus its complete authoritative owner scope.
 * @returns a detached immutable binding.
 */
export function bindBrowserReference(input: BrowserReferenceBinding): BrowserReferenceBinding {
  const source = assertPlainObject(input, 'browser reference binding')
  const rawRef = ownData(source, 'ref')
  if (typeof rawRef !== 'string') throw new TypeError('ref must be a string primitive')
  const ref = brandBrowserRef(rawRef)
  const rawSessionId = assertBoundedText(ownData(source, 'sessionId'), 'sessionId', PROTOCOL_LIMITS.sessionIdBytes)
  const sessionId = brandSessionId(rawSessionId)
  const surfaceId = assertBoundedText(ownData(source, 'surfaceId'), 'surfaceId', PROTOCOL_LIMITS.surfaceIdBytes)
  const surfaceGeneration = assertPositiveRevision(ownData(source, 'surfaceGeneration'), 'surfaceGeneration')
  const snapshotRevision = assertPositiveRevision(ownData(source, 'snapshotRevision'), 'snapshotRevision')
  return Object.freeze({
    ref,
    sessionId,
    surfaceId,
    surfaceGeneration,
    snapshotRevision,
  })
}

/**
 * Fail closed unless a bound browser ref belongs to the current owner and exact surface revision.
 * Session ownership is checked first so a foreign caller cannot probe target freshness.
 * @param binding - Provider-owned reference record.
 * @param current - Current authoritative surface scope.
 */
export function assertBrowserReferenceCurrent(
  binding: BrowserReferenceBinding,
  current: BrowserReferenceScope,
): void {
  if (binding.sessionId !== current.sessionId) {
    throw new BrowserControlError('UNAUTHORIZED', 'browser reference belongs to another session')
  }
  if (binding.surfaceId !== current.surfaceId
    || binding.surfaceGeneration !== current.surfaceGeneration
    || binding.snapshotRevision !== current.snapshotRevision) {
    throw new BrowserControlError('STALE_REF', 'browser reference no longer matches the current surface revision')
  }
}

/**
 * Validate one turn-local browser action count.
 * @param count - Actions consumed in the current turn, including the next action.
 * @returns the unchanged valid count.
 */
export function assertBrowserActionCount(count: number): number {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError('browser action count must be a non-negative safe integer')
  }
  if (count > MAX_BROWSER_ACTIONS_PER_TURN) {
    throw new BrowserControlError('QUOTA_EXCEEDED', 'browser action count exceeds the per-turn bound')
  }
  return count
}

/**
 * Validate, detach, and deeply freeze one browser snapshot returned by a provider.
 * @param snapshot - Protocol-owned browser result DTO.
 * @returns a detached immutable protocol result.
 */
export function freezeBrowserSnapshot(snapshot: BrowserSnapshotResult): BrowserSnapshotResult {
  const source = assertPlainObject(snapshot, 'browser snapshot')
  const surfaceId = assertBoundedText(ownData(source, 'surfaceId'), 'surfaceId', PROTOCOL_LIMITS.surfaceIdBytes)
  const url = assertBoundedText(ownData(source, 'url'), 'url', PROTOCOL_LIMITS.urlBytes)
  const title = assertBoundedText(ownData(source, 'title'), 'title', PROTOCOL_LIMITS.browserTitleBytes, true)
  const snapshotRevision = assertPositiveRevision(ownData(source, 'snapshotRevision'), 'snapshotRevision')
  const semanticText = assertBoundedText(
    ownData(source, 'semanticText'),
    'semanticText',
    PROTOCOL_LIMITS.semanticTextBytes,
    true,
  )
  const rawRefs = ownData(source, 'refs')
  if (!Array.isArray(rawRefs)) throw new TypeError('refs must be an array')
  if (rawRefs.length > PROTOCOL_LIMITS.maxSemanticRefs) {
    throw new BrowserControlError('QUOTA_EXCEEDED', 'browser snapshot contains too many semantic references')
  }
  const refs = Object.freeze(rawRefs.map((value, index) => {
    const entry = assertPlainObject(value, `refs[${index}]`)
    const rawRef = ownData(entry, 'ref')
    if (typeof rawRef !== 'string') throw new TypeError(`refs[${index}].ref must be a string primitive`)
    const ref = brandBrowserRef(rawRef)
    const role = assertBoundedText(ownData(entry, 'role'), `refs[${index}].role`, PROTOCOL_LIMITS.semanticRoleBytes)
    const name = assertBoundedText(
      ownData(entry, 'name'),
      `refs[${index}].name`,
      PROTOCOL_LIMITS.semanticNameBytes,
      true,
    )
    return Object.freeze({ ref, role, name })
  }))
  const rawImage = Object.hasOwn(source, 'image') ? ownData(source, 'image') : undefined
  const image = rawImage === undefined ? undefined : freezePngMetadata(rawImage)
  return Object.freeze({
    surfaceId,
    url,
    title,
    snapshotRevision,
    semanticText,
    refs,
    ...image === undefined ? {} : { image },
  })
}

/**
 * Validate, detach, and freeze a browser snapshot together with its optional verified PNG.
 * Image metadata and byte ownership must be present together; correlation itself belongs to the protocol codec.
 * @param envelope - Provider-owned snapshot result and codec-produced PNG owner.
 * @returns an exact immutable service envelope with no caller-owned byte aliases.
 */
export function freezeBrowserSnapshotEnvelope(
  envelope: Readonly<{ readonly result: BrowserSnapshotResult; readonly png?: ImmutablePng }>,
): BrowserSnapshotEnvelope {
  const source = assertPlainObject(envelope, 'browser snapshot envelope')
  const result = freezeBrowserSnapshot(ownData(source, 'result') as BrowserSnapshotResult)
  const rawPng = Object.hasOwn(source, 'png') ? ownData(source, 'png') : undefined
  if ((result.image === undefined) !== (rawPng === undefined)) {
    throw new TypeError('browser snapshot image metadata and PNG must be present together')
  }
  if (rawPng === undefined) {
    return Object.freeze({ result: result as BrowserSnapshotWithoutImage })
  }
  if (!(rawPng instanceof ImmutablePng)) throw new TypeError('png must be an ImmutablePng')
  let png: ImmutablePng
  try {
    png = new ImmutablePng(ImmutablePng.prototype.read.call(rawPng))
  } catch {
    throw new TypeError('png must be a genuine ImmutablePng')
  }
  return Object.freeze({ result: result as BrowserSnapshotWithImage, png })
}
