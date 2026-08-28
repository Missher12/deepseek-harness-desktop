/** Per-turn ComputerControl target, revision, quota, and lease ownership. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  ComputerControlError,
  RequestId,
  SessionId,
  assertComputerActionCount,
  type ComputerActionRequest,
  type ComputerActionResult,
  type ComputerControl,
  type ComputerControlStatus,
  type ComputerListResult,
  type ComputerSnapshotEnvelope,
  type ControlLeaseAcquireResult,
  type SessionIdType,
} from '@deepseek-ai/dsh-computer-control'
import {
  ERROR_CODES,
  PROTOCOL_LIMITS,
  PROTOCOL_VERSION,
  type ControlLeaseTarget,
  type DesktopControlErrorCode,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'

type Target = Readonly<{ appId: string; windowId: string }>
type ActionBody = ComputerActionRequest extends infer Request
  ? Request extends ComputerActionRequest
    ? Omit<Request, 'protocolVersion' | 'messageKind' | 'requestId' | 'sessionId' | 'deadlineUnixMs' | 'leaseId' | 'leaseRevision' | 'snapshotRevision'>
    : never
  : never

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES)

function providerCode(error: unknown): DesktopControlErrorCode | undefined {
  if (error instanceof ComputerControlError) return error.code
  if (error === null || typeof error !== 'object' || Array.isArray(error)) return undefined
  const value: unknown = Object.getOwnPropertyDescriptor(error, 'code')?.value
  return typeof value === 'string' && ERROR_CODE_SET.has(value)
    ? value as DesktopControlErrorCode
    : undefined
}

function mapProviderError(error: unknown): never {
  const code = providerCode(error)
  if (code === undefined) throw error
  if (code === 'POLICY_DENIED' || code === 'PERMISSION_DENIED') {
    throw new Error('Computer control was denied because the requested operation or target is protected.', { cause: error })
  }
  if (code === 'STALE_REF') {
    throw new Error('The computer reference is stale. Take a new computer_snapshot and use a current ref.', { cause: error })
  }
  if (code === 'BUSY') throw new Error('Computer control is currently owned by another session.', { cause: error })
  throw new Error(`Computer control failed (${code}).`, { cause: error })
}

function sessionOf(exec: ToolRunContext): SessionIdType {
  const raw: unknown = exec.agent?.session.id
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Computer tools require an official live Harness session.')
  }
  return SessionId(raw)
}

function base<K extends ComputerActionRequest['requestKind'] | 'computer.list' | 'computer.snapshot' | 'control.lease.acquire'>(
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

function targetKey(target: Target): string {
  return `${target.appId}\u0000${target.windowId}`
}

interface SessionState {
  targets?: readonly ControlLeaseTarget[]
  revisions: Map<string, number>
  actions: number
  lease?: Promise<ControlLeaseAcquireResult>
}

/** Owns only turn-local model state; Electron remains the sole lease authority. */
export class ComputerToolController {
  readonly #sessions = new Map<SessionIdType, SessionState>()

  constructor(
    ctx: Context,
    private readonly provider: ComputerControl,
  ) {
    ctx.on('agent/turn-stopping', ({ agent }) => { this.#sessions.delete(SessionId(agent.session.id)) })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/end') this.#sessions.delete(SessionId(session.id))
    })
    ctx.on('session/disposed', (session) => { this.#sessions.delete(SessionId(session.id)) })
    ctx.effect(() => () => { this.#sessions.clear() }, 'tool-computer-control: forget turn-local target ownership')
  }

  /** Read availability without creating a lease. */
  async status(exec: ToolRunContext): Promise<ComputerControlStatus> {
    try { return await this.provider.status(sessionOf(exec)) } catch (error: unknown) { mapProviderError(error) }
  }

  /** Enumerate and retain the exact grantable target pairs for this turn. */
  async list(exec: ToolRunContext): Promise<ComputerListResult> {
    const sessionId = sessionOf(exec)
    try {
      const result = await this.provider.list(base('computer.list', sessionId), exec.signal)
      const state = this.#state(sessionId)
      state.targets = Object.freeze(result.apps.map(app => Object.freeze({
        appId: app.appId,
        windowIds: Object.freeze(app.windows.map(window => window.windowId)),
      })))
      for (const target of state.targets) {
        for (const windowId of target.windowIds) {
          state.revisions.set(targetKey({ appId: target.appId, windowId }), 1)
        }
      }
      return result
    } catch (error: unknown) {
      mapProviderError(error)
    }
  }

  /** Capture one target and update the provider-authored target revision. */
  async snapshot(target: Target, exec: ToolRunContext, includeImage: boolean): Promise<ComputerSnapshotEnvelope> {
    const { sessionId, state, lease } = await this.#lease(target, exec)
    try {
      const envelope = await this.provider.snapshot({
        ...base('computer.snapshot', sessionId),
        leaseId: lease.leaseId,
        leaseRevision: lease.leaseRevision,
        ...target,
        snapshotRevision: this.#revision(state, target),
        includeImage,
      }, exec.signal)
      state.revisions.set(targetKey(target), envelope.result.snapshotRevision)
      return envelope
    } catch (error: unknown) {
      this.#forgetTerminal(state, error)
      mapProviderError(error)
    }
  }

  /** Dispatch one closed target action and update its provider-authored revision. */
  async act(body: ActionBody, exec: ToolRunContext): Promise<ComputerActionResult> {
    const target = { appId: body.appId, windowId: body.windowId }
    const { sessionId, state, lease } = await this.#lease(target, exec)
    state.actions = assertComputerActionCount(state.actions + 1)
    const request = {
      ...base(body.requestKind, sessionId),
      leaseId: lease.leaseId,
      leaseRevision: lease.leaseRevision,
      snapshotRevision: this.#revision(state, target),
      ...body,
    } as ComputerActionRequest
    try {
      const result = await this.provider.act(request, exec.signal)
      state.revisions.set(targetKey(target), result.snapshotRevision)
      return result
    } catch (error: unknown) {
      this.#forgetTerminal(state, error)
      mapProviderError(error)
    }
  }

  /** Stop without acquiring a lease or invoking Harness approval. */
  async stop(exec: ToolRunContext): Promise<{ stopped: true }> {
    const sessionId = sessionOf(exec)
    this.#sessions.delete(sessionId)
    try {
      await this.provider.stop(sessionId)
      return { stopped: true }
    } catch (error: unknown) {
      mapProviderError(error)
    }
  }

  async #lease(target: Target, exec: ToolRunContext) {
    const sessionId = sessionOf(exec)
    const state = this.#state(sessionId)
    if (state.targets === undefined) await this.list(exec)
    const targets = state.targets ?? []
    const allowed = targets.some(entry => entry.appId === target.appId && entry.windowIds.includes(target.windowId))
    if (!allowed) throw new Error('The requested app and window are not in the current computer_list result.')
    state.lease ??= this.provider.acquireLease({
      ...base('control.lease.acquire', sessionId),
      surfaceKind: 'native-application',
      targets,
      capabilities: ['observe', 'pointer', 'keyboard'],
    }, exec.signal)
    void state.lease.catch(() => {
      if (this.#sessions.get(sessionId) === state) delete state.lease
    })
    try {
      return { sessionId, state, lease: await state.lease }
    } catch (error: unknown) {
      mapProviderError(error)
    }
  }

  #state(sessionId: SessionIdType): SessionState {
    let state = this.#sessions.get(sessionId)
    if (state === undefined) {
      state = { revisions: new Map(), actions: 0 }
      this.#sessions.set(sessionId, state)
    }
    return state
  }

  #revision(state: SessionState, target: Target): number {
    return state.revisions.get(targetKey(target)) ?? 1
  }

  #forgetTerminal(state: SessionState, error: unknown): void {
    const code = providerCode(error)
    if (code === 'LEASE_EXPIRED' || code === 'LEASE_REVOKED') delete state.lease
  }
}
