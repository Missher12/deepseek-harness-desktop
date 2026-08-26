# Codex-Style Prompt Rail and Safe Rewind Design

English | [中文](2026-08-26-codex-prompt-rail-safe-rewind-design.zh.md)

## Goal

Add two shared cross-platform capabilities to DeepSeek Harness without rewriting or deleting the source conversation:

1. A Codex-style prompt rail that locates the user's prior messages.
2. Codex-style “Edit and continue from here” and “Continue from here” actions implemented as lineage-preserving session branches.

Mac and Windows use the same Web, Client Runtime, and Host behavior. The Desktop shells do not carry platform-specific copies.

## Existing Foundation

Harness already has durable sessions, message-aligned history paging, stable event sequence numbers, session lineage, and `session.fork`. Completed assistant turns already expose a branch action. This feature therefore extends the existing fork contract and message action strip instead of adding a second rollback database or truncating JSONL/SQLite history.

## Interaction Design

### Prompt Rail

- The rail overlays the right-side gutter of the conversation scroller. It neither shrinks the message column nor changes workbench pane widths.
- Each marker represents a real user input. Turn-opening and in-turn steering messages are navigable, but steering messages are navigation-only and cannot be edit-rewind targets.
- The marker nearest the viewport is active; the latest user message uses the stronger brand color.
- Activating a marker scrolls to the exact user bubble. If the target belongs to an unloaded older page, history is loaded on demand and only that marker shows lightweight progress.
- Hover and keyboard focus show time plus a local preview capped at 48 characters. Context injection, tool output, reasoning content, and attachment bodies never enter the preview.
- A conversation with one user message does not show the full rail. Narrow panes retain thin markers and keyboard access without causing content reflow.
- Arrow keys, Home, End, and Enter are supported. Reduced-motion mode uses an immediate scroll.

### Message Actions

- The existing hover action strip on a user bubble gains “Edit and continue from here.” It never sends automatically.
- The existing branch action on a completed assistant turn is retained with the user-facing label “Continue from here.”
- “Edit and continue from here” creates a child immediately before the target user message, opens it, and places the original text and recoverable attachments in the composer.
- “Continue from here” creates and opens a child containing the target's full completed turn.
- The source conversation, its responses, and its later tail always remain intact. The new sidebar row uses the existing incremented-title behavior and `parentSession` lineage.
- Edit-rewind is unavailable while the Agent is running, while the target turn is open, when the target is not the turn-opening user message, or when durable history is unavailable. The UI names the exact reason.
- No persistent large rewind button is added, and permanent history deletion is out of scope.

## Data and API

### Prompt Anchor

The initial tail `session.history` response carries lightweight `promptAnchors` folded during the same authoritative history read, avoiding another round trip:

```ts
interface PromptAnchor {
  seq: number
  turn: number
  time: number
  kind: 'turn-opening' | 'steering'
  preview: string
  completed: boolean
}
```

The Host derives this projection from the same event cut. Client Runtime incrementally updates it as live `user/message` and `turn/end` frames arrive. This is a transport projection, not a Session-format change, so it does not require a log version bump. A fixed-row virtualized rail mounts only its visible marker window for large anchor sets.

### Safe Fork

The existing `session.fork` keeps its default `through-turn` behavior and gains one backward-compatible optional position:

```ts
type ForkPosition = 'through-turn' | 'before-turn'
```

- `through-turn` preserves current behavior and includes the completed turn containing the target.
- `before-turn` proves that `atSeq` addresses the ordinary turn-opening user message and cuts the child seed before that turn's `turn/start`.
- A child before the first turn may have an empty seed. It still inherits cwd, Workspace, Agent Preset, parent lineage, and the provider, model, and reasoning effort active for the target turn.
- The Host is the final authorization and race arbiter. It rejects a running source, open turn, invalid sequence, or non-opening user message even if the Client button has not refreshed.
- One gesture owns at most one in-flight fork so a double click cannot create duplicate children.

### Draft Handoff

Before creating the child, the Client reads the target message from the source. Images are fetched through the source session's existing attachment authorization into temporary draft data and enter the normal attachment persistence path only when sent from the child. If attachments cannot be prepared completely, no child is created and the error is retryable. If the fork succeeds but navigation or draft installation fails, the child remains visible in the sidebar and the UI reports the partial success without retrying the fork.

## State Flow

1. Opening a session returns its tail history and complete lightweight prompt anchors together.
2. A rail activation only navigates. Older pages are fetched serially on demand while preserving the reader anchor.
3. “Edit and continue from here” prepares the draft, then requests a `before-turn` fork.
4. The Host validates the source and boundary, persists a lineage child, and attaches it to the same Workspace.
5. The Client opens the child and installs an unsent draft. A new model turn begins only after the user presses Send.
6. Any failure leaves the source conversation untouched.

## Performance and Compatibility

- Anchors are folded into the existing tail history read; session open gains no second request.
- Full message bodies are not prefetched. Only an explicit activation of an unloaded marker requests older pages.
- The rail uses `IntersectionObserver` and a virtual window rather than polling or measuring the full list every frame.
- Session event format, existing `session.fork` callers, cross-session messaging, archive, memory, marketplace, and model selection remain unchanged.
- Children use the existing persistence and resume path. Future upstream Harness changes only encounter an optional RPC field and a UI projection.

## Rejected Alternatives

### Truncate the source history

Problem: It breaks recovery and couples JSONL, SQLite, projections, attachments, usage statistics, and telemetry consistency.

Impact: A boundary or crash-handling bug could permanently remove project history.

Recommendation: Model rewind as a `parentSession` branch and retain the source read-only.

### Frontend-only fake rewind

Problem: Hidden messages could still be sent to the model or reappear after refresh.

Impact: Visible context would differ from the model's real context.

Recommendation: Have the Host create a child with an exact seed boundary.

### Prefetch every message body on open

Problem: Very long sessions amplify disk, transport, render, and memory costs.

Impact: It defeats the current paging and startup-latency goals.

Recommendation: Return lightweight anchors once and page message bodies only on demand.

## Verification

- Ordinary, long, and archived-then-restored sessions expose correct markers; context injections and tool output never create markers.
- Loaded and unloaded marker activation lands on the exact user message without a paging scroll jump.
- Window resize, workbench tool switches, and session switches keep rail geometry stable and never compress the message column.
- First, middle, and last-turn `before-turn` forks produce exact seeds while the source events and persistence bytes remain unchanged.
- The child inherits cwd, Workspace, Preset, model, and reasoning effort. No new message reaches the model before explicit Send.
- Running, open-turn, steering, invalid-sequence, double-click, attachment-read, and Workspace-attach cases are deterministic and create no duplicate child.
- Keyboard, screen-reader, reduced-motion, and bilingual copy acceptance pass.
- Existing branch, history paging, message actions, cross-session messaging, archive, and packaged smoke suites stay green.
- Native Mac and Windows artifacts come from the same commit and validate the shared behavior without platform forks.
