/** Per-turn BrowserControl lease ownership and exact protocol request construction. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  BrowserControlError,
  RequestId,
  SessionId,
  type BrowserActionRequest,
  type BrowserActionResult,
  type BrowserControl,
  type BrowserSnapshotEnvelope,
  type ControlLeaseAcquireResult,
  type SessionIdType,
} from '@deepseek-ai/dsh-browser-control'
import { PROTOCOL_LIMITS, PROTOCOL_VERSION } from '@deepseek-ai/dsh-desktop-control-protocol'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'

type StripTransport<T> = T extends unknown
  ? Omit<T, 'protocolVersion' | 'messageKind' | 'requestId' | 'sessionId' | 'deadlineUnixMs' | 'leaseId' | 'leaseRevision'>
  : never
type RequestBody = StripTransport<BrowserActionRequest>

/** Redact provider detail for policy failures whose target may itself be sensitive. */
function mapProviderError(error: unknown): never {
  if (!(error instanceof BrowserControlError)) throw error
  if (error.code === 'POLICY_DENIED' || error.code === 'PERMISSION_DENIED') {
    throw new Error('Browser control was denied because the requested operation targets a protected browser target.', { cause: error })
  }
  if (error.code === 'STALE_REF') {
    throw new Error('The browser reference is stale. Take a new browser_snapshot and use a current ref.', { cause: error })
  }
  if (error.code === 'BUSY') {
    throw new Error('Browser control is currently owned by another session.', { cause: error })
  }
  throw new Error(`Browser control failed (${error.code}).`, { cause: error })
}

function sessionOf(exec: ToolRunContext): SessionIdType {
  const raw: unknown = exec.agent?.session.id
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Browser tools require an official live Harness session.')
  }
  return SessionId(raw)
}

function base<K extends BrowserActionRequest['requestKind'] | 'browser.snapshot' | 'control.lease.acquire'>(
  requestKind: K,
  sessionId: SessionIdType,
) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageKind: 'request' as const,
    requestKind,
    requestId: RequestId(randomUUID()),
    sessionId,
    deadlineUnixMs: Date.now() + PROTOCOL_LIMITS.maxDeadlineAheadMs,
  }
}

/** Owns one BrowserControl lease promise per official session and forgets it at every turn boundary. */
export class BrowserToolController {
  readonly #leases = new Map<SessionIdType, Promise<ControlLeaseAcquireResult>>()

  constructor(
    ctx: Context,
    private readonly provider: BrowserControl,
  ) {
    ctx.on('agent/turn-stopping', ({ agent }) => {
      this.#leases.delete(SessionId(agent.session.id))
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/end') this.#leases.delete(SessionId(session.id))
    })
    ctx.on('session/disposed', (session) => {
      this.#leases.delete(SessionId(session.id))
    })
    ctx.effect(() => () => { this.#leases.clear() }, 'tool-browser-control: forget cached per-turn leases')
  }

  async #lease(exec: ToolRunContext): Promise<{ sessionId: SessionIdType; lease: ControlLeaseAcquireResult }> {
    const sessionId = sessionOf(exec)
    let pending = this.#leases.get(sessionId)
    if (pending === undefined) {
      pending = this.provider.acquireLease({
        ...base('control.lease.acquire', sessionId),
        surfaceKind: 'browser-ephemeral',
        targets: [],
        capabilities: ['observe', 'pointer', 'keyboard'],
      }, exec.signal)
      this.#leases.set(sessionId, pending)
      void pending.catch(() => { this.#leases.delete(sessionId) })
    }
    try {
      return { sessionId, lease: await pending }
    } catch (error: unknown) {
      mapProviderError(error)
    }
  }

  /**
   * Capture one semantic snapshot, requesting verified PNG bytes only when the caller has opted in.
   * @param exec active tool execution and cancellation signal.
   * @param includeImage whether the exact route can consume a PNG attachment.
   * @returns immutable semantic snapshot with an optional paired PNG.
   */
  async snapshot(exec: ToolRunContext, includeImage: boolean): Promise<BrowserSnapshotEnvelope> {
    const { sessionId, lease } = await this.#lease(exec)
    try {
      return await this.provider.snapshot({
        ...base('browser.snapshot', sessionId),
        leaseId: lease.leaseId,
        leaseRevision: lease.leaseRevision,
        includeImage,
      }, exec.signal)
    } catch (error: unknown) {
      this.#forgetRevoked(sessionId, error)
      mapProviderError(error)
    }
  }

  /**
   * Dispatch one member of the protocol-owned browser action roster.
   * @param body closed browser action without authority fields.
   * @param exec active tool execution and cancellation signal.
   * @returns provider-authored browser action result.
   */
  async act(body: RequestBody, exec: ToolRunContext): Promise<BrowserActionResult> {
    const { sessionId, lease } = await this.#lease(exec)
    const request = {
      ...base(body.requestKind, sessionId),
      leaseId: lease.leaseId,
      leaseRevision: lease.leaseRevision,
      ...body,
    } as BrowserActionRequest
    try {
      return await this.provider.act(request, exec.signal)
    } catch (error: unknown) {
      this.#forgetRevoked(sessionId, error)
      mapProviderError(error)
    }
  }

  /**
   * Stop takeover without lease acquisition or approval.
   * @param exec active tool execution used to derive the official session.
   * @returns an acknowledgement after provider cleanup completes.
   */
  async stop(exec: ToolRunContext): Promise<{ stopped: true }> {
    const sessionId = sessionOf(exec)
    this.#leases.delete(sessionId)
    try {
      await this.provider.revokeSession(sessionId)
      return { stopped: true }
    } catch (error: unknown) {
      mapProviderError(error)
    }
  }

  #forgetRevoked(sessionId: SessionIdType, error: unknown): void {
    if (error instanceof BrowserControlError
      && (error.code === 'LEASE_EXPIRED' || error.code === 'LEASE_REVOKED')) {
      this.#leases.delete(sessionId)
    }
  }
}
