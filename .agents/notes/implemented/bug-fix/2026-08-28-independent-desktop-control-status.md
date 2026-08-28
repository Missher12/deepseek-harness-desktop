# Agent Note: Independent Desktop control status

Status: implemented

English | [中文](2026-08-28-independent-desktop-control-status.zh.md)

## Problem

The Desktop settings projection used one `supported` boolean for Browser Control and Computer Control. It derived that boolean from native Computer status, so a missing helper or one failed status/list read labelled the complete module unavailable even when Browser Control was installed. The same projection also treated disabled policy as if capability were absent and discarded both status and applications when either read failed.

## Decision

The renderer snapshot contains independent `browser` and `computer` capability records. Each record has a closed `available | unavailable | unknown` availability and a separate persisted `enabled` boolean. Supported but disabled capabilities render as **Available · Not enabled**.

Electron main projects Browser availability from the Browser adapter and Computer availability from the Computer adapter plus the latest valid native status. Native status and application enumeration settle separately. The main-process UI authority retains only frozen, path-free, last-valid status and application projections in memory; a later read failure preserves those values and marks only the corresponding refresh branch with a bounded generic message. A first status failure is unknown, not unavailable. Provider absence or an explicit unsupported result remains unavailable.

The preload and client validators accept only the exact nested snapshot, ordinary data properties, primitive roster values, and bounded messages. They reject the old aggregate shape, custom prototypes, accessors, coercible values, and authority-bearing extensions. The compact settings module presents capabilities, macOS permissions, authorized applications, emergency Stop, and current control without moving any authorization decision into the renderer.

## Alternatives considered

**Keep the aggregate boolean and change its label.** Different copy would still merge two independent capabilities and make switches depend on unrelated native state, so the data contract was corrected instead.

**Derive Browser availability from native Computer status.** The Browser adapter does not require the native helper; coupling them would preserve the original false-unavailable defect.

**Clear all display state after any refresh failure.** That is simple but turns a transient list or status failure into misleading capability loss. Retaining only the last validated path-free projection keeps the UI truthful without retaining page, window, or accessibility content.

## Consequences

The settings UI can show partial and degraded states precisely, and default-off policy no longer looks like missing functionality. The snapshot contract is larger and main keeps a small in-memory last-valid projection, but no authority identifiers or captured content cross the preload boundary. A user must explicitly Retry a failed refresh; the UI does not silently loop or widen permission.
