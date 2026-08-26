# Agent Note: Lark card streams coalesce latest state

Status: implemented

English | [中文](2026-08-26-lark-stream-coalescing.zh.md)

## Problem

The Lark card stream serialized every Harness projection revision behind the configured throttle interval. Model output that completed promptly in Harness could remain visibly incomplete in Feishu for the number of chunks multiplied by that interval, while the resulting `im.message.patch` volume increased exposure to Feishu rate limiting.

## Decision

Each `TurnCardStream` owns one latest projection, one optional throttle timer, and one optional in-flight card request. Intermediate revisions replace the latest projection and return without waiting for a network write. Revisions received before the timer fires or during an in-flight request collapse into the newest state.

A terminal revision cancels the timer and bypasses throttling. It writes immediately when idle or after the single request already in flight, and its promise settles only after the newest final state has been written or the bounded fallback has finished. Equal-text revisions remain admissible for tools, approvals, runtime facts, elapsed time, and token usage; shrinking text remains rejected.

The first card-update failure stops later card writes and attempts one bounded text fallback from the newest projection. Stream shutdown cancels its timer before the plugin clears active turns. The scheduler remains entirely in `@deepseek-ai/dsh-lark`; Harness core, Session persistence, Desktop conversation rendering, and the default Desktop patch are unchanged. Lark uses the existing `resolveOrdinaryTargetForSource()` API, so unused source-free resolver exports do not remain in `@deepseek-ai/dsh-session-messenger`.

## Alternatives considered

**Reduce the throttle interval.** Rejected because it keeps one patch per model chunk and raises rate-limit pressure without bounding completion lag.

**Render only the final answer.** Rejected because it removes the requested typewriter progress and delays tool and approval visibility.

**Move scheduling into Harness core.** Rejected because Feishu patch pacing is transport-specific and the removable plugin already receives every required Session event.

## Verification

Deterministic timer tests require burst revisions to produce one latest-state write, a terminal revision to wait for at most one in-flight write, shutdown to cancel a pending timer, shrinking text to remain ignored, and card failure to emit at most one bounded fallback. Existing card tests retain exact model, provider, reasoning effort, elapsed time, token, cache, approval, and monotonic-text assertions. Package tests, typecheck, bundle build, documentation gates, Profile installation, installed-byte comparison, restart diagnostics, and one real owner DM cover the remaining delivery layers.

## Consequences

Feishu write count is bounded by elapsed streaming time instead of chunk count, and completion cannot sit behind a local queue of stale revisions. Very short turns may show only the final card update after the placeholder, while longer turns retain typewriter progress at the configured interval. One already-started Feishu request cannot be cancelled, so a terminal revision may still wait for that single request and network latency.
