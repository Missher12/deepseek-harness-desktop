import {
  ComputerRef as brandComputerRef,
  PROTOCOL_LIMITS,
  type BridgeRequest,
  type ComputerListResult,
  type ComputerRef,
  type ComputerSnapshotResult,
  type ComputerStopRequest,
  type DesktopControlErrorCode,
  type DesktopControlResultMap,
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

function assertBoundedText(value: string, name: string, maxBytes: number, allowEmpty = false): void {
  if ((!allowEmpty && value.length === 0) || utf8.encode(value).byteLength > maxBytes) {
    throw new ComputerControlError('QUOTA_EXCEEDED', `${name} exceeds its service bound`)
  }
}

function assertPositiveRevision(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < PROTOCOL_LIMITS.minRevision) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
}

function assertComputerScope(scope: ComputerReferenceScope): void {
  assertBoundedText(String(scope.sessionId), 'sessionId', PROTOCOL_LIMITS.sessionIdBytes)
  assertBoundedText(scope.appId, 'appId', PROTOCOL_LIMITS.appIdBytes)
  if (!Number.isSafeInteger(scope.processId) || scope.processId < 1 || scope.processId > MAX_COMPUTER_PROCESS_ID) {
    throw new TypeError('processId must be a positive 32-bit integer')
  }
  assertBoundedText(scope.processIdentity, 'processIdentity', PROTOCOL_LIMITS.identifierBytes)
  assertBoundedText(scope.windowId, 'windowId', PROTOCOL_LIMITS.windowIdBytes)
  assertPositiveRevision(scope.snapshotRevision, 'snapshotRevision')
  if (!Number.isFinite(scope.displayScale)
    || scope.displayScale < MIN_COMPUTER_DISPLAY_SCALE
    || scope.displayScale > MAX_COMPUTER_DISPLAY_SCALE) {
    throw new TypeError('displayScale is outside the supported service range')
  }
}

/**
 * Validate and freeze one provider-owned computer reference binding.
 * @param input - Opaque ref plus its complete authoritative owner scope.
 * @returns a detached immutable binding.
 */
export function bindComputerReference(input: ComputerReferenceBinding): ComputerReferenceBinding {
  brandComputerRef(String(input.ref))
  assertComputerScope(input)
  return Object.freeze({
    ref: input.ref,
    sessionId: input.sessionId,
    appId: input.appId,
    processId: input.processId,
    processIdentity: input.processIdentity,
    windowId: input.windowId,
    snapshotRevision: input.snapshotRevision,
    displayScale: input.displayScale,
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
  if (result.apps.length > PROTOCOL_LIMITS.maxGrantableApps) {
    throw new ComputerControlError('QUOTA_EXCEEDED', 'computer list contains too many applications')
  }
  const apps = Object.freeze(result.apps.map((app) => {
    assertBoundedText(app.appId, 'appId', PROTOCOL_LIMITS.appIdBytes)
    assertBoundedText(app.name, 'app name', PROTOCOL_LIMITS.appNameBytes)
    if (app.windows.length > PROTOCOL_LIMITS.maxGrantableWindowsPerApp) {
      throw new ComputerControlError('QUOTA_EXCEEDED', 'application contains too many windows')
    }
    const windows = Object.freeze(app.windows.map((window) => {
      assertBoundedText(window.windowId, 'windowId', PROTOCOL_LIMITS.windowIdBytes)
      assertBoundedText(window.title, 'window title', PROTOCOL_LIMITS.windowTitleBytes, true)
      return Object.freeze({ windowId: window.windowId, title: window.title })
    }))
    return Object.freeze({ appId: app.appId, name: app.name, windows })
  }))
  return Object.freeze({ apps })
}

/**
 * Validate, detach, and deeply freeze one native snapshot returned by a provider.
 * @param snapshot - Protocol-owned native result DTO.
 * @returns a detached immutable protocol result.
 */
export function freezeComputerSnapshot(snapshot: ComputerSnapshotResult): ComputerSnapshotResult {
  assertBoundedText(snapshot.appId, 'appId', PROTOCOL_LIMITS.appIdBytes)
  assertBoundedText(snapshot.windowId, 'windowId', PROTOCOL_LIMITS.windowIdBytes)
  assertPositiveRevision(snapshot.snapshotRevision, 'snapshotRevision')
  assertBoundedText(snapshot.semanticText, 'semanticText', PROTOCOL_LIMITS.semanticTextBytes, true)
  if (snapshot.refs.length > PROTOCOL_LIMITS.maxSemanticRefs) {
    throw new ComputerControlError('QUOTA_EXCEEDED', 'computer snapshot contains too many semantic references')
  }
  const refs = Object.freeze(snapshot.refs.map((entry) => {
    brandComputerRef(String(entry.ref))
    assertBoundedText(entry.role, 'role', PROTOCOL_LIMITS.semanticRoleBytes)
    assertBoundedText(entry.name, 'name', PROTOCOL_LIMITS.semanticNameBytes, true)
    return Object.freeze({ ref: entry.ref, role: entry.role, name: entry.name })
  }))
  const image = snapshot.image === undefined ? undefined : Object.freeze({ ...snapshot.image })
  return Object.freeze({
    appId: snapshot.appId,
    windowId: snapshot.windowId,
    snapshotRevision: snapshot.snapshotRevision,
    semanticText: snapshot.semanticText,
    refs,
    ...image === undefined ? {} : { image },
  })
}
