/**
 * Desktop compatibility exports over the alpha.5 client object layer.
 *
 * The package intentionally owns no live services: official alpha.5 Session,
 * Workspace, Conversation, renderer, and store plugins remain the single
 * runtime truth. Desktop-only extensions import this stable facade while they
 * migrate to those focused packages.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Client-side Cordis context after the official plugins augment it. */
export type ClientContext = Context

/** Compatibility module only: official alpha.5 packages own every live service. */
export function apply(_ctx: ClientContext): void {}

export { createSnapshotStore, defineStore, shallowEqual } from '@deepseek-ai/dsh-client-store'
export type {
  EngineStoreHandle, EngineStoreInstance, ObservableSnapshot, SnapshotStore,
} from '@deepseek-ai/dsh-client-store'

export type { RootOwnerProps } from '@deepseek-ai/dsh-client-ui-renderer/client'

export type {
  SessionBinding, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
export type { SessionId } from '@deepseek-ai/dsh-session/types'
export type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

export type {
  ContextMessageNode, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
