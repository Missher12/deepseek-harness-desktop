--- description: "Target-neutral conversation assembly and browser shell: event and view registries, per-session bindings, input state, slots, and temporary composer takeovers." kind: "package-reference" ---

# @deepseek-ai/dsh-client-ui-conversation

English | [中文](README.zh.md)

## Summary

`ui-conversation` owns target-neutral Conversation assembly and the shared browser shell. It consumes Session Controller `SessionEventLikeEntry` feeds, exposes React-free registries and per-Session bindings through `ctx.uiConversation`, and contributes the `useConversation`, `useInput`, and `inputActions` standard props through `ctx.uiSession`. It also owns the per-session durable image URL cache: `ctx.uiConversation.imageUrl(sessionId, attachment)` resolves one session-authorized browser URL per attachment and revokes it with the Session binding, so every Conversation target shares one `session.attachment` read. Concrete targets such as Chat are separate packages that register their own Definitions, snapshot builders, Views, and renderers.

## Table of Contents

- [Conversation assembly](#conversation-assembly)
- [Shell and standard props](#shell-and-standard-props)
- [Temporary composer entries](#temporary-composer-entries)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="conversation-assembly"></a>
## Conversation assembly

`UiConversation.events` is the single registry for event Definitions, and `UiConversation.views` is the single registry for target snapshot builders. Both registries reject duplicate keys, preserve registration order, return idempotent disposers, and rebuild existing bindings when their contribution roster changes. `UiConversation.binding(bindingOrSessionId)` returns one identity-stable Conversation binding for the current Session Controller binding. It does not open another event source. Approvals take over the composer through the chain this package declares: `ApprovalPanel` registers as a selector-routed `'conversation.composer'` entry (the ui-user-questions pattern) and occupies the composer in place of the InputBar while an approval wait is pending (amber strip, justification headline, paired command line from the running call's args, and Reject / Allow once / Don't ask again this session actions). The `PendingApproval` domain face in `contract/slots.ts` owns the wire encoding — the `ApprovalResponsePayload` value with the audit correlation — over the runtime's `PendingWait` carrier; the broadcast `approval/resolved` frame settles the wait and restores the composer. The runtime manager projects every approval or question wait through `SessionSummary.pendingInteraction`, including sessions never instantiated; `ui-workspace` owns its sidebar presentation. Pending waits leave the message flow entirely: questions (ui-user-questions) and approvals (ApprovalPanel) both answer through the composer takeover, so no display-only placeholder card remains. The composer's bottom-row Access seat mounts `PermissionSelect`, fed by the host-computed `permissions` projection through the standard-kit `useProjection` (key absence hides the chip); the chip opens a Menu-primitive dropdown whose kebab-case preset names render as title-case labels. Safe preset picks submit `/permission <preset>` immediately through the bar's injected command face, while `danger-full-access` is presented as `Full access` and first opens an in-page Modal risk confirmation. The approval takeover reuses that exact current-Session command face: its Session action opens the same risk confirmation, runs `/permission danger-full-access`, and answers the current wait as `allowed-once` only after the command succeeds. Permission truth remains in Session events, so another Session is unaffected and switching back to Workspace Write restores later prompts. A command or response failure keeps the card retryable without exposing transport detail; a response retry after Full access never repeats the permission command. This adds no `ApprovalOutcome`, browser persistence, global grant, or cross-Session authority. The enabling action stays disabled until the user checks the acknowledgement; cancel, Escape, close, and mask click submit nothing.

The adapter passes each `SessionEventLikeEntry` directly to the assembler. Its outer `type` distinguishes scalar and packed records, while its inner `event` always exposes `type`, `seq`, `time`, and `data`; Definitions receive that inner `SessionEventLike`. Historical replace and prepend accept both entry variants, while live append accepts only `SessionLiveEventEntry`. Every Definition uses the same `match` and `update` methods for both event forms, while `start` receives only a standard event and the assembler rejects a packed start. Definitions that do not consume Assistant deltas return `null` for the packed tags. Replacement windows and revision gaps rebuild from the complete loaded window; contiguous append and prepend revisions use incremental assembly without expanding packed members. The assembler owns Context matching, Turn/Step locations, target node materialization, target activity, and stable target sources. `ConversationSnapshot` contains only target-neutral views and active-target facts; Session lifecycle state remains in `SessionSnapshot`.

A target becomes active when shell selection resolves it or when its source receives a first subscriber. The assembler replaces that target from current Contexts once and keeps it active for later incremental flushes; creating a source does not activate it and unsubscription does not deactivate it.

Target packages declaration-merge their snapshot and Location data maps, then register with `ctx.uiConversation.events.register(...)` and `ctx.uiConversation.views.register(...)`. A target reads its Session-owned source with `ctx.uiConversation.binding(binding).target(targetId)`. Registrations are Cordis effects and their returned disposers remove the contribution from the same registry. The one strict exception is the removable session-messenger relay form. A user-role node renders a visible relay card only when its durable source identifies `kind: plugin`, `plugin: dsh-session-messenger`, `form: relay`, a valid sender Session ID and delivery ID, `bodyBlockIndex: 1`, and exactly two text blocks. The card separates trusted source/delivery metadata from the untrusted body, keeps both visible in the transcript, and exposes copy plus a receipt-bound reply event. It neither reads nor stores reply authority; the Host owns that capability. Any old, malformed, partially loaded, or foreign record fails closed to the ordinary context renderer instead of being misclassified or hidden.

A Think row stays collapsed by default and exposes live reasoning throughput without expanding the chain of thought: while its reasoning block is the streaming tail, the summary switches from the settled first line to the latest non-blank line and its one-line scrollport follows each delta to the inline end. Expanding the row removes the moving summary and leaves the full reasoning in ordinary page flow, so page reading never fights an internal follower; settlement restores the stable first-line summary at the left edge ([decision](../../../.agents/notes/implemented/feature/2026-08-02-web-thinking-tail-scroll.md)).

<a id="shell-and-standard-props"></a>
## Shell and standard props

The package registers the optional-Session `conversation` shell, strict Session header/body entries, View list, composer chain and bar, input regions, Hero regions, queue dock, draft persistence, and phase calculation. `ctx.uiSession.provide()` materializes the Conversation and input sources from the same Session binding and supplies `inputActions` as a stable standard prop.

View selection is deterministic: a registered persisted selection wins, otherwise registered `chat` wins, otherwise no View renders. It never chooses the first registered View. Shell phase combines Session lifecycle with the active-target set; no target-specific snapshot is read by the shell.

The shell reads the persisted View preference before rendering when a Session first binds or a cached Session becomes current, activates the registered preferred View or Chat fallback, and activates later tab or focus selections before committing them to the store. A blank Session still omits the `conversation.view` slot; no unselected target is activated.

The resident composer survives no-Session and Session transitions. The no-Session state keeps the same composer surface mounted but inert while the Workspace picker connects a blank Session. The surface is a shell-owned Lexical editor: reference chips are atomic decorator nodes carrying the owner's serialization identity (submission expands them through the owner codec), claimed slash commands stay styled leading text, folder text references carry the folder glyph as an icon prefix, and the draft's clipboard projection is mirrored into the per-Session Conversation store. Queue operations address exact queue occurrences through the scoped `ctx.conversation` service; queue previews render sent text through the shared inline reference projection from `ui-primitives` (wire session forms fold to their label) and show local image previews or durable image parts as thumbnails, while an edit exposes the literal sent text. Durable thumbnails resolve through the session image URL cache. Busy Enter behavior is stored in the Host-backed `ui-conversation` settings namespace.

Default sends commit optimistically: Enter clears the draft, occurrence table, and undo history in the same transaction, keeps the composer in `plain`, and runs the send as a detached attempt, so typing and further sends continue during the flight. `sendSession` registers a Session submission echo (`session.beginSubmission`) with the delivery mode before serializing; Session derives the placement from that mode and its current running state, so idle sends use the transcript, busy Queue sends use QueueDock, and busy Steer sends use the pending-steering surface. It then yields one paint and encodes images through the browser's native `FileReader` data-URL path. Concurrent failures are restored together in submission order until the user edits the restored content; command submissions keep the frozen `submitting` phase. Detached attempts retain their image ids through admission and Session scope disposal. When an echo retires as observed, the durable image cache exposes its preview immediately, fetches the admitted attachment, replaces the preview with the canonical URL, and revokes each URL after its use ends. Direct subagent continuations skip local echoes because their transport does not preserve the browser request id.

While a normal composer is running, its primary pointer action remains Stop when the draft is empty or input is unavailable. Actionable text or attachments switch the same seat to Queue Send; clearing or successfully submitting the draft restores Stop. The busy-Enter setting continues to select the Queue or Steer keyboard action. Continuable subagents keep separate Send and Stop actions ([decision](../../../.agents/notes/implemented/bug-fix/2026-08-20-running-draft-primary-send.md)).

<a id="temporary-composer-entries"></a>
## Temporary composer entries

`conversation.composer` is a generic chain. Its complete owner currency is: The composer bar declares session-scoped single seats for `'conversation.input.plan'` (right of the local access-mode control) and `'conversation.input.model'` (immediately before the pending indicator and send/stop controls), plus list slots for overlay, dock, left, and right input extensions. Feature packages own each control and its state; ui-conversation supplies placement, the `locked` owner prop, and the standard slot shares. The leading plus button opens a compact Codex-style Add menu while retaining ui-input-trigger's sole `MenuView` and pick path: the `composer-add` source contributes files/folders and images, the existing command source preserves every command while promoting Goal and Plan into the Add section, and the skill source lists currently callable plugins. Files/folders continue through the existing `@` reference flow; images enter the existing attachment intake, limits, and preview rail through a hidden file input. No upload protocol or second menu component is introduced. While the `plan` projection's effective target is plan mode, InputBar swaps its textarea placeholder to the plan-task wording, localized through the `conversation` locale namespace this package registers (the `placeholder.plan` / `hint.plan` keys) and shared verbatim with the claimed `/plan` command hint (a host-folded value read through the standard-kit `useProjection`; owner-supplied placeholders win). A pending composer takeover remains mounted when another conversation view is active so the blocked agent can still receive its answer; without a pending interaction, the active-session composer belongs to Chat. The composer-bar slot itself is `session-maybe`: with no current session the same bar keeps message actions inert (machine faces absent, `disabled` owner prop), while the whole dashed card opens the existing Workspace picker by pointer and the read-only textarea opens it through Enter or Space. Disabled controls release pointer events to the card, and the card contains `pointerdown` so the open picker's outside-close cannot race a reopen. The bar never swaps in a parallel tree, so the textarea DOM survives Workspace selection; strict-session control seats stay empty until a session exists.

```ts type-equiv
/** Owner values used to elect a composer takeover. */
interface ComposerChainProps {
  /** Current Session identity used by temporary business-owned entries. */
  sessionId: SessionId | undefined
  /** Current Session lifecycle state, absent without a selected Session. */
  session: SessionSnapshot | undefined
  /** Effective business-owned interaction awaiting the user in this Session. */
  pendingInteraction: SessionPendingInteraction | undefined
}
```

A business package may install one entry only while a Remote waterfall request is pending:

```tsx
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChainSelect, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface Request {
  readonly sessionId: SessionId
}

type RequestComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: Request }

const select: ChainSelect<ComposerChainProps, Request> = owner =>
  owner.sessionId === request.sessionId ? request : null

const dispose = ctx.slots.register(
  { name: 'conversation.composer', select },
  RequestComposer,
)

try {
  return await request.result
} finally {
  dispose()
}
```

The selector must be a pure function of the owner currency. Its non-null return is delivered to the component as `matched`; `PropsRuntime<'conversation.composer'>` supplies the standard Session and global props. Chain order remains ascending `priority`, then registration order, and the first non-null selector wins. The shell keeps the default composer mounted beneath a takeover. Request state, listeners, response encoding, and any request-specific child slots belong to the business package; they are not carried by `SessionSnapshot` or declared by this core package.

<a id="model-experience"></a>
## Model Experience

None, as this package renders browser state and sends user-admitted inputs through Session Controller APIs without constructing model requests.

#### KV Cache effect

None; Conversation assembly and browser input state do not alter provider-side prompt caching.

## Known Limitations and Deferred Work

- **The stats-line fallback fold covers the in-window flow only** — without the `sessionStats` projection (an assembly that does not mount the unit), every figure folds the snapshot's assistant `timing` and tool call/result pairs, so nodes outside the loaded event window (older history) are not counted and the numbers grow per loaded page.
- **The details panel has no entry point** — `ChatViewInjected.openDetails` is implemented but uncalled, so the raw selected-call display is unreachable in the assembled application. There is no Input/Output/Metadata switch, Prev/Next stepping, or trajectory deep link.
- **Assistant per-message paging is a reserved slot** — drawn in the design, not implemented. The finalized content IconActions row (copy / clock / branch) ships under the last content-text assistant of each turn that has ended; mid-turn narration, Think-only nodes, and every node of a turn still producing steps stay chrome-free. Branch stays disabled unless that message is also the last transcript node of a completed turn; when enabled, it forks through that turn, increments the inherited title on the client, and opens the child. A fork or rename failure leaves the source selected ([decision](../../../.agents/notes/implemented/bug-fix/2026-08-02-message-fork-actions-require-completed-turn-tail.md)).
- **Sent user messages cannot be edited** — user bubbles retain clock and copy; branch lives only under assistant answers ([decision](../../../.agents/notes/implemented/simplification/2026-08-06-user-bubbles-drop-the-branch-action.md)). Editing returns with the capability behind it: a client mutation over a settled user message, plus the host behavior for the turn that already consumed it ([decision](../../../.agents/notes/implemented/simplification/2026-07-31-drop-user-message-edit-stub.md)).
- **The sparkle icon for the others tool row is a hand-drawn approximation** — the design glyph's vector geometry is not exportable locally; promotion into ui-primitives waits on an exact export.
- **TodoPanel truncates long item text to one ellipsized line** — the figma strip has no wrap or expand affordance; full text is not readable inline.
- **Queue edit is text-only** — rows containing non-text blocks still show a flattened preview, but their edit control is disabled because the inline editor cannot preserve those blocks. A text row's edit mode replaces delete and strict steer with save and cancel; Enter saves and Escape cancels.
- **Queue strict steer preserves complete messages** — while the Agent is running, the steer action atomically transfers the addressed Queue occurrence into the current next-step window. Mixed-content rows remain eligible because the action forwards the immutable message instead of the text projection. The placement-aware Host snapshot renders pending steering at the conversation tail until the consumed `user/message` folds into the durable transcript, so immediate display, reconnect, and replay share one linear authority.

<a id="known-limitations-and-deferred-work"></a>

- **Only registered targets can render** — the shell deliberately has no implicit fallback target beyond the registered `chat` preference.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Conversation Definitions, target builders, and Views are already validated by their owning registries and the Slot ledger.
