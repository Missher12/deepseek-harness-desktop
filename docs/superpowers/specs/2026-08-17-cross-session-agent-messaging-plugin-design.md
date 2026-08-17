# Cross-Session Agent Messaging Plugin Design

English | [中文](2026-08-17-cross-session-agent-messaging-plugin-design.zh.md)

**Date:** 2026-08-17

**Status:** Proposed

**Target:** Standalone Host and Client plugins for the DeepSeek Harness Web Profile; this delivery targets Intel macOS Desktop only

## Goal

After copying the Session ID of an ordinary session, a user can directly ask the Agent in the current session to send a message to the target, wake the target to continue work, reply to the source session, or wait for a bounded period for a reply to one delivery. The interaction semantics align with Codex cross-task communication without introducing a traditional chat inbox or making two Agents converse indefinitely on their own.

The plugin joins the Web Profile through an npm package's `dsh.bundle.patch` and injects Harness's existing `apiProxy`, `typert`, `agents`, `tools`, `workspaceRegistry`, and `webServer` services. It does not modify Harness core, Electron preload, model providers, the session format, or Desktop's random-port startup.

## Package and Compatibility Responsibilities

- The package declares and pins the exact verified Harness peer range, starting with the current Desktop baseline `0.1.0-rc.5`; source similarity does not substitute for a load test against another release.
- Installation preflight checks the required service shapes, tool-name availability, route availability, and one active copy. A temporary staged profile must start and unload cleanly before the package can be enabled in the user's profile.
- An incompatible module, peer range, service, route, or tool collision refuses enablement before any receipt or session mutation. Diagnostics identify the plugin and Harness versions and the failed capability without exposing credentials or session content.

## Tool Interfaces and Exact Semantics

To avoid collisions with existing Harness subagent tool names, the plugin registers four global tools: `send_message_to_session`, `followup_session`, `reply_to_session`, and `wait_for_session_reply`. The caller's Session ID is derived from the current tool-execution context; the model cannot spoof the sender through an argument.

`send_message_to_session(target_session_id, message)` creates an ordinary user message with a unique Message ID and calls the target Agent's `inject(message)`. A running target claims it at the nearest later step boundary without opening a separate turn; it may miss a model request whose pre-step has already claimed its batch but remains available for the following step boundary. An idle or cold-resumed target leaves it durably queued without waking until the user, a follow-up, or another valid wake starts the Agent. The result says only that the message was durably delivered and never claims that the target read or answered it.

`followup_session(target_session_id, message)` uses the same secure envelope and calls the target Agent's `followup(message)`. An idle target enters running synchronously and reserves one driver; a running target queues the message for the next turn without creating a concurrent driver. A driver may drain pre-existing backlog, so this tool guarantees no parallel driver rather than exactly one total turn. The immediate result distinguishes rejection, queued delivery, and a requested wake only; it does not treat enqueueing as completion. Later execution failure, cancellation, and termination are written to the receipt as non-reply status.

`reply_to_session(delivery_id, message, wake)` can use only a still-valid delivery receipt that the target session actually received, and derives the destination from the source session bound to that receipt. With the default `wake=false`, the reply is durably delivered without secretly starting the source session; only an explicit `wake=true` uses follow-up semantics to wake it. A mismatched, expired, consumed, or wrong-source receipt is rejected without changing any session.

`wait_for_session_reply(delivery_id, timeout_ms)` waits only for the next explicit, receipt-bound `reply_to_session` result. A target turn's assistant output has no per-input causal key and therefore never counts as an implicit reply; target failure, cancellation, or termination may be returned only as a separate non-reply status. `timeout_ms` defaults to 30,000 and accepts 1,000 through 55,000, while the tool definition has a 60,000-millisecond execution budget and forwards the tool execution's abort signal. It must not use `agent.whenIdle()`, which means only that the whole Agent is temporarily idle. A timeout neither wakes the target nor cancels its active work.

## Session Resolution and Delivery Envelope

The target session passes Harness branded Session ID validation and resolves through the Typert `agent` lookup configured by ApiProxy. This path reuses a live Agent, deduplicates concurrent cold resumes, and restores the target session's original preset and model; the plugin must not bypass those rules by calling `ctx.agents.resume()` directly.

The plugin accepts only ordinary sessions in the current profile. It rejects malformed, missing, deleted, archived, subagent-owned, self-targeted, or otherwise unsafe-to-resume targets before creating a message; rejection leaves the target log, inbox, runtime status, and receipt store unchanged. The archive set is checked before lookup and again immediately before enqueue, preventing known archived targets from being resumed and narrowing the cross-service race. An accepted enqueue is not rolled back if another actor archives or deletes the session afterward. Resolving a cold no-wake target still publishes its in-memory Agent so the durable inbox can be addressed, but it does not start the model driver. An ordinary fork session remains an eligible target while it is otherwise available.

Delivery content uses Harness `createUserMessage` with source `{ kind: 'plugin', plugin: 'dsh-session-messenger', form: 'relay' }`. Model-visible text clearly includes the source Session ID, delivery ID, delivery mode, and user message without presenting them as authority. The structured receipt is persisted separately, and raw text cannot override the sender, target, Message ID, reply token, hop, or expiration.

Each receipt records at least the source Session ID, target Session ID, delivered UserMessage ID, mode, status, creation and expiration times, reply token, and hop. While unresolved, the receipt also retains the bounded relay envelope needed to reconstruct the exact message after a crash between `prepared` persistence and enqueue; settled compaction removes that body. The store lives in the active profile's plugin-specific data area and follows a write-ahead sequence: atomically persist `prepared`, enqueue the pre-created Message ID, then atomically mark `delivered`. A handled enqueue rejection is atomically marked terminal `failed` or `aborted` before the tool returns rejection and is never retried. Only `prepared` or `delivery-recovery-pending` receipts left by process death or an indeterminate post-enqueue status write enter recovery: recovery first searches the target inbox and log for that Message ID, marks the receipt delivered when found, and retries enqueueing only for an absent `prepared` message by reconstructing the original Message ID and envelope. The plugin neither copies complete session histories nor sends content outside the local machine.

The Host companion owns exact same-origin snapshot, acknowledgement, and SSE notification routes below `/plugins/dsh-session-messenger/`. A per-generation capability injected into the same-origin index authenticates the Client half; every route checks the exact active loopback origin, enables no CORS, validates input sizes, bounds each SSE connection, and disposes connections and routes with the plugin. SSE events carry receipt metadata and status but never message bodies; reconnect uses event ids and Client deduplication, while the snapshot route recovers missed unread state.

Message bodies are limited to 16 KiB of UTF-8 bytes. One source session may create at most 30 deliveries per minute and one profile may retain at most 256 unresolved receipts. Settled receipt metadata is compacted after seven days, expired receipts are cleaned at startup and on a bounded interval, and messages already committed to session logs remain governed by normal session retention.

## Replies, Notifications, and Loop Prevention

Each delivery's reply token can be consumed only once. A valid reply completes the current receipt and creates a new delivery and reply token in the opposite direction with hop incremented. Both sides may continue a bounded conversation using the new delivery ID but cannot consume an old token twice. The target Agent's reply tool returns the new delivery ID, delivery status, and a stable error code it can use to explain a failure, without exposing other session lists or receipts.

When the source session is executing `wait_for_session_reply`, a valid reply resolves that wait immediately. Without a waiter, the reply remains durably queued as a non-waking message, and the Client plugin shows a Harness-style in-app notice and unread state. Follow-up completion continues to use Harness's existing background-completion dot; this design does not replace the complete session row or depend on unstable DOM structure or CSS Modules hashes.

The Client plugin contributes only a compact communication-status entry to the stable `sidebar.footer.action` list slot. It displays pending deliveries, unread replies, and the most recent error, and provides a shortcut to copy the current Session ID. It does not implement a separate inbox, display other session content, or register a replacement renderer that conflicts with existing session rows; dismissing a notice does not delete the message.

Receipts expire after 24 hours by default, and the maximum relay hop is 8. The plugin rejects self-sends, repeated consumption, expired tokens, and A-to-B-to-A loops beyond the hop limit. It never replies to or forwards ordinary received text automatically. Because content entering the target model context may exercise that target's existing tool permissions, only `followup_session` or an explicit waking reply can start new Agent work.

## Lifecycle and Failure

The Host plugin atomically registers all four tools and the receipt coordinator during load, and hot reload must not register duplicates. Disabling or removing it withdraws the tools, event listeners, active waits, and Client slot while preserving messages already written to session logs; an unfinished wait ends with a stable disposed result rather than a fabricated reply.

A missing caller Agent in the tool execution context, or a failure during target resolution or initial persistence, returns a phase-specific error and prevents all later uncommitted state. A handled enqueue rejection becomes terminal before the rejection is returned; if enqueue committed but the delivered-status write is indeterminate, the tool returns `delivery-recovery-pending` rather than a false no-side-effect rejection. Archiving or deleting a target after accepted delivery preserves the already committed message but makes later follow-up, reply, or wait operations return a stable target-unavailable state without mutating another session. The write-ahead recovery sequence resolves an indeterminate receipt idempotently and never delivers the same Message ID twice.

The plugin supplies in-app notifications only. Native macOS notifications require additional Electron permission and window-lifecycle changes and do not fit this independently disableable, plugin-only delivery.

## Verification and Acceptance

- Real-profile loading covers `dsh.bundle.patch`, visibility of all four tools in native and code/SDK modes, no duplicate registration after hot reload, and removal of every tool and slot after disablement.
- No-wake tests cover live idle, live running, and cold ordinary sessions: exact Message ID persistence, next-step claiming for a running target without a separate turn, no wake or model request for an idle target, and recovery after restart. A handled enqueue rejection stays terminal after restart, a crash before enqueue recovers the absent prepared message, and a crash after enqueue but before status write finds the existing Message ID without duplication. Missing caller Agent and missing, subagent, archived, and self targets are rejected consistently with zero side effects.
- Follow-up tests cover one reserved driver for an idle target, FIFO ordering and no concurrent driver for a running target, existing-backlog draining, and accurate non-reply states for model-route failure, exception, cancellation, and termination.
- Reply tests cover the A-to-B source envelope, B-to-A binding validation, forged tokens, expired tokens, cross-receipt tokens, duplicate replies, and the hop limit.
- Wait tests cover explicit receipt-bound replies only, isolation from assistant output and unrelated turns, argument and tool timeout bounds, forwarded abort, discard, dispose, process restart, and reply-arrival races. Quiet idle can produce only pending or timeout and never wakes secretly.
- Client acceptance covers copying the Session ID, in-app reply notices, unread state, reconnect snapshot recovery without duplicate notices, dismissing a notice without deleting its message, light and dark themes, keyboard use, screen readers, 200% zoom, and reduced motion.
- Mac Desktop uses a temporary `DSH_HOME` to complete a real Agent exchange between two ordinary sessions, archived-target and subagent rejection, restart recovery, uninstallation, and complete process cleanup; this delivery does not modify or publish Windows artifacts.

## Delivery Stages

The foundation stage delivers reliable `send_message_to_session`, `followup_session`, `reply_to_session`, write-ahead receipt persistence, and in-app notifications. The reliability stage then exposes `wait_for_session_reply` in the default tool directory only after explicit reply correlation, timeout, cancellation, and restart tests pass; it must not ship early as a fake wait wrapped around `whenIdle()` or inferred from assistant output.

## Out of Scope

Cross-device or cross-profile messaging, a public network service, a traditional inbox, session-content aggregation, unbounded automatic conversation, broadcast, archive-state mutation, subagent operation, native system notifications, Harness core session-row extensions, Windows packaging, and auto-update are outside this design.
