/** Computer Control Service Definition for bounded Desktop-native observation and input. @module @deepseek-ai/dsh-computer-control */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  ComputerListRequest,
  ComputerListResult,
  ComputerSnapshotRequest,
  ComputerSnapshotResult as ComputerSnapshot,
  ComputerStatusResult as ComputerControlStatus,
  ControlLeaseAcquireRequest,
  ControlLeaseAcquireResult,
  SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type { ComputerActionRequest, ComputerActionResult } from './types.ts'

export {
  ComputerRef,
  ControlLeaseId,
  PngTransferId,
  RequestId,
  SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'
export type {
  ActionResult,
  ComputerClickRequest,
  ComputerDragRequest,
  ComputerFocusRequest,
  ComputerKeyRequest,
  ComputerListRequest,
  ComputerListResult,
  ComputerRef as ComputerRefType,
  ComputerScrollRequest,
  ComputerSemanticRef,
  ComputerSnapshotRequest,
  ComputerSnapshotResult,
  ComputerSnapshotResult as ComputerSnapshot,
  ComputerStatusRequest,
  ComputerStatusResult,
  ComputerStatusResult as ComputerControlStatus,
  ComputerStopRequest,
  ComputerTypeRequest,
  ComputerWaitRequest,
  ControlLeaseId as ControlLeaseIdType,
  ControlLeaseAcquireRequest,
  ControlLeaseAcquireResult,
  ControlLeaseCapability,
  ControlLeaseReleaseRequest,
  ControlLeaseReleaseResult,
  ControlLeaseSurfaceKind,
  ControlLeaseTarget,
  GrantableApplication,
  KeyModifier,
  PngMetadata,
  PngTransferId as PngTransferIdType,
  PointerButton,
  RequestId as RequestIdType,
  SessionId as SessionIdType,
  StopResult,
  WaitResult,
} from '@deepseek-ai/dsh-desktop-control-protocol'
export {
  ComputerControlError,
  MAX_COMPUTER_ACTIONS_PER_TURN,
  MAX_COMPUTER_DISPLAY_SCALE,
  MAX_COMPUTER_PROCESS_ID,
  MIN_COMPUTER_DISPLAY_SCALE,
  assertComputerActionCount,
  assertComputerReferenceCurrent,
  bindComputerReference,
  freezeComputerList,
  freezeComputerSnapshot,
} from './types.ts'
export type {
  ComputerActionRequest,
  ComputerActionResult,
  ComputerReferenceBinding,
  ComputerReferenceScope,
} from './types.ts'
export { CONTROL_POLICY_RESULTS, classifyControlPolicy } from './policy.ts'
export type {
  ControlActionEffect,
  ControlPolicyInput,
  ControlPolicyResult,
  ControlSurfaceClass,
  ControlTargetSensitivity,
} from './policy.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    computerControl: ComputerControl
  }
}

/**
 * Abstract native Computer Control seam. A single Service Provider owns authorization,
 * app/window identity, reference freshness, stop, and native resource cleanup.
 */
export abstract class ComputerControl extends Service {
  /** Register this provider as the one stable `ctx.computerControl` service. */
  constructor(ctx: Context) {
    super(ctx, 'computerControl')
  }

  /**
   * Ask Electron main to authorize and mint one native-application control lease.
   * This is an internal trusted-provider operation and never a model tool.
   * @param request - Protocol-owned request with official session and transport fields.
   * @param signal - Caller lifetime.
   * @returns the effective Electron-authored lease descriptor.
   */
  abstract acquireLease(
    request: ControlLeaseAcquireRequest,
    signal: AbortSignal,
  ): Promise<ControlLeaseAcquireResult>

  /**
   * Read the bounded local platform support and permission snapshot.
   * @returns current platform support and permission states.
   */
  abstract status(): Promise<ComputerControlStatus>

  /**
   * List only applications and windows eligible for an explicit user grant.
   * @param request - Strict protocol list request.
   * @param signal - Caller lifetime.
   * @returns an immutable bounded protocol collection.
   */
  abstract list(request: ComputerListRequest, signal: AbortSignal): Promise<ComputerListResult>

  /**
   * Capture bounded semantics and an optional image for one authorized window.
   * @param request - Strict target-scoped protocol request.
   * @param signal - Caller lifetime.
   * @returns an immutable bounded protocol snapshot.
   */
  abstract snapshot(request: ComputerSnapshotRequest, signal: AbortSignal): Promise<ComputerSnapshot>

  /**
   * Execute one action from the closed native request roster.
   * @param request - Strict target-scoped protocol action DTO.
   * @param signal - Caller lifetime.
   * @returns the protocol result associated with the action family.
   */
  abstract act(request: ComputerActionRequest, signal: AbortSignal): Promise<ComputerActionResult>

  /**
   * Stop a session's native control and await release of its native resources.
   * @param sessionId - Official Harness session identity to stop.
   */
  abstract stop(sessionId: SessionId): Promise<void>
}

export default ComputerControl
