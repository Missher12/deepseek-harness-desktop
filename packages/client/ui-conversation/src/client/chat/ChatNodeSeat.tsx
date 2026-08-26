import { memo, useMemo } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import css from './ChatView.module.css'

const EMPTY_PROMPT_ANCHORS: readonly never[] = []

interface ChatNodeSeatProps extends Omit<ChatNodeOwnerProps, 'editUnavailable'> {
  readonly nodeKey: string
  readonly useSession: ChatViewSlotProps['useSession']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, selectedCallId, cwd, openFile, inspectCall, forkAt, editFrom,
  renderMessageImages, fileMentions, useSession, renderSlot, t,
}: ChatNodeSeatProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  const promptAnchors = useSession(snapshot => snapshot.promptAnchors ?? EMPTY_PROMPT_ANCHORS)
  const running = useSession(snapshot => snapshot.running)
  const subagent = useSession(snapshot => snapshot.subagent)
  const removed = useSession(snapshot => snapshot.removed)
  const routedNode = node as ChatNode | undefined
  const editableAnchor = routedNode?.kind === 'user'
    ? promptAnchors.find(anchor => anchor.seq === routedNode.data.seq)
    : undefined
  const editUnavailable = editableAnchor?.kind !== 'turn-opening'
    || !editableAnchor.completed
    || running
    || subagent !== null
    || removed
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      selectedCallId,
      cwd,
      openFile,
      inspectCall,
      forkAt,
      editFrom,
      editUnavailable,
      renderMessageImages,
      fileMentions,
    }, [
    node, selectedCallId, cwd, openFile, inspectCall, forkAt, editFrom, editUnavailable,
    renderMessageImages, fileMentions,
  ])
  if (routedNode === undefined || owner === null) return null
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  return (
    <div
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
      data-user-message-seq={routedNode.kind === 'user' || routedNode.kind === 'steering'
        ? routedNode.data.seq
        : undefined}
    >
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: nodeKey,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})
