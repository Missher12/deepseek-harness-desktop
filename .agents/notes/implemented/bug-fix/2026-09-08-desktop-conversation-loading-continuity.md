# Agent Note: Desktop conversation loading continuity

Status: implemented

English | [中文](2026-09-08-desktop-conversation-loading-continuity.zh.md)

## Problem

Changing sessions can remove the statistics row while its data loads. A selected model can remain visually stale while an advisory catalog refreshes, and an invocation rejection can leave the selector disabled. The Desktop input outline also uses a text-color token that is too strong for resting chrome.

## Decision

The composer dock remains available for a selected session before its input state arrives. Statistics keep a row with a localized placeholder until current-session values exist; they never retain another session's totals. Only the dock remains visible while the composer waits for its final layout.

The model directory publishes the durable session selection independently of catalog readiness, retaining usable labels and groups during refresh. Selection pending/error state has its own owner; catalog notifications cannot clear it. A rejected invocation releases the current operation, while generation and scope guards exclude stale or disposed results. A newly selected provider remains unblocked until its routability is known.

Resting Desktop input outlines use the theme's `border-l4` token. The explicit hairline and separate focus ring preserve geometry and keep the field discernible in both themes.

Cold observation restoration yields between bounded event-clone batches. Cancellation is checked before accepting a newly attached live owner, and preparation receives only a complete detached array. Revision-keyed caching and immutable observations keep their existing ownership; the query README owns the cache contract.

## Alternatives considered

**Retain the previous session's displayed statistics.** This avoids an empty row but attributes another conversation's usage and timings to the current session. A placeholder preserves geometry without inventing data.

**Treat a selection timeout as success or unlock and retry blindly.** The Host may still commit the original selection. The client exposes actual failures and preserves operation ownership instead of introducing competing writes.

**Remove the input outline.** That recreates the indistinct white-on-white field; a semantic border provides a lighter resting outline.

**Remove the history clone.** Sharing persistence-owned events would weaken observation isolation. Batching preserves detached snapshots while allowing pending Host work to proceed.

## Consequences

Session transitions retain the footer, accepted model changes appear during catalog refreshes, and invocation failures remain retryable. These client changes do not make a never-settling Host operation succeed or replace native platform acceptance. The owning component and plugin regressions cover session-source replacement, late updates, input loading, pending refreshes, retry, superseded rejection, and scope disposal.

History batching reduces continuous blocking without promising shorter total restoration time. Decoding and preparation remain synchronous. Observation tests cover cancellation during cloning, live-owner takeover, and the final frozen cut.
