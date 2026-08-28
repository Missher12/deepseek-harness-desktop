import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  ComputerControl,
  freezeComputerList,
  freezeComputerSnapshotEnvelope,
} from '@deepseek-ai/dsh-computer-control'
import type {
  ComputerActionRequest,
  ComputerActionResult,
  ComputerSnapshotEnvelope,
} from '@deepseek-ai/dsh-computer-control'
import {
  PROTOCOL_LIMITS,
  RequestId,
  type ComputerListRequest,
  type ComputerListResult,
  type ComputerSnapshotRequest,
  type ComputerStatusResult,
  type ControlLeaseAcquireRequest,
  type ControlLeaseAcquireResult,
  type DecodedDesktopControlEnvelope,
  type SessionId,
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
    throw new DesktopControlIpcError('INTERNAL', 'Desktop computer response did not match its request.')
  }
  return message
}

/** Desktop Host provider forwarding ComputerControl through the one owned-child IPC client. */
export class DesktopComputerControl extends ComputerControl {
  /** Create the native provider over the process-wide requester and cache. */
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
      throw new DesktopControlIpcError('INTERNAL', 'Desktop computer lease response is invalid.')
    }
    return this.leaseCache.remember(request.sessionId, message.result)
  }

  /** Forward the tool-runtime-authored official session for the parameter-free model seam. */
  async status(sessionId: SessionId): Promise<ComputerStatusResult> {
    const nowUnixMs = Date.now()
    const request = {
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'computer.status',
      requestId: RequestId(randomUUID()),
      sessionId,
      deadlineUnixMs: nowUnixMs + PROTOCOL_LIMITS.maxDeadlineAheadMs,
    } as const
    const message = exactOk(await this.requester.request(request, new AbortController().signal), request.requestKind)
    if (message.requestKind !== 'computer.status') {
      throw new DesktopControlIpcError('INTERNAL', 'Desktop computer status response is invalid.')
    }
    return message.result
  }

  /** Forward one bounded grantable-app enumeration. */
  async list(request: ComputerListRequest, signal: AbortSignal): Promise<ComputerListResult> {
    const message = exactOk(await this.requester.request(request, signal), request.requestKind)
    if (message.requestKind !== 'computer.list') {
      throw new DesktopControlIpcError('INTERNAL', 'Desktop computer list response is invalid.')
    }
    return freezeComputerList(message.result)
  }

  /** Return a service-owned immutable metadata/PNG pair from the verified codec envelope. */
  async snapshot(request: ComputerSnapshotRequest, signal: AbortSignal): Promise<ComputerSnapshotEnvelope> {
    const envelope = await this.requester.request(request, signal)
    const message = exactOk(envelope, request.requestKind)
    if (message.requestKind !== 'computer.snapshot') {
      throw new DesktopControlIpcError('INTERNAL', 'Desktop computer snapshot response is invalid.')
    }
    return freezeComputerSnapshotEnvelope({
      result: message.result,
      ...(envelope.png === undefined ? {} : { png: envelope.png }),
    })
  }

  /** Forward one closed native action and return only its associated result type. */
  async act(request: ComputerActionRequest, signal: AbortSignal): Promise<ComputerActionResult> {
    const message = exactOk(await this.requester.request(request, signal), request.requestKind)
    return message.result as ComputerActionResult
  }

  /** Invalidate local ownership before sending the exact session revoke control. */
  async stop(sessionId: SessionId): Promise<void> {
    this.leaseCache.take(sessionId)
    await this.requester.revokeSession(sessionId)
  }
}
