/** Browser Control Service Definition for the Desktop-owned semantic browser surface. @module @deepseek-ai/dsh-browser-control */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  BrowserSnapshotRequest,
  ControlLeaseAcquireRequest,
  ControlLeaseAcquireResult,
  SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type { BrowserActionRequest, BrowserActionResult, BrowserSnapshotEnvelope } from './types.ts'

export {
  BrowserRef,
  ControlLeaseId,
  ImmutablePng,
  PngTransferId,
  RequestId,
  SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'
export type {
  ActionResult,
  BrowserClickRequest,
  BrowserKeyRequest,
  BrowserNavigateRequest,
  BrowserNavigationRequest,
  BrowserNavigationResult,
  BrowserRef as BrowserRefType,
  BrowserScrollRequest,
  BrowserSelectRequest,
  BrowserSemanticRef,
  BrowserSnapshotRequest,
  BrowserSnapshotResult,
  BrowserSnapshotResult as BrowserSnapshot,
  BrowserStopRequest,
  BrowserTypeRequest,
  BrowserWaitRequest,
  ControlLeaseId as ControlLeaseIdType,
  ControlLeaseAcquireRequest,
  ControlLeaseAcquireResult,
  ControlLeaseCapability,
  ControlLeaseReleaseRequest,
  ControlLeaseReleaseResult,
  ControlLeaseSurfaceKind,
  ControlLeaseTarget,
  KeyModifier,
  PngMetadata,
  PngTransferId as PngTransferIdType,
  RequestId as RequestIdType,
  SessionId as SessionIdType,
  StopResult,
  WaitResult,
} from '@deepseek-ai/dsh-desktop-control-protocol'
export {
  BrowserControlError,
  MAX_BROWSER_ACTIONS_PER_TURN,
  assertBrowserActionCount,
  assertBrowserReferenceCurrent,
  bindBrowserReference,
  freezeBrowserSnapshot,
  freezeBrowserSnapshotEnvelope,
} from './types.ts'
export type {
  BrowserActionRequest,
  BrowserActionResult,
  BrowserReferenceBinding,
  BrowserReferenceScope,
  BrowserSnapshotEnvelope,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    browserControl: BrowserControl
  }
}

/**
 * Abstract semantic browser-control seam. A single Service Provider owns the visible surface,
 * current reference registry, session revocation, and all browser-side cleanup.
 */
export abstract class BrowserControl extends Service {
  /** Register this provider as the one stable `ctx.browserControl` service. */
  constructor(ctx: Context) {
    super(ctx, 'browserControl')
  }

  /**
   * Ask Electron main to authorize and mint one browser control lease.
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
   * Capture bounded semantics and an optional image for the current browser surface.
   * @param request - Strict protocol request received from the Desktop bridge.
   * @param signal - Caller lifetime.
   * @returns an immutable service envelope whose result and PNG owner remain paired.
   */
  abstract snapshot(request: BrowserSnapshotRequest, signal: AbortSignal): Promise<BrowserSnapshotEnvelope>

  /**
   * Execute one action from the closed browser request roster.
   * @param request - Strict protocol action DTO.
   * @param signal - Caller lifetime.
   * @returns the protocol result associated with the action family.
   */
  abstract act(request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult>

  /**
   * Revoke a session's browser ownership and await complete surface cleanup.
   * @param sessionId - Official Harness session identity to revoke.
   */
  abstract revokeSession(sessionId: SessionId): Promise<void>
}

export default BrowserControl
