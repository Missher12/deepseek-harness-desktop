import { BrowserControl, freezeBrowserSnapshotEnvelope } from '@deepseek-ai/dsh-browser-control'
import type { BrowserActionRequest, BrowserActionResult, BrowserSnapshotEnvelope } from '@deepseek-ai/dsh-browser-control'
import type { Context } from '@deepseek-ai/cordis'
import type {
  BrowserSnapshotRequest,
  ControlLeaseAcquireRequest,
  ControlLeaseAcquireResult,
  DecodedDesktopControlEnvelope,
  SessionId,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  ControlLeaseCache,
  DesktopControlIpcError,
  type DesktopControlRequester,
} from './ipc-client.ts'

function exactOk(
  envelope: DecodedDesktopControlEnvelope,
  requestKind: string,
): Extract<DecodedDesktopControlEnvelope['message'], { messageKind: 'response'; responseKind: 'ok' }> {
  const message = envelope.message
  if (message.messageKind !== 'response' || message.responseKind !== 'ok' || message.requestKind !== requestKind) {
    throw new DesktopControlIpcError('INTERNAL', 'Desktop browser response did not match its request.')
  }
  return message
}

/** Desktop Host provider forwarding BrowserControl through the one owned-child IPC client. */
export class DesktopBrowserControl extends BrowserControl {
  /** Create the browser provider over the process-wide requester and cache. */
  constructor(
    ctx: Context,
    readonly requester: DesktopControlRequester,
    readonly leaseCache = new ControlLeaseCache(),
  ) {
    super(ctx)
  }

  /** Forward trusted lease acquisition and cache only Electron's effective descriptor. */
  async acquireLease(
    request: ControlLeaseAcquireRequest,
    signal: AbortSignal,
  ): Promise<ControlLeaseAcquireResult> {
    const message = exactOk(await this.requester.request(request, signal), request.requestKind)
    if (message.requestKind !== 'control.lease.acquire') {
      throw new DesktopControlIpcError('INTERNAL', 'Desktop browser lease response is invalid.')
    }
    return this.leaseCache.remember(request.sessionId, message.result)
  }

  /** Return a service-owned immutable metadata/PNG pair from the verified codec envelope. */
  async snapshot(request: BrowserSnapshotRequest, signal: AbortSignal): Promise<BrowserSnapshotEnvelope> {
    const envelope = await this.requester.request(request, signal)
    const message = exactOk(envelope, request.requestKind)
    if (message.requestKind !== 'browser.snapshot') {
      throw new DesktopControlIpcError('INTERNAL', 'Desktop browser snapshot response is invalid.')
    }
    return freezeBrowserSnapshotEnvelope({
      result: message.result,
      ...(envelope.png === undefined ? {} : { png: envelope.png }),
    })
  }

  /** Forward one closed browser action and return only its associated result type. */
  async act(request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult> {
    const message = exactOk(await this.requester.request(request, signal), request.requestKind)
    return message.result as BrowserActionResult
  }

  /** Invalidate local ownership before sending the exact session revoke control. */
  async revokeSession(sessionId: SessionId): Promise<void> {
    this.leaseCache.take(sessionId)
    await this.requester.revokeSession(sessionId)
  }
}
