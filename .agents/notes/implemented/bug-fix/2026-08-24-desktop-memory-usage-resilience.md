# Agent Note: Fresh-install memory and bounded usage refresh

Status: implemented

English | [中文](2026-08-24-desktop-memory-usage-resilience.zh.md)

## Problem

Desktop bundled project memory but presented the optional legacy `vectors.db` status as the primary memory index. A fresh installation therefore said memory was not configured even though plugin-owned reviewed memory was ready. Usage Insights also kept one shared refresh promise forever when a durable Session inspection did not settle, leaving the first-load skeleton permanent.

## Decision

- Project Memory shows plugin-owned memory as ready independently from the optional, read-only legacy index. Missing `vectors.db` never creates a file and does not disable explicit project binding, capture, review, or recall.
- One Usage Insights Host refresh owns a 12-second `AbortController` deadline. The signal reaches Session listing and inspection; stalled rows become omitted partial data, completed rows retain their revision cache, and the shared in-flight promise always clears.
- The renderer keeps a cached aggregate visible during refresh. Without a cache, a request still pending after 15 seconds becomes a generic retryable error; private Host errors and Session contents never cross into the UI.

## Alternatives considered

**Treat the optional legacy database as readiness.** This lost because the plugin-owned reviewed store is usable without `vectors.db`, and presenting the two as one state makes a fresh installation look broken.

**Wait indefinitely for complete Usage data.** This lost because one damaged or stalled Session would permanently pin the shared refresh and renderer skeleton instead of returning an honest partial snapshot.

**Persist the newest row from an active Session.** This lost because live inspection can observe events ahead of the durable revision; reusing that row after a restart could over-count data under an older revision. The optimization therefore remains process-local and generation-bound.

## Security and ownership

The change does not create, copy, migrate, or write `vectors.db`. Memory state is still created only by an explicit project mutation, and Usage Insights persists only bounded counters and identifiers. Cancellation changes read lifetime, not the authority or content of either store.

## Verification

Unit tests reproduce an absent legacy index on a fresh client, a Session inspection that waits for cancellation, refresh retry after timeout, and an endless first renderer load. Desktop packaged smoke requires both the ready built-in-memory label and the optional disconnected legacy source while proving that opening Settings creates no memory state database.

## Consequences

Fresh installations truthfully show built-in memory as ready while keeping legacy discovery explicit and read-only. Usage Insights becomes bounded and repeat opens of an unchanged active Session avoid the same long-log fold. The trade-off is that a timed-out refresh can be partial and the live-row acceleration is intentionally lost on Host restart.
