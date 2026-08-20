/**
 * Cross-domain sessions face: the contract surface sibling domains (today:
 * workspaces) consume instead of the sessions implementation. The sessions
 * domain satisfies it structurally — SessionRuntime is assignable, checked
 * wherever the assembly layer or a test injects the real service — so
 * widening this face is the explicit act of widening the inter-domain
 * dependency.
 */

import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot } from './store.ts'

/** Session-list row facts sibling domains read for root-session reuse and selection. */
export interface SessionsPortSummary {
  id: SessionId
  /** Empty-log bit (blank sessions are reused by New Session instead of minting another). */
  blank: boolean
  /** A parent identifies a non-root session that New Session must never reuse. */
  parentId?: SessionId
  /** Coarse lineage fallback for summaries whose parent is not currently projected. */
  origin?: 'subagent'
  cwd?: string
  updatedAt: number
}

/** Session-list facts sibling domains read: readiness, selection, and the row map. */
export interface SessionsPortList {
  ids: SessionId[]
  byId: Record<SessionId, SessionsPortSummary>
  current: SessionId | undefined
  phase: 'pending' | 'ready'
}

/** The sessions-service face injected into sibling domains. */
export interface SessionsPort {
  /** Observable list snapshot (read face only; writes stay inside the sessions domain). */
  readonly list: ObservableSnapshot<SessionsPortList>
  /**
   * Create a session on the host.
   * @param opts - optional target workspace. Omit it for an unowned session.
   * @returns the new session id.
   */
  create(opts?: { workspaceId?: WorkspaceId }): Promise<SessionId>
  /**
   * Select a session as current.
   * @param id - session id (must exist in the list store).
   */
  open(id: SessionId): void
  /** Clear the current selection into the no-session view state. */
  clear(): void
}
