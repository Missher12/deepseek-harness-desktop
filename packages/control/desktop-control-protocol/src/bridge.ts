import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BrowserRef, ComputerRef, ControlLeaseId, PngTransferId, RequestId } from './brand.ts'

/** Protocol version accepted by both Desktop control peers. */
export const PROTOCOL_VERSION = 1 as const

/** Request kinds accepted from the Harness child. */
export const BRIDGE_REQUEST_KINDS = Object.freeze([
  'desktop.status',
  'browser.snapshot', 'browser.navigate', 'browser.click', 'browser.type',
  'browser.key', 'browser.select', 'browser.scroll', 'browser.wait',
  'browser.back', 'browser.forward', 'browser.reload', 'browser.stop',
  'computer.status', 'computer.list', 'computer.snapshot', 'computer.focus',
  'computer.click', 'computer.double-click', 'computer.drag', 'computer.type',
  'computer.key', 'computer.scroll', 'computer.wait', 'computer.stop',
] as const)

/** Control messages accepted by Electron or the helper. */
export const CONTROL_KINDS = Object.freeze([
  'request.cancel', 'session.revoke', 'lease.revoke', 'parent.shutdown',
] as const)

/** Closed error codes emitted by either control peer. */
export const ERROR_CODES = Object.freeze([
  'NOT_SUPPORTED', 'UNAUTHORIZED', 'LEASE_EXPIRED', 'LEASE_REVOKED',
  'STALE_REF', 'TARGET_CLOSED', 'PERMISSION_DENIED', 'POLICY_DENIED',
  'DUPLICATE_REQUEST', 'TOO_MANY_PENDING', 'QUOTA_EXCEEDED',
  'BINARY_MISMATCH', 'BUSY', 'TIMEOUT', 'CANCELLED', 'DISCONNECTED',
  'INTERNAL',
] as const)

/** One request kind accepted from Harness. */
export type BridgeRequestKind = typeof BRIDGE_REQUEST_KINDS[number]
/** One out-of-band control kind. */
export type ControlKind = typeof CONTROL_KINDS[number]
/** One protocol error code. */
export type DesktopControlErrorCode = typeof ERROR_CODES[number]

/** Modifier keys accepted by the closed keyboard actions. */
export type KeyModifier = 'Alt' | 'Control' | 'Meta' | 'Shift'
/** Pointer buttons accepted by native actions. */
export type PointerButton = 'left' | 'middle' | 'right'

/** Metadata for the raw PNG frame that must immediately follow its JSON frame. */
export interface PngMetadata {
  readonly transferId: PngTransferId
  readonly byteLength: number
  readonly sha256: string
  readonly width: number
  readonly height: number
}

interface BridgeRequestBase<K extends BridgeRequestKind> {
  readonly protocolVersion: 1
  readonly messageKind: 'request'
  readonly requestKind: K
  readonly requestId: RequestId
  readonly sessionId: SessionId
  readonly deadlineUnixMs: number
}

interface LeaseFields {
  readonly leaseId: ControlLeaseId
  readonly leaseRevision: number
}

interface TargetFields extends LeaseFields {
  readonly appId: string
  readonly windowId: string
  readonly snapshotRevision: number
}

/** Request the availability of Desktop control capabilities. */
export type DesktopStatusRequest = BridgeRequestBase<'desktop.status'>
/** Capture the current Agent browser semantics and optional image. */
export type BrowserSnapshotRequest = BridgeRequestBase<'browser.snapshot'> & LeaseFields & { readonly includeImage: boolean }
/** Navigate the Agent browser to one validated URL. */
export type BrowserNavigateRequest = BridgeRequestBase<'browser.navigate'> & LeaseFields & { readonly url: string }
/** Activate a current browser semantic reference. */
export type BrowserClickRequest = BridgeRequestBase<'browser.click'> & LeaseFields & { readonly ref: BrowserRef }
/** Enter text into a current browser semantic reference. */
export type BrowserTypeRequest = BridgeRequestBase<'browser.type'> & LeaseFields & { readonly ref: BrowserRef; readonly text: string }
/** Send one closed browser key chord. */
export type BrowserKeyRequest = BridgeRequestBase<'browser.key'> & LeaseFields & { readonly key: string; readonly modifiers: readonly KeyModifier[] }
/** Choose a value on a current browser semantic reference. */
export type BrowserSelectRequest = BridgeRequestBase<'browser.select'> & LeaseFields & { readonly ref: BrowserRef; readonly value: string }
/** Scroll the browser or one current semantic reference. */
export type BrowserScrollRequest = BridgeRequestBase<'browser.scroll'> & LeaseFields & { readonly ref?: BrowserRef; readonly deltaX: number; readonly deltaY: number }
/** Wait for a bounded browser condition. */
export type BrowserWaitRequest = BridgeRequestBase<'browser.wait'> & LeaseFields & (
  | { readonly mode: 'duration'; readonly durationMs: number }
  | { readonly mode: 'navigation' | 'loading-idle'; readonly durationMs?: never }
)
/** Move through browser history or refresh it. */
export type BrowserNavigationRequest = BridgeRequestBase<'browser.back' | 'browser.forward' | 'browser.reload'> & LeaseFields
/** Stop the active browser takeover for this session. */
export type BrowserStopRequest = BridgeRequestBase<'browser.stop'>
/** Request native-control availability. */
export type ComputerStatusRequest = BridgeRequestBase<'computer.status'>
/** List applications and windows eligible for a user grant. */
export type ComputerListRequest = BridgeRequestBase<'computer.list'>
/** Capture one authorized application window. */
export type ComputerSnapshotRequest = BridgeRequestBase<'computer.snapshot'> & TargetFields & { readonly includeImage: boolean }
/** Focus one authorized application window. */
export type ComputerFocusRequest = BridgeRequestBase<'computer.focus'> & TargetFields
/** Click by semantic reference or model-eligible coordinates. */
export type ComputerClickRequest = BridgeRequestBase<'computer.click' | 'computer.double-click'> & TargetFields & (
  | { readonly ref: ComputerRef; readonly x?: never; readonly y?: never; readonly button: PointerButton }
  | { readonly ref?: never; readonly x: number; readonly y: number; readonly button: PointerButton }
)
/** Drag between two coordinates in an authorized window. */
export type ComputerDragRequest = BridgeRequestBase<'computer.drag'> & TargetFields & { readonly fromX: number; readonly fromY: number; readonly toX: number; readonly toY: number; readonly button: PointerButton }
/** Enter text into an authorized accessibility element. */
export type ComputerTypeRequest = BridgeRequestBase<'computer.type'> & TargetFields & { readonly ref: ComputerRef; readonly text: string }
/** Send one closed native key chord. */
export type ComputerKeyRequest = BridgeRequestBase<'computer.key'> & TargetFields & { readonly key: string; readonly modifiers: readonly KeyModifier[] }
/** Scroll an authorized window or accessibility element. */
export type ComputerScrollRequest = BridgeRequestBase<'computer.scroll'> & TargetFields & (
  | { readonly ref: ComputerRef; readonly x?: never; readonly y?: never; readonly deltaX: number; readonly deltaY: number }
  | { readonly ref?: never; readonly x: number; readonly y: number; readonly deltaX: number; readonly deltaY: number }
)
/** Wait for a bounded native target interval. */
export type ComputerWaitRequest = BridgeRequestBase<'computer.wait'> & TargetFields & { readonly durationMs: number }
/** Stop all native control for this session. */
export type ComputerStopRequest = BridgeRequestBase<'computer.stop'>

/** Closed request union accepted from the Harness child. */
export type BridgeRequest =
  | DesktopStatusRequest | BrowserSnapshotRequest | BrowserNavigateRequest
  | BrowserClickRequest | BrowserTypeRequest | BrowserKeyRequest
  | BrowserSelectRequest | BrowserScrollRequest | BrowserWaitRequest
  | BrowserNavigationRequest | BrowserStopRequest | ComputerStatusRequest
  | ComputerListRequest | ComputerSnapshotRequest | ComputerFocusRequest
  | ComputerClickRequest | ComputerDragRequest | ComputerTypeRequest
  | ComputerKeyRequest | ComputerScrollRequest | ComputerWaitRequest
  | ComputerStopRequest

/** One browser element in a bounded semantic snapshot. */
export interface BrowserSemanticRef {
  readonly ref: BrowserRef
  readonly role: string
  readonly name: string
}

/** One native element in a bounded accessibility snapshot. */
export interface ComputerSemanticRef {
  readonly ref: ComputerRef
  readonly role: string
  readonly name: string
}

/** One grantable application and its visible windows. */
export interface GrantableApplication {
  readonly appId: string
  readonly name: string
  readonly windows: readonly { readonly windowId: string; readonly title: string }[]
}

/** Availability returned for both control capabilities. */
export interface DesktopStatusResult {
  readonly browserSupported: boolean
  readonly computerSupported: boolean
}

/** Bounded semantic browser snapshot result. */
export interface BrowserSnapshotResult {
  readonly surfaceId: string
  readonly url: string
  readonly title: string
  readonly snapshotRevision: number
  readonly semanticText: string
  readonly refs: readonly BrowserSemanticRef[]
  readonly image?: PngMetadata
}

/** Browser navigation result. */
export interface BrowserNavigationResult {
  readonly url: string
  readonly snapshotRevision: number
}

/** Successful mutation result tied to the resulting target revision. */
export interface ActionResult {
  readonly acted: true
  readonly snapshotRevision: number
}

/** Successful wait result tied to the resulting target revision. */
export interface WaitResult {
  readonly waited: true
  readonly snapshotRevision: number
}

/** Successful stop result. */
export interface StopResult {
  readonly stopped: true
}

/** Native-control support and current OS permission states. */
export interface ComputerStatusResult {
  readonly viewing: 'granted' | 'denied' | 'unknown'
  readonly assistive: 'granted' | 'denied' | 'unknown'
  readonly supported: boolean
}

/** Grantable applications returned by native enumeration. */
export interface ComputerListResult {
  readonly apps: readonly GrantableApplication[]
}

/** Bounded native accessibility snapshot result. */
export interface ComputerSnapshotResult {
  readonly appId: string
  readonly windowId: string
  readonly snapshotRevision: number
  readonly semanticText: string
  readonly refs: readonly ComputerSemanticRef[]
  readonly image?: PngMetadata
}

/** Closed result associated with each request discriminant. */
export interface DesktopControlResultMap {
  readonly 'desktop.status': DesktopStatusResult
  readonly 'browser.snapshot': BrowserSnapshotResult
  readonly 'browser.navigate': BrowserNavigationResult
  readonly 'browser.click': ActionResult
  readonly 'browser.type': ActionResult
  readonly 'browser.key': ActionResult
  readonly 'browser.select': ActionResult
  readonly 'browser.scroll': ActionResult
  readonly 'browser.wait': WaitResult
  readonly 'browser.back': BrowserNavigationResult
  readonly 'browser.forward': BrowserNavigationResult
  readonly 'browser.reload': BrowserNavigationResult
  readonly 'browser.stop': StopResult
  readonly 'computer.status': ComputerStatusResult
  readonly 'computer.list': ComputerListResult
  readonly 'computer.snapshot': ComputerSnapshotResult
  readonly 'computer.focus': ActionResult
  readonly 'computer.click': ActionResult
  readonly 'computer.double-click': ActionResult
  readonly 'computer.drag': ActionResult
  readonly 'computer.type': ActionResult
  readonly 'computer.key': ActionResult
  readonly 'computer.scroll': ActionResult
  readonly 'computer.wait': WaitResult
  readonly 'computer.stop': StopResult
}

/** Structured protocol failure with bounded human-readable detail. */
export interface DesktopControlError {
  readonly code: DesktopControlErrorCode
  readonly message: string
  readonly retryable: boolean
}

/** Successful response bound to its exact request kind. */
export type DesktopControlOkResponse<K extends keyof DesktopControlResultMap = keyof DesktopControlResultMap> =
  K extends keyof DesktopControlResultMap ? {
    readonly protocolVersion: 1
    readonly messageKind: 'response'
    readonly responseKind: 'ok'
    readonly requestId: RequestId
    readonly requestKind: K
    readonly result: DesktopControlResultMap[K]
  } : never

/** Failed response bound to the request it answers. */
export interface DesktopControlErrorResponse<K extends BridgeRequestKind = BridgeRequestKind> {
  readonly protocolVersion: 1
  readonly messageKind: 'response'
  readonly responseKind: 'error'
  readonly requestId: RequestId
  readonly requestKind: K
  readonly error: DesktopControlError
}

/** Out-of-band cancellation and revocation messages. */
export type DesktopControlControl =
  | { readonly protocolVersion: 1; readonly messageKind: 'control'; readonly controlKind: 'request.cancel'; readonly sessionId: SessionId; readonly requestId: RequestId }
  | { readonly protocolVersion: 1; readonly messageKind: 'control'; readonly controlKind: 'session.revoke'; readonly sessionId: SessionId }
  | { readonly protocolVersion: 1; readonly messageKind: 'control'; readonly controlKind: 'lease.revoke'; readonly sessionId: SessionId; readonly leaseId: ControlLeaseId; readonly leaseRevision: number }
  | { readonly protocolVersion: 1; readonly messageKind: 'control'; readonly controlKind: 'parent.shutdown' }
