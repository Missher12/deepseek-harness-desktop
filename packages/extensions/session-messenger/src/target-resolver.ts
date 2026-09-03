/** Ordinary-session resolution through the Host-owned Typert policy seam. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-workspace'
import { messengerError } from './types.ts'

/** Maximum accepted encoded Session ID bytes. */
export const MAX_SESSION_ID_BYTES = 256

const PRINTABLE_SESSION_ID = /^[\x21-\x7e]+$/

function parseSessionId(raw: string, code: 'invalid-target-id' | 'invalid-source-id'): SessionId {
  if (!PRINTABLE_SESSION_ID.test(raw)
    || new TextEncoder().encode(raw).byteLength > MAX_SESSION_ID_BYTES) {
    throw messengerError(code, 'session id must be 1-256 printable ASCII bytes')
  }
  return SessionId(raw)
}

/**
 * Validate and brand one externally copied ordinary Session ID.
 * @param raw - untrusted Session ID copied into a tool request.
 * @returns the printable, byte-bounded branded Session ID.
 */
export function parseTargetSessionId(raw: string): SessionId {
  return parseSessionId(raw, 'invalid-target-id')
}

/**
 * Resolve the browser-displayed sender only from the currently live Agent map.
 * This intentionally never cold-resumes a copied identity.
 * @param ctx - Cordis context exposing current workspace and Agent ownership state.
 * @param raw - untrusted displayed source Session ID.
 * @returns the live ordinary Agent after archive, ownership, and nonblank checks.
 */
export function resolveOrdinaryOperatorSource(ctx: Context, raw: string): Agent {
  const requestedId = parseSessionId(raw, 'invalid-source-id')
  if (ctx.workspaceRegistry.archivedSessionIds.includes(requestedId)) {
    throw messengerError('source-archived', 'source session is archived')
  }
  const source = ctx.agents.get(requestedId)
  if (source === undefined) throw messengerError('source-not-found', 'source session is not live')
  if (isSubagentOwned(ctx, source)) {
    throw messengerError('source-subagent', 'subagent sessions cannot use the operator surface')
  }
  if (!source.session.snapshotEvents().some(event => event.type === 'turn/start')) {
    throw messengerError('source-blank', 'source session has no established turn')
  }
  return source
}

/**
 * Final synchronous policy fence used both after lookup and directly before
 * enqueue. It deliberately performs no resolution or mutation.
 * @param ctx - Cordis context exposing workspace and Agent ownership state.
 * @param target - already resolved target to validate immediately before enqueue.
 */
export function assertTargetStillOrdinaryAndUnarchived(ctx: Context, target: Agent): void {
  if (ctx.workspaceRegistry.archivedSessionIds.includes(target.id)) {
    throw messengerError('target-archived', 'target session is archived')
  }
  if (isSubagentOwned(ctx, target)) {
    throw messengerError('target-subagent', 'subagent sessions require subagent delivery')
  }
}

/**
 * Resolve a copied identity only through the ApiProxy-configured Typert Agent
 * lookup. This preserves cold-resume deduplication, recorded presets, and Host
 * ownership policy; the plugin never calls `ctx.agents.resume()`.
 * @param ctx - Cordis context providing the Host-owned Typert lookup.
 * @param caller - ordinary source Agent whose own identity is forbidden as target.
 * @param raw - untrusted copied target Session ID.
 * @returns the resolved ordinary, unarchived target Agent.
 */
export async function resolveOrdinaryTarget(
  ctx: Context,
  caller: Agent,
  raw: string,
): Promise<Agent> {
  return resolveOrdinaryTargetForSource(ctx, caller.id, raw)
}

/**
 * Resolve for durable recovery when only the original source identity exists.
 * @param ctx - Cordis context providing the Host-owned Typert lookup.
 * @param sourceSessionId - durable source identity used for self-target rejection.
 * @param raw - persisted target Session ID to validate and resolve.
 * @returns the resolved ordinary, unarchived target Agent.
 */
export async function resolveOrdinaryTargetForSource(
  ctx: Context,
  sourceSessionId: SessionId,
  raw: string,
): Promise<Agent> {
  const requestedId = parseTargetSessionId(raw)
  if (requestedId === sourceSessionId) throw messengerError('self-target', 'cannot message the calling session')
  if (ctx.workspaceRegistry.archivedSessionIds.includes(requestedId)) {
    throw messengerError('target-archived', 'target session is archived')
  }

  const lookup = ctx.typert.lookups.get('agent')
  if (lookup === undefined) {
    throw messengerError('target-lookup-unavailable', 'Host Agent lookup is unavailable')
  }

  let target: Agent | undefined
  try {
    target = await lookup.resolve(requestedId) as Agent | undefined
  } catch (error: unknown) {
    throw normalizeLookupError(error)
  }
  if (target === undefined) throw messengerError('target-not-found', 'target session was not found')
  if (target.id === sourceSessionId) throw messengerError('self-target', 'cannot message the calling session')
  assertTargetStillOrdinaryAndUnarchived(ctx, target)
  return target
}

function isSubagentOwned(ctx: Context, target: Agent): boolean {
  if (target.session.header.origin === 'subagent') return true
  const parentId = target.session.header.parentSession
  if (parentId === undefined) return false
  const parent = ctx.agents.get(parentId)
  return parent !== undefined && ctx.agents.isOwnedBy(target.id, parent)
}

function normalizeLookupError(error: unknown): Error {
  const failure = remoteErrorOf(error)
  if (failure === undefined) {
    return messengerError('target-lookup-failed', 'target lookup failed', { cause: error })
  }
  if (failure.code === 'session/not-found') {
    return messengerError('target-not-found', 'target session was not found', { cause: error })
  }
  if (failure.code === 'session/agent-busy') {
    return messengerError('target-subagent', 'subagent sessions require subagent delivery', { cause: error })
  }
  return messengerError('target-lookup-failed', 'target lookup policy rejected the session', { cause: error })
}
