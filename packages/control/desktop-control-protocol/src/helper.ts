import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComputerRef, ControlLeaseId, RequestId } from './brand.ts'
import type {
  ActionResult,
  ComputerListResult,
  ComputerSnapshotResult,
  ComputerStatusResult,
  KeyModifier,
  PointerButton,
  StopResult,
  WaitResult,
  DesktopControlError,
  ControlLeaseCapability,
  ControlLeaseTarget,
} from './bridge.ts'

/** Request kinds accepted by the native helper. */
export const HELPER_REQUEST_KINDS = Object.freeze([
  'status', 'list', 'snapshot', 'focus', 'click', 'double-click', 'drag',
  'type', 'key', 'scroll', 'wait', 'stop', 'lease.install', 'input.release',
] as const)

/** One request kind accepted by the native helper. */
export type HelperRequestKind = typeof HELPER_REQUEST_KINDS[number]

interface HelperRequestBase<K extends HelperRequestKind> {
  readonly protocolVersion: 1
  readonly messageKind: 'request'
  readonly requestKind: K
  readonly requestId: RequestId
  readonly sessionId: SessionId
  readonly timeoutMs: number
}

interface HelperLeaseFields {
  readonly leaseId: ControlLeaseId
  readonly leaseRevision: number
}

interface HelperTargetFields extends HelperLeaseFields {
  readonly appId: string
  readonly windowId: string
  readonly snapshotRevision: number
}

/** Electron-authored action quotas installed with one lease. */
export interface ControlLeaseQuotaSnapshot {
  readonly operations: number
  readonly snapshots: number
  readonly pointerActions: number
  readonly keyActions: number
  readonly textBytes: number
}

/** Request helper availability. */
export type HelperStatusRequest = HelperRequestBase<'status'>
/** Enumerate grantable native targets. */
export type HelperListRequest = HelperRequestBase<'list'>
/** Capture one authorized native target. */
export type HelperSnapshotRequest = HelperRequestBase<'snapshot'> & HelperTargetFields & { readonly includeImage: boolean }
/** Focus one authorized native target. */
export type HelperFocusRequest = HelperRequestBase<'focus'> & HelperTargetFields
/** Click one semantic ref or coordinate in an authorized target. */
export type HelperClickRequest = HelperRequestBase<'click' | 'double-click'> & HelperTargetFields & (
  | { readonly ref: ComputerRef; readonly x?: never; readonly y?: never; readonly button: PointerButton }
  | { readonly ref?: never; readonly x: number; readonly y: number; readonly button: PointerButton }
)
/** Drag between two coordinates in an authorized target. */
export type HelperDragRequest = HelperRequestBase<'drag'> & HelperTargetFields & { readonly fromX: number; readonly fromY: number; readonly toX: number; readonly toY: number; readonly button: PointerButton }
/** Enter text through one authorized accessibility element. */
export type HelperTypeRequest = HelperRequestBase<'type'> & HelperTargetFields & { readonly ref: ComputerRef; readonly text: string }
/** Send one closed key chord to an authorized target. */
export type HelperKeyRequest = HelperRequestBase<'key'> & HelperTargetFields & { readonly key: string; readonly modifiers: readonly KeyModifier[] }
/** Scroll an authorized target. */
export type HelperScrollRequest = HelperRequestBase<'scroll'> & HelperTargetFields & (
  | { readonly ref: ComputerRef; readonly x?: never; readonly y?: never; readonly deltaX: number; readonly deltaY: number }
  | { readonly ref?: never; readonly x: number; readonly y: number; readonly deltaX: number; readonly deltaY: number }
)
/** Wait for a bounded native target interval. */
export type HelperWaitRequest = HelperRequestBase<'wait'> & HelperTargetFields & { readonly durationMs: number }
/** Stop work associated with one installed lease. */
export type HelperStopRequest = HelperRequestBase<'stop'> & HelperLeaseFields
/** Install one Electron-authored lease snapshot. */
export type HelperLeaseInstallRequest = HelperRequestBase<'lease.install'> & HelperLeaseFields & {
  readonly agentId: string
  readonly targets: readonly ControlLeaseTarget[]
  readonly capabilities: readonly ControlLeaseCapability[]
  readonly quotas: ControlLeaseQuotaSnapshot
  readonly idleExpiresAfterMs: number
  readonly hardExpiresAfterMs: number
}
/** Release only the input state tracked by Electron after helper recovery. */
export type HelperInputReleaseRequest = HelperRequestBase<'input.release'> & {
  readonly keys: readonly string[]
  readonly buttons: readonly PointerButton[]
}

/** Closed request union accepted only by Electron's native-helper link. */
export type HelperRequest =
  | HelperStatusRequest | HelperListRequest | HelperSnapshotRequest
  | HelperFocusRequest | HelperClickRequest | HelperDragRequest
  | HelperTypeRequest | HelperKeyRequest | HelperScrollRequest
  | HelperWaitRequest | HelperStopRequest | HelperLeaseInstallRequest
  | HelperInputReleaseRequest

/** Helper-only successful result for lease installation. */
export interface HelperLeaseInstallResult {
  readonly installed: true
  readonly leaseRevision: number
}

/** Helper-only successful input recovery result. */
export interface HelperInputReleaseResult {
  readonly released: true
}

/** Closed helper result associated with each helper request discriminant. */
export interface HelperResultMap {
  readonly status: ComputerStatusResult
  readonly list: ComputerListResult
  readonly snapshot: ComputerSnapshotResult
  readonly focus: ActionResult
  readonly click: ActionResult
  readonly 'double-click': ActionResult
  readonly drag: ActionResult
  readonly type: ActionResult
  readonly key: ActionResult
  readonly scroll: ActionResult
  readonly wait: WaitResult
  readonly stop: StopResult
  readonly 'lease.install': HelperLeaseInstallResult
  readonly 'input.release': HelperInputReleaseResult
}

/** Successful native-helper response bound to its exact request kind. */
export type HelperOkResponse<K extends keyof HelperResultMap = keyof HelperResultMap> =
  K extends keyof HelperResultMap ? {
    readonly protocolVersion: 1
    readonly messageKind: 'response'
    readonly responseKind: 'ok'
    readonly requestId: RequestId
    readonly requestKind: K
    readonly result: HelperResultMap[K]
  } : never

/** Failed native-helper response bound to its exact request kind. */
export interface HelperErrorResponse<K extends HelperRequestKind = HelperRequestKind> {
  readonly protocolVersion: 1
  readonly messageKind: 'response'
  readonly responseKind: 'error'
  readonly requestId: RequestId
  readonly requestKind: K
  readonly error: DesktopControlError
}
