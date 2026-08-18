# Session Messaging Visibility and Stable Market Categories Design

English | [中文](2026-08-18-session-messenger-and-market-refinement-design.zh.md)

**Date:** 2026-08-18

**Status:** Proposed

**Target:** DeepSeek Harness Desktop 0.1.6 for Intel macOS and Windows x64

## Goal

Cross-session deliveries remain durable Agent inputs, but the receiving conversation presents each claimed relay as a visible Harness-style message card rather than a collapsed generic context row. The current session header opens a contained communication drawer for copying the Session ID, sending to an exact Session ID, replying to an addressed delivery, and inspecting receipt status. The drawer can be resized without protruding from the sidebar footer.

The plugin market keeps the compact list that already ships. Its category rail exposes every category returned by the live registry in one stable order and scrolls horizontally; choosing a category changes only the result list and selected state, never the chip positions or toolbar geometry.

This refinement retains the delivery, recovery, reply, wait, and rejection semantics in the [cross-session messaging design](2026-08-17-cross-session-agent-messaging-plugin-design.md). It replaces that document's compact footer-only Client presentation and macOS-only delivery target with the interface and dual-platform acceptance below.

## Chosen Approach

The communication entry moves from `sidebar.footer.action` to `conversation.session.header.utilities`. The header button and unread badge open a plugin-owned drawer inside `shell.overlay`, so the feature remains removable and does not replace the conversation, details column, session rows, or Electron shell. A drag handle clamps the drawer to 320 through 560 pixels on ordinary desktop widths and stores only the numeric width preference. Narrow windows use a full-width sheet and disable horizontal resizing. Closing the drawer, changing sessions, unloading the plugin, or pressing Escape removes the interactive layer without mutating a receipt or session.

The existing `user/message` event remains the only model-visible and transcript-authoritative record for a relay. The relay content is built as a metadata text block followed by the untrusted body text block; the model receives the same ordered text, while the durable source records the sender Session ID, delivery ID, delivery mode, and body block index. The generic relay presentation in `ui-conversation` reads those fields and renders a visible card containing the sender, body, delivery time, and bounded actions, with the model-facing delivery metadata available under a disclosure. Older or foreign relay records that lack the structured fields continue through the existing opaque context fallback.

This approach does not create a second conversation event, copy the relay into a human `source.kind=user` message, or infer a reply from assistant output. One delivery therefore reaches the model once and appears in the transcript once.

## Communication Drawer and Operator Actions

The drawer contains three compact views: receipts involving the current session, sent status, and recent failures. Receipt rows expose sender or target Session ID, delivery mode, status, and time; message bodies stay in the target inbox or session log and are not added to the existing SSE metadata stream. Selecting a claimed relay scrolls to its durable transcript card when the node is loaded. A pending no-wake delivery is labeled as pending context and is not presented as read.

The compose card accepts one exact target Session ID, one body within the existing 16 KiB UTF-8 limit, and an explicit wake option. New exact same-origin POST routes reuse the per-generation capability, exact loopback origin check, no-CORS policy, bounded body parsing, ordinary-session resolution, archive and subagent rejection, self-send rejection, rate limits, receipt limits, and write-ahead coordinator. The page-generation capability authorizes this local operator action; the Client supplies its displayed current Session ID and the Host validates that source as an ordinary available session before delivery. The UI never offers another source selector. A blank, archived, subagent, missing, or stale source cannot send. The route returns delivery status only and never claims that the target read or answered the message.

Reply opens the same compose card bound to one delivery. The browser sends the current Session ID, delivery ID, body, and wake choice; the Host obtains the one-use reply authority from its receipt store and enforces the same target-session binding as `reply_to_session`. The reply token is never returned to browser code. Sending and replying disable their commit button while active, preserve the draft after a failure, and display a bounded Harness error without exposing receipt storage, credentials, or other session content.

The header badge and drawer continue to use the receipt snapshot plus SSE updates. Acknowledgement changes unread state only. It does not delete the relay card, message, receipt, or queued Agent input.

## Plugin Market Category Rail

The registry is authoritative for category count and localized names, so the Desktop patch does not invent a parallel taxonomy or cap the visible category set. The 2026-08-18 acceptance catalog contains twenty categories, while the implementation renders any returned count. The Discover toolbar renders `All` followed by every registry category in registry order. `orderedCategories` becomes identity-preserving, and category changes retain the rail's `scrollLeft` while updating the query and resetting only the results page.

The category container uses one non-wrapping native horizontal scrollport. Left and right controls scroll by one visible rail width and disable at their respective edges; subtle edge fades indicate hidden categories without covering focused chips. Trackpad horizontal gestures and Shift-plus-wheel use the native scrollport. A selected chip that entered through keyboard focus scrolls only the minimum distance needed to become visible and never moves in the DOM. The toolbar height, search field, category rail, and result-list origin stay fixed while filters change.

Every returned category remains keyboard reachable, exposes selected state without relying on color, and preserves visible focus at 200% zoom. Reduced-motion mode removes animated scrolling. The page itself never gains horizontal overflow.

## Failure and Lifecycle Behavior

If the Host companion is unavailable, the header entry remains usable for copying the current Session ID while sending, replying, receipt status, and unread acknowledgement are disabled with one connection diagnostic. Reconnection replaces the receipt snapshot by event ID and does not duplicate badges or cards. A route or tool collision still rejects plugin activation before any receipt or session mutation.

The drawer removes document listeners, pending animation frames, resize observers, and active requests when it closes or unloads. The market rail removes scroll and resize listeners with its component. Desktop shutdown continues to terminate the owned Harness process tree and random-port server. Release work closes task-owned build servers, mounted images, temporary smoke profiles, and redundant candidate app processes; it does not terminate Codex, remote-access software, Hermes, or unrelated user applications.

## Verification and Delivery

Focused Client tests cover the header registration, visible relay card, structured-body fallback, Escape and focus restoration, width clamping and persistence, narrow-sheet behavior, send and reply failure drafts, receipt acknowledgement, keyboard order, screen readers, reduced motion, and 200% zoom. Host tests cover exact-origin and capability checks, body limits, current-session authority, ordinary target resolution, archived, subagent and self rejection, reply binding without browser-visible tokens, recovery, disposal, and zero mutation on rejection.

Market tests cover all registry categories in stable order, no DOM reordering after selection, retained horizontal scroll, edge controls, keyboard minimum-scroll behavior, fixed toolbar height, narrow containers, and no page overflow. Existing install, update, activation, rollback, self-protection, theme, backup, and activity behavior remains unchanged.

The packaged smoke uses temporary `DSH_HOME` profiles to prove one normal cross-session send, one visible claimed relay card, one receipt-bound reply, one no-wake pending state, archived and subagent rejection, exact category order before and after selection, drawer resizing, random-port startup, restart recovery, and complete process cleanup. Intel macOS produces a DMG and Windows x64 produces a per-user Setup from the same commit. Each artifact is installed and exercised on its native platform, publicly re-downloaded, size-checked, and SHA-256-checked before a new `desktop-v0.1.6` release is announced.

## Alternatives Considered

Reusing the existing details column would inherit its drag behavior but compete with selected tool-call input and output, forcing a mode switch whenever a message arrived. A composer popover would keep the implementation smaller but cannot hold history or long messages at a useful width. Keeping the footer popover preserves the current registration but repeats the protruding geometry and leaves relays collapsed. The chosen header entry and contained drawer preserve tool details, fit the approved layout, and keep the feature independently removable.

## Out of Scope

Cross-device or cross-profile messaging, public network access, broadcast, unbounded automatic Agent conversation, native operating-system notifications, arbitrary GitHub repository installation, a new plugin-category service, ARM macOS packaging, automatic update installation, and termination of unrelated user processes are outside this refinement.
