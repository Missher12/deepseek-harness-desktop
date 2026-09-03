# Agent Note: Local all-history usage insights in Settings

Status: implemented

English | [中文](2026-08-18-local-usage-insights.zh.md)

## Problem

Desktop users can inspect individual conversations but cannot answer basic all-history questions such as cumulative tokens, peak usage, active days, streaks, or which Harness features they use most. Computing those figures in the browser would require sending complete Session logs across the Remote boundary, repeat an unbounded fold whenever Settings opens, and expose prompts, tool arguments, and results to presentation code that does not need them.

Historical tool calls also do not record a stable Loader-plugin owner. Calling the resulting ranking “most-used plugins” would overstate what the durable log can prove.

## Decision

`@deepseek-ai/dsh-usage-insights` owns a Host-side, revision-aware derived index. It enumerates every durable Session, including archives and subagents, and folds only provider usage, completed turn boundaries, human activity, explicit skill metadata, tool identities, model routes, and effort selections. A forked Session excludes its inherited prefix through `seedLength`. Token totals use uncached input plus output plus cache read plus cache write; reasoning tokens remain inside output. Session duration is the sum of completed turn durations, not inter-turn idle wall time.

The `usage_insights` storage domain contains one rebuildable row per Session. Rows hold only stable identifiers, day buckets, counters, and the source revision. They never retain prompts, replies, tool arguments, tool results, titles, working directories, attachments, or credentials. A matching revision is reused; changed or invalid rows rebuild with bounded concurrency. One bad Session produces a partial snapshot with an omitted count instead of failing the whole Settings surface. Live Session events mark the corresponding row dirty so a stale revision is not persisted during an active write.

`usageInsights.snapshot()` is the only Remote method. It returns five headline figures, a fixed 371-day activity series, activity insights, and a five-row feature ranking. Current streak accepts a streak ending yesterday when the current day has no human message. Daily boundaries use the Host machine's current time zone. Invalid or missing provider token fields remain absent rather than estimated.

`@deepseek-ai/dsh-client-ui-settings-usage` registers the localized Settings section between Models and Plugins. It renders the five figures and keeps one 53-by-7 particle field across daily, weekly, and cumulative hover scopes. Daily stays a calendar heatmap; weekly and cumulative views keep the complete gray field and fill Sunday-aligned columns from bottom to top. Rounded visible tooltips use scope-specific date copy, and the cumulative stack carries tokens before the visible range as its baseline so its final column matches the all-history headline. The chart is followed by activity insights and an honestly labeled “Most-used features” ranking that distinguishes skill and tool rows. Loading, empty, partial, and retry states remain local to the section, unavailable values use an em dash, and the existing compact Settings width stays unchanged.

## Verification

Pure folds cover token replacement, cache buckets, reasoning non-duplication, fork prefixes, turn duration, local-day activity, explicit skills, native tools, and Code Mode dispatches. Aggregation tests cover the 371-day series, levels, streak rules, features, models, efforts, and cache-hit rate. Loader tests mount the real JSONL persistence and JSON storage plugins to prove first-build reuse, revision invalidation, deletion, partial failure, and live dirtiness. Client tests cover chart projections, localization, state handling, tab keyboard behavior, and narrow no-overflow geometry. Bundle and Remote tests prove the new Host and Client rows compose through the ordinary Web tree.

## Alternatives considered

**Fold full logs in the browser.** Rejected because it broadens the Remote data surface, repeats expensive work, and gives presentation code content it does not need.

**Store one global aggregate.** Rejected because any Session revision would invalidate the entire cache and make deletion or partial repair difficult. One row per Session gives exact replacement and bounded incremental rebuilds.

**Rank plugins by tool name.** Rejected because tool names are not a durable plugin identity. The product labels the evidence as features and does not infer ownership.

**Estimate missing provider usage.** Rejected because tokenizer-dependent estimates would mix incompatible semantics with provider accounting and make the totals look more authoritative than the records allow.

## Consequences

Settings can summarize all local history without a model call or a new Electron IPC path, and subsequent opens reuse Session revisions. The first cold read can still inspect every durable Session, while malformed or temporarily unreadable records make the snapshot explicitly partial. Moving the Host between time zones can shift events near midnight when rows rebuild. Live updates become visible on the next section read or retry rather than through a continuously streamed dashboard.
