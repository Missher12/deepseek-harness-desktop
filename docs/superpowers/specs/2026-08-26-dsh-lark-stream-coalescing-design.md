# `dsh-lark` Stream Coalescing Design

English | [中文](2026-08-26-dsh-lark-stream-coalescing-design.zh.md)

**Date:** 2026-08-26

**Status:** Approved for implementation

## Goal

Keep the existing Feishu typewriter card while preventing model chunks from becoming a serialized backlog of `im.message.patch` requests. A completed Harness turn must reach Feishu after at most the one card request already in flight, without changing Harness core, Desktop conversation storage, or the Session event stream.

## Root Cause

`TurnCardStream.update()` currently appends every projection revision to one promise tail. Each non-final tail item waits for `streamThrottleMs`, whose default is 350 ms, and `onMuxFrame()` awaits each item. A 100-chunk answer therefore produces 101 card writes and approximately 35 seconds of local scheduling delay even when Harness has already completed the turn.

The Feishu transport uses `im.message.patch`, which has stricter rate limits than CardKit streaming. Reducing the interval alone would retain one request per chunk and increase rate-limit risk without removing the backlog.

## Scheduler

Each turn continues to own one stable card and one `TurnCardStream`. The stream stores only the latest admitted `TurnProjectionState`, a dirty flag, one optional throttle timer, and one optional in-flight card request.

Non-final updates replace the latest state and return without waiting for a network write. If no request or timer exists, the scheduler writes immediately when the throttle window has elapsed or arms exactly one timer for the remaining interval. Updates received before the timer fires or while a request is in flight collapse into the latest state.

A final update cancels the throttle timer. If no request is in flight, it writes the latest final state immediately. If one request is in flight, it waits for that request and then performs one immediate write of the newest final state. The final update promise resolves only after this drain finishes, so the active-turn record is not removed before its terminal card is settled.

Card text remains monotonic: a projection whose text shrinks or stops matching the visible prefix is ignored. Equal-text revisions remain valid so tool status, approval buttons, runtime facts, elapsed time, and token usage can advance independently.

## Failure and Lifecycle

The first card-update failure disables further card writes for that turn and sends one bounded text fallback from the latest state. Later revisions cannot emit another fallback. A failed fallback does not terminate the shared mux loop.

`TurnCardStream.stop()` cancels its timer and rejects future scheduling. Plugin disablement calls `stop()` for every active stream before clearing the active-turn map, so no deferred Feishu request survives plugin shutdown. Already completed Harness Sessions and their event logs remain untouched.

## Plugin Isolation

The Lark package continues to resolve ordinary Sessions through the already published `resolveOrdinaryTargetForSource()` API with its package-local external-source sentinel. The unused `assertOrdinarySession()` and `resolveOrdinarySession()` additions are removed from `@deepseek-ai/dsh-session-messenger` together with their tests.

Necessary monorepo registration remains: package manifests, TypeScript aggregate references, lockfile entries, generated Client slot registration, documentation, and the independently installable Bundle. No file under `packages/core/agent`, `packages/core/session`, the Desktop application bundle, or the default Desktop patch changes.

## Verification

Focused tests use deterministic timers and deferred card requests to prove burst coalescing, throttle spacing, final priority, one in-flight request, monotonic text, single bounded fallback, and shutdown cancellation. Existing rendering tests continue to pin model ID, provider, reasoning effort, elapsed time, token usage, cache counters, and approval actions.

Package tests, typecheck, build, documentation synchronization, diff checks, tarball packing, real `web` Profile installation, restart status, and installed-byte verification form the release evidence. Real Feishu timing still requires one owner DM after installation because offline tests cannot measure Feishu network latency.

## Alternatives Considered

**Lower `streamThrottleMs`.** Rejected because it preserves one patch per chunk and increases exposure to Feishu error `230020`.

**Send only the final answer.** Rejected because it removes the requested typewriter progress and tool/approval visibility.

**Move streaming into Harness core.** Rejected because Feishu scheduling belongs to the removable transport plugin and Harness already publishes every required Session event.
