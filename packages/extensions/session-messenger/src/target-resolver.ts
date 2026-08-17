/** Ordinary-session resolution through the Host-owned Typert policy seam. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TypertLookupFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-workspace'
import { messengerError } from './types.ts'

/** Maximum accepted encoded Session ID bytes. */
export const MAX_SESSION_ID_BYTES = 256

const PRINTABLE_SESSION_ID = /^[\x21-\x7e]+$/

/** Validate and brand one externally copied ordinary Session ID. */
export function parseTargetSessionId(raw: string): SessionId {
  if (!PRINTABLE_SESSION_ID.test(raw)
    || new TextEncoder().encode(raw).byteLength > MAX_SESSION_ID_BYTES) {
    throw messengerError('invalid-target-id', 'target_session_id must be 1-256 printable ASCII bytes')
  }
  return SessionId(raw)
}

/**
 * Final synchronous policy fence used both after lookup and directly before
 * enqueue. It deliberately performs no resolution or mutation.
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
 */
export async function resolveOrdinaryTarget(
  ctx: Context,
  caller: Agent,
  raw: string,
): Promise<Agent> {
  return resolveOrdinaryTargetForSource(ctx, caller.id, raw)
}

/** Resolve for durable recovery when only the original source identity exists. */
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
  if (!(error instanceof TypertLookupFailure)) {
    return messengerError('target-lookup-failed', 'target lookup failed', { cause: error })
  }
  const failure: unknown = error.failure
  if (typeof failure === 'object' && failure !== null && 'code' in failure) {
    const code = (failure as { code?: unknown }).code
    if (code === 'session-not-found') {
      return messengerError('target-not-found', 'target session was not found', { cause: error })
    }
    if (code === 'agent-busy') {
      return messengerError('target-subagent', 'subagent sessions require subagent delivery', { cause: error })
    }
  }
  return messengerError('target-lookup-failed', 'target lookup policy rejected the session', { cause: error })
}
