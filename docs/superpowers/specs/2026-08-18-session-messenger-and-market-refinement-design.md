# Codex-Style Peer Session Messaging and Stable Market Categories Design

English | [中文](2026-08-18-session-messenger-and-market-refinement-design.zh.md)

**Date:** 2026-08-18

**Status:** Implemented candidate

**Target:** DeepSeek Harness Desktop 0.1.6 for Intel macOS and Windows x64

## Goal

A user copies Session A's exact ID, pastes it into Session B, and asks B's Agent to send a message. DeepSeek Harness wakes A's existing Agent; A can reply to B through trusted delivery metadata, and either session can later initiate another message with the other ID. This is peer session messaging, not a second chat-card system and not an unbounded autonomous loop.

The plugin market keeps its compact list, separates search and filter from the category rail, renders every live-registry category in stable source order, and scrolls categories horizontally without moving chips when selection changes.

## Peer Messaging Protocol

The plugin registers four global tools. `send_message_to_session` is the default exact-ID adapter: it delivers through the existing follow-up path and requests one target wake. `send_message_to_session_and_wait` performs the same delivery and waits only for the exact receipt-bound reply when the user asks to wait. `reply_to_session` derives its one-use destination authority from the Host receipt and wakes the source by default. `wait_for_session_reply` can resume waiting on the original delivery after a bounded timeout.

A stable `tool:session-collaboration` system-prompt section tells either Agent to use a pasted exact Session ID, tells a receiving Agent to call `reply_to_session` with the exact delivery ID when a response is useful, and explains that a later fresh message may target the trusted Source Session ID. Target idleness, unrelated assistant output, and another delivery can never settle a wait. A timeout does not trigger a blind resend, and acknowledgements do not create automatic reply loops.

The caller identity comes from tool execution rather than model input. The message body is explicitly untrusted and cannot change permissions or user policy. Targets must be ordinary sessions in the active profile. Missing, blank, self, archived, and subagent-owned targets are rejected before inbox mutation. A running target queues behind existing work and never gains a parallel driver; a cold ordinary target resumes through the Host-owned lookup.

The durable `user/message` remains the only model-visible record. Trusted metadata identifies source Session ID, delivery ID, mode, and body boundary without exposing the Host reply token. Write-ahead receipts and fixed Message IDs preserve exactly-once enqueue recovery. Disabling the plugin removes tools, prompt section, waits, routes, Client composition, listeners, and timers without deleting committed session history.

## Native Client Surface

The plugin retains one `conversation.session.header.utilities` entry and one `shell.overlay` drawer as an operator fallback. The drawer copies the exact current Session ID, directly sends or replies, shows metadata-only receipt activity, preserves failed drafts, and remembers a width clamped to 320–560 pixels. Narrow windows use a full-width sheet. **Start target Agent** is enabled by default.

Collaboration messages use the ordinary Harness context-disclosure renderer. The rejected custom relay-card projection, body card, copy action, and card reply action are absent, so conversation geometry and visual language stay native. Closing the drawer, changing session, pressing Escape, or unloading the plugin removes its interactive layer without mutating receipts or messages.

## Plugin Market Category Rail

The registry remains authoritative for category count and names. The sticky toolbar has a dedicated full-width search/filter row above a separate category row. `All` and every registry category remain in source order; choosing a category changes only selected state, query results, and page number.

The category row uses a non-wrapping native horizontal scrollport. Compact edge buttons appear only when their direction has hidden content, while fades indicate overflow without covering focused chips. Trackpad gestures and keyboard arrows retain native behavior; keyboard focus uses minimum-distance `scrollIntoView`. Reduced-motion mode disables smooth movement, and the page itself never receives horizontal overflow.

## Failure and Lifecycle Behavior

The exact-origin Client routes retain generation capability checks, loopback-only origin policy, bounded bodies, current-session authority, rate limits, receipt limits, archive/subagent/self rejection, and zero mutation on refusal. If the Host companion is unavailable, Session ID copy remains available while mutation controls show one bounded diagnostic.

The drawer removes document listeners, active requests, and resize work on close or unload. The market rail removes scroll, resize, and observer ownership with its component. Desktop shutdown still owns only its Harness child process tree and random loopback listener; release work does not terminate Codex or unrelated applications.

## Verification and Delivery

Tool tests prove exact registration, wake delivery, one-driver semantics, system-prompt ownership, receipt-bound waits, unrelated-output refusal, timeouts, disposal, and rollback. Client tests prove default wake, ordinary no-card rendering, exact ID copy, failed-draft retention, Escape/focus restoration, width persistence, unread acknowledgement, and narrow/reduced-motion behavior. Host tests cover origin, capability, body, source authority, target rejection, recovery, reply binding, and no-mutation failures.

Market tests require stable category order, separated search/filter/category placement, horizontal overflow, edge controls, minimum keyboard scrolling, narrow-container reflow, and coherent source, generated bundle, and source map. Packaged macOS and Windows smokes use temporary `DSH_HOME` profiles and no external model request; they validate the operator surface and storage boundaries, while tool tests validate the Agent protocol. Native artifacts must be built and exercised on their own platform, publicly re-downloaded, size-checked, and SHA-256-checked before release.

## Out of Scope

Creating new sessions or subagents, cross-profile or cross-device delivery, public-network access, broadcast, groups, native operating-system notifications, unlimited background collaboration, arbitrary GitHub installation, a new category service, ARM macOS packaging, and terminating unrelated user processes are outside this refinement.
