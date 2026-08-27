import {
  BrowserRef as brandBrowserRef,
  PROTOCOL_LIMITS,
  type BridgeRequest,
  type BrowserRef,
  type BrowserSnapshotResult,
  type BrowserStopRequest,
  type DesktopControlErrorCode,
  type DesktopControlResultMap,
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

function assertBoundedText(value: string, name: string, maxBytes: number, allowEmpty = false): void {
  if ((!allowEmpty && value.length === 0) || utf8.encode(value).byteLength > maxBytes) {
    throw new BrowserControlError('QUOTA_EXCEEDED', `${name} exceeds its service bound`)
  }
}

function assertPositiveRevision(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < PROTOCOL_LIMITS.minRevision) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
}

/**
 * Validate and freeze one provider-owned browser reference binding.
 * @param input - Opaque ref plus its complete authoritative owner scope.
 * @returns a detached immutable binding.
 */
export function bindBrowserReference(input: BrowserReferenceBinding): BrowserReferenceBinding {
  brandBrowserRef(String(input.ref))
  assertBoundedText(String(input.sessionId), 'sessionId', PROTOCOL_LIMITS.sessionIdBytes)
  assertBoundedText(input.surfaceId, 'surfaceId', PROTOCOL_LIMITS.surfaceIdBytes)
  assertPositiveRevision(input.surfaceGeneration, 'surfaceGeneration')
  assertPositiveRevision(input.snapshotRevision, 'snapshotRevision')
  return Object.freeze({
    ref: input.ref,
    sessionId: input.sessionId,
    surfaceId: input.surfaceId,
    surfaceGeneration: input.surfaceGeneration,
    snapshotRevision: input.snapshotRevision,
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
  assertBoundedText(snapshot.surfaceId, 'surfaceId', PROTOCOL_LIMITS.surfaceIdBytes)
  assertBoundedText(snapshot.url, 'url', PROTOCOL_LIMITS.urlBytes)
  assertBoundedText(snapshot.title, 'title', PROTOCOL_LIMITS.browserTitleBytes, true)
  assertPositiveRevision(snapshot.snapshotRevision, 'snapshotRevision')
  assertBoundedText(snapshot.semanticText, 'semanticText', PROTOCOL_LIMITS.semanticTextBytes, true)
  if (snapshot.refs.length > PROTOCOL_LIMITS.maxSemanticRefs) {
    throw new BrowserControlError('QUOTA_EXCEEDED', 'browser snapshot contains too many semantic references')
  }
  const refs = Object.freeze(snapshot.refs.map((entry) => {
    brandBrowserRef(String(entry.ref))
    assertBoundedText(entry.role, 'role', PROTOCOL_LIMITS.semanticRoleBytes)
    assertBoundedText(entry.name, 'name', PROTOCOL_LIMITS.semanticNameBytes, true)
    return Object.freeze({ ref: entry.ref, role: entry.role, name: entry.name })
  }))
  const image = snapshot.image === undefined ? undefined : Object.freeze({ ...snapshot.image })
  return Object.freeze({
    surfaceId: snapshot.surfaceId,
    url: snapshot.url,
    title: snapshot.title,
    snapshotRevision: snapshot.snapshotRevision,
    semanticText: snapshot.semanticText,
    refs,
    ...image === undefined ? {} : { image },
  })
}
