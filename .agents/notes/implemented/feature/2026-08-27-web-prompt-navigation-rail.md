# Agent Note: Web prompt navigation rail

Status: implemented

English | [中文](2026-08-27-web-prompt-navigation-rail.zh.md)

## Problem

Long conversations made it difficult to return to an earlier user instruction. Browser search could find matching words but did not identify turn boundaries, and loading every history page during session startup would trade navigation convenience for slower startup and more memory use. The requested surface was a Codex-style ruler that locates prompts, not a history-rewriting or rollback mechanism.

## Decision

The conversation renders a navigation-only ruler about 16px from the left edge of the conversation pane on sufficiently wide viewports, without narrowing the message column. Every mark represents an exact user-message sequence from a lightweight prompt index returned with the immutable tail history response. Turn-opening prompts use longer marks, steering prompts use shorter marks, and the currently visible prompt uses the accent color, a hollow dot, and a position count.

Pointer hover and keyboard focus reveal a localized tooltip containing the prompt ordinal, formatted time, and a normalized preview. The preview is bounded to 48 Unicode code points, image-only prompts receive an explicit fallback label, and no tooltip contains hidden full message content. Wide rulers support ArrowUp, ArrowDown, Home, End, and activation keys with exactly one mark in the tab order.

Selecting a mark asks the session runtime to reveal that exact sequence. The runtime serializes navigation requests, fetches only the older pages needed to materialize the target, and then scrolls the exact message row to the viewport center. Reduced-motion users receive an immediate scroll. A stale or unavailable target reports a local non-destructive status instead of navigating to an approximate message.

The rail renders at most 120 marks while keeping the first and last prompt reachable. Below the supported width, dense marks are replaced by a compact prompt-navigation trigger rather than overlapping the composer or message column; width changes and anchor replacements transfer focus only when the rail already owned it. Live user messages append anchors locally, while a resync replaces the index from the new immutable tail cut.

The rail does not delete, edit, rewind, resend, branch, or fork a session. Existing explicit session-fork actions remain separate and unchanged.

## Alternatives considered

**Edit or roll back from a prompt mark.** Rejected because it changes durable history semantics and gives a navigation affordance a destructive or branching meaning the user explicitly did not want.

**Eagerly load every history page.** Rejected because it increases session-open latency and memory use for the longest conversations, the exact case the ruler is intended to improve.

**Use browser search or approximate DOM positions.** Rejected because repeated text and unloaded history cannot identify an exact durable message boundary.

**Render one unbounded mark per prompt.** Rejected because thousands of prompts would create unnecessary DOM work and an unusably dense rail; bounded sampling retains the active neighborhood plus both ends.

## Consequences

Users can return to an exact earlier instruction from a compact visual landmark, including through mouse hover text and keyboard focus, without changing the session. The Host now computes one lightweight all-history prompt index at the same immutable cut as the tail page, and the client owns an on-demand pagination path for exact sequences. This adds bounded metadata and navigation state but does not add a new durable format or history mutation API.

## Testing

Host history tests cover tail-only index delivery, normalized previews, long history, and immutable cuts. Session runtime tests cover exact target loading, request serialization, live-anchor updates, and resync. Conversation tests cover left placement, long and short marks, the current dot and count, bounded first/last reachability, localized hover and focus tooltips, roving focus, wide/narrow focus handoff, the compact trigger, reduced motion, exact scrolling, and unavailable-target status.
