import {
  ComputerRef as brandComputerRef,
  ImmutablePng,
  PngTransferId as brandPngTransferId,
  PROTOCOL_LIMITS,
  SessionId as brandSessionId,
  type BridgeRequest,
  type ComputerListResult,
  type ComputerRef,
  type ComputerSnapshotResult,
  type ComputerStopRequest,
  type DesktopControlErrorCode,
  type DesktopControlResultMap,
  type PngMetadata,
  type SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'

/** Maximum model-driven native actions accepted within one turn. */
export const MAX_COMPUTER_ACTIONS_PER_TURN = 64
/** Largest accepted operating-system process identifier. */
export const MAX_COMPUTER_PROCESS_ID = 0xffff_ffff
/** Smallest accepted logical-to-physical display scale. */
export const MIN_COMPUTER_DISPLAY_SCALE = 0.25
/** Largest accepted logical-to-physical display scale. */
export const MAX_COMPUTER_DISPLAY_SCALE = 8

/** Native requests routed through {@link ComputerControl.act}. */
export type ComputerActionRequest = Exclude<
  Extract<BridgeRequest, { readonly requestKind: `computer.${string}` }>,
  Extract<BridgeRequest, { readonly requestKind: 'computer.status' | 'computer.list' | 'computer.snapshot' }> | ComputerStopRequest
>

/** Closed protocol result union for a native action request. */
export type ComputerActionResult = DesktopControlResultMap[ComputerActionRequest['requestKind']]

/** Native snapshot result whose protocol metadata declares no image transfer. */
export type ComputerSnapshotWithoutImage = Omit<ComputerSnapshotResult, 'image'> & {
  readonly image?: never
}

/** Native snapshot result whose protocol metadata requires one adjacent verified PNG. */
export type ComputerSnapshotWithImage = Omit<ComputerSnapshotResult, 'image'> & {
  readonly image: NonNullable<ComputerSnapshotResult['image']>
}

/** Service-owned snapshot envelope that encodes image metadata/bytes co-presence in its type. */
export type ComputerSnapshotEnvelope =
  | Readonly<{ readonly result: ComputerSnapshotWithoutImage; readonly png?: never }>
  | Readonly<{ readonly result: ComputerSnapshotWithImage; readonly png: ImmutablePng }>

/** Authoritative native target scope used to validate one opaque accessibility reference. */
export interface ComputerReferenceScope {
  /** Session that owns the native-control lease. */
  readonly sessionId: SessionId
  /** Stable application identity selected by the user. */
  readonly appId: string
  /** Current process identifier. */
  readonly processId: number
  /** Provider-owned process-creation identity preventing PID reuse. */
  readonly processIdentity: string
  /** Current authorized window identity. */
  readonly windowId: string
  /** Accessibility-tree revision from the current snapshot. */
  readonly snapshotRevision: number
  /** Display scale captured with the snapshot coordinates. */
  readonly displayScale: number
}

/** Immutable provider-side ownership record for one protocol computer reference. */
export interface ComputerReferenceBinding extends ComputerReferenceScope {
  /** Opaque protocol reference exposed outside the provider. */
  readonly ref: ComputerRef
}

/** Typed contract failure that an adapter maps into the protocol error vocabulary. */
export class ComputerControlError extends Error {
  /**
   * Create a native-control contract failure.
   * @param code - Existing closed protocol error code.
   * @param message - Local diagnostic without captured screen content.
   */
  constructor(readonly code: DesktopControlErrorCode, message: string) {
    super(message)
    this.name = 'ComputerControlError'
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
    throw new ComputerControlError('QUOTA_EXCEEDED', `${name} exceeds its service bound`)
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

function assertFiniteNumber(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
    || value < minimum || value > maximum) {
    throw new TypeError(`${name} is outside the supported service range`)
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

interface CanonicalComputerScope {
  readonly sessionId: SessionId
  readonly appId: string
  readonly processId: number
  readonly processIdentity: string
  readonly windowId: string
  readonly snapshotRevision: number
  readonly displayScale: number
}

function canonicalComputerScope(scope: object): CanonicalComputerScope {
  const rawSessionId = assertBoundedText(ownData(scope, 'sessionId'), 'sessionId', PROTOCOL_LIMITS.sessionIdBytes)
  const sessionId = brandSessionId(rawSessionId)
  const appId = assertBoundedText(ownData(scope, 'appId'), 'appId', PROTOCOL_LIMITS.appIdBytes)
  const processId = assertSafeInteger(ownData(scope, 'processId'), 'processId', 1, MAX_COMPUTER_PROCESS_ID)
  const processIdentity = assertBoundedText(
    ownData(scope, 'processIdentity'),
    'processIdentity',
    PROTOCOL_LIMITS.identifierBytes,
  )
  const windowId = assertBoundedText(ownData(scope, 'windowId'), 'windowId', PROTOCOL_LIMITS.windowIdBytes)
  const snapshotRevision = assertPositiveRevision(ownData(scope, 'snapshotRevision'), 'snapshotRevision')
  const displayScale = assertFiniteNumber(
    ownData(scope, 'displayScale'),
    'displayScale',
    MIN_COMPUTER_DISPLAY_SCALE,
    MAX_COMPUTER_DISPLAY_SCALE,
  )
  return { sessionId, appId, processId, processIdentity, windowId, snapshotRevision, displayScale }
}

/**
 * Validate and freeze one provider-owned computer reference binding.
 * @param input - Opaque ref plus its complete authoritative owner scope.
 * @returns a detached immutable binding.
 */
export function bindComputerReference(input: ComputerReferenceBinding): ComputerReferenceBinding {
  const source = assertPlainObject(input, 'computer reference binding')
  const rawRef = ownData(source, 'ref')
  if (typeof rawRef !== 'string') throw new TypeError('ref must be a string primitive')
  const ref = brandComputerRef(rawRef)
  const scope = canonicalComputerScope(source)
  return Object.freeze({
    ref,
    ...scope,
  })
}

/**
 * Fail closed unless a native ref belongs to the current owner and exact target revision.
 * Session ownership is checked first so a foreign caller cannot probe target freshness.
 * @param binding - Provider-owned reference record.
 * @param current - Current authoritative native target scope.
 */
export function assertComputerReferenceCurrent(
  binding: ComputerReferenceBinding,
  current: ComputerReferenceScope,
): void {
  if (binding.sessionId !== current.sessionId) {
    throw new ComputerControlError('UNAUTHORIZED', 'computer reference belongs to another session')
  }
  if (binding.appId !== current.appId
    || binding.processId !== current.processId
    || binding.processIdentity !== current.processIdentity
    || binding.windowId !== current.windowId
    || binding.snapshotRevision !== current.snapshotRevision
    || binding.displayScale !== current.displayScale) {
    throw new ComputerControlError('STALE_REF', 'computer reference no longer matches the current target revision')
  }
}

/**
 * Validate one turn-local native action count.
 * @param count - Actions consumed in the current turn, including the next action.
 * @returns the unchanged valid count.
 */
export function assertComputerActionCount(count: number): number {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError('computer action count must be a non-negative safe integer')
  }
  if (count > MAX_COMPUTER_ACTIONS_PER_TURN) {
    throw new ComputerControlError('QUOTA_EXCEEDED', 'computer action count exceeds the per-turn bound')
  }
  return count
}

/**
 * Validate, detach, and deeply freeze the grantable app/window collection.
 * @param result - Protocol-owned list result DTO.
 * @returns a detached immutable protocol result.
 */
export function freezeComputerList(result: ComputerListResult): ComputerListResult {
  const source = assertPlainObject(result, 'computer list')
  const rawApps = ownData(source, 'apps')
  if (!Array.isArray(rawApps)) throw new TypeError('apps must be an array')
  if (rawApps.length > PROTOCOL_LIMITS.maxGrantableApps) {
    throw new ComputerControlError('QUOTA_EXCEEDED', 'computer list contains too many applications')
  }
  const apps = Object.freeze(rawApps.map((value, appIndex) => {
    const app = assertPlainObject(value, `apps[${appIndex}]`)
    const appId = assertBoundedText(ownData(app, 'appId'), `apps[${appIndex}].appId`, PROTOCOL_LIMITS.appIdBytes)
    const name = assertBoundedText(ownData(app, 'name'), `apps[${appIndex}].name`, PROTOCOL_LIMITS.appNameBytes)
    const rawWindows = ownData(app, 'windows')
    if (!Array.isArray(rawWindows)) throw new TypeError(`apps[${appIndex}].windows must be an array`)
    if (rawWindows.length > PROTOCOL_LIMITS.maxGrantableWindowsPerApp) {
      throw new ComputerControlError('QUOTA_EXCEEDED', 'application contains too many windows')
    }
    const windows = Object.freeze(rawWindows.map((value, windowIndex) => {
      const window = assertPlainObject(value, `apps[${appIndex}].windows[${windowIndex}]`)
      const windowId = assertBoundedText(
        ownData(window, 'windowId'),
        `apps[${appIndex}].windows[${windowIndex}].windowId`,
        PROTOCOL_LIMITS.windowIdBytes,
      )
      const title = assertBoundedText(
        ownData(window, 'title'),
        `apps[${appIndex}].windows[${windowIndex}].title`,
        PROTOCOL_LIMITS.windowTitleBytes,
        true,
      )
      return Object.freeze({ windowId, title })
    }))
    return Object.freeze({ appId, name, windows })
  }))
  return Object.freeze({ apps })
}

/**
 * Validate, detach, and deeply freeze one native snapshot returned by a provider.
 * @param snapshot - Protocol-owned native result DTO.
 * @returns a detached immutable protocol result.
 */
export function freezeComputerSnapshot(snapshot: ComputerSnapshotResult): ComputerSnapshotResult {
  const source = assertPlainObject(snapshot, 'computer snapshot')
  const appId = assertBoundedText(ownData(source, 'appId'), 'appId', PROTOCOL_LIMITS.appIdBytes)
  const windowId = assertBoundedText(ownData(source, 'windowId'), 'windowId', PROTOCOL_LIMITS.windowIdBytes)
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
    throw new ComputerControlError('QUOTA_EXCEEDED', 'computer snapshot contains too many semantic references')
  }
  const refs = Object.freeze(rawRefs.map((value, index) => {
    const entry = assertPlainObject(value, `refs[${index}]`)
    const rawRef = ownData(entry, 'ref')
    if (typeof rawRef !== 'string') throw new TypeError(`refs[${index}].ref must be a string primitive`)
    const ref = brandComputerRef(rawRef)
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
    appId,
    windowId,
    snapshotRevision,
    semanticText,
    refs,
    ...image === undefined ? {} : { image },
  })
}

/**
 * Validate, detach, and freeze a native snapshot together with its optional verified PNG.
 * Image metadata and byte ownership must be present together; correlation itself belongs to the protocol codec.
 * @param envelope - Provider-owned snapshot result and codec-produced PNG owner.
 * @returns an exact immutable service envelope with no caller-owned byte aliases.
 */
export function freezeComputerSnapshotEnvelope(
  envelope: Readonly<{ readonly result: ComputerSnapshotResult; readonly png?: ImmutablePng }>,
): ComputerSnapshotEnvelope {
  const source = assertPlainObject(envelope, 'computer snapshot envelope')
  const result = freezeComputerSnapshot(ownData(source, 'result') as ComputerSnapshotResult)
  const rawPng = Object.hasOwn(source, 'png') ? ownData(source, 'png') : undefined
  if ((result.image === undefined) !== (rawPng === undefined)) {
    throw new TypeError('computer snapshot image metadata and PNG must be present together')
  }
  if (rawPng === undefined) {
    return Object.freeze({ result: result as ComputerSnapshotWithoutImage })
  }
  if (!(rawPng instanceof ImmutablePng)) throw new TypeError('png must be an ImmutablePng')
  let png: ImmutablePng
  try {
    png = new ImmutablePng(ImmutablePng.prototype.read.call(rawPng))
  } catch {
    throw new TypeError('png must be a genuine ImmutablePng')
  }
  return Object.freeze({ result: result as ComputerSnapshotWithImage, png })
}
