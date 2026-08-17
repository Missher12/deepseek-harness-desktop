# Agent Note: Cross-session Agent messaging plugin

Status: proposed

English | [中文](2026-08-17-cross-session-agent-messaging-plugin.zh.md)

## Problem

Ordinary Harness sessions have stable copyable IDs but no bounded, receipt-correlated way for one Agent to inject context into another ordinary session, request one follow-up turn, reply to the exact source, or wait for that exact reply. Reusing subagent tools would cross ownership boundaries; inferring replies from assistant output or idleness would fabricate causality; adding the feature to the ordinary Web bundle would change an unrelated product surface.

## Proposal

Ship `@deepseek-ai/dsh-session-messenger` as one independently removable Host/Client package and mount exactly one canonical row only in the immutable Desktop overlay. The ordinary base plus Web composition remains messenger-free. Preserve the existing reasoning-effort and plugin-market rows as independent neighbors rather than nesting or replacing them.

Register four global tools. `send_message_to_session` injects without waking; `followup_session` requests a wake but never creates a parallel driver; `reply_to_session` derives its destination from a receiving-session-bound, one-use private token; `wait_for_session_reply` accepts only the explicit reverse delivery tied to one receipt. None of the four permits a caller-supplied sender identity, and ordinary received text never triggers an automatic reply or Agent loop.

Resolve targets only through the Host Typert `agent` lookup. This keeps live reuse and cold-resume deduplication under Host policy while permitting a cold no-wake target to become addressable without a model request. Check ordinary/unarchived policy before lookup and again immediately before the synchronous inbox enqueue; never call `agents.resume()` directly.

Persist a write-ahead receipt before enqueue, reuse one Message ID during recovery, and retain the bounded body only while delivery is unresolved. Unresolved receipts have an exact 24-hour TTL; settled metadata remains for seven days. Reply authority is one-use and hop-bounded. Already committed session messages remain ordinary session events and survive package disablement.

The Host owns exactly three same-origin capability-authenticated routes plus one index bootstrap. The Client owns only one `sidebar.footer.action` contribution and shows metadata status, unread replies, recent errors, and exact current-Session-ID copy. It sends no message body over the notification routes and requests no native system notification permission.

Disablement removes the four tools, routes, index tap, waits, listeners, timers, footer contribution, and Client graph row, while leaving durable receipt storage and committed session messages intact. Pending waits settle as `disposed`; they never fabricate a reply.

## Model Experience

### Tool and relay context

#### What the model sees

Native presentation exposes the four tool definitions; Code Mode exposes `run_code` plus the four calls in its generated SDK. A received relay is a user-role message with trusted source Session ID, delivery ID, private reply token, delivery mode, and an explicitly untrusted body boundary. Results distinguish accepted delivery, requested wake, reply settlement, and stable errors without claiming target comprehension.

#### Token effect

Enabled requests carry the four native definitions or generated SDK declarations. Each claimed relay appends its bounded envelope and body; tool calls and results append normally. Browser notification metadata adds no model tokens.

#### KV Cache effect

The definitions remain byte-stable while enabled under one presentation mode. Enablement or disablement changes the tool-prefix segment; relay delivery appends at the session tail and does not rewrite prior history.

## Known Limitations and Deferred Work

- Scope is one active profile and ordinary sessions only; cross-device, cross-profile, subagent, broadcast, group, and public-network messaging remain deferred.
- The footer is a compact status surface, not a conversation browser or second inbox.
- Native macOS and Windows notifications remain deferred because their permission and lifecycle ownership belongs outside this removable package.
- No autonomous conversation policy ships: models must call explicit tools, replies are capability-bound, and no received text starts a loop.

## Alternatives considered

- Put the package in the Web bundle — rejected because ordinary Web users did not opt into Desktop cross-session messaging and disablement would no longer be surface-local.
- Reuse subagent messaging — rejected because subagent ownership, addressing, lifecycle, and parent/child authority do not describe two ordinary sessions.
- Treat target idleness or later assistant output as a reply — rejected because neither carries delivery causality.
- Add an Electron-native notification or traditional inbox — deferred because both expand permissions, persistence, and UI ownership beyond the package boundary.

## Acceptance criteria

- Base plus Web composes zero messenger rows; Desktop composes exactly one canonical row while reasoning-effort and plugin-market integration remain present.
- A real Host Loader exposes all four tools natively and through the Code Mode SDK, exactly three messenger routes plus one index tap, and one Client graph row.
- A real Client Loader contributes only one `sidebar.footer.action` entry; disabling the Host/Client rows removes tools, routes, waits, footer, and graph state.
- Disablement retains an already committed inbox event and settles an outstanding reply wait as `disposed`.
- The package tarball includes its patch, Host bundle, Client bundle, declarations, and package metadata; Desktop staging validates these files before packaging.
- Automated source acceptance passes before any native operation. A real two-session macOS Desktop exchange remains a separate explicit acceptance step.

## Risks

- A relay enters the target model's context and can exercise that target's existing permissions; only explicit follow-up or waking reply semantics may start work.
- Cross-service archive and deletion races cannot be made atomic, so policy is rechecked immediately before enqueue and accepted commits are never falsely rolled back.
- Receipt persistence can fail after the inbox commit; the recovery-pending state and exact Message ID prevent a false no-side-effect result and duplicate delivery.
- Adding another global tool set changes request schemas and cache prefixes while enabled; Desktop-only composition and complete unload keep that effect bounded.
