# @deepseek-ai/dsh-usage-insights

English | [中文](README.zh.md)

Host-side, read-only all-history usage index for DeepSeek Harness. The plugin folds durable root, archived, and subagent Session logs into privacy-minimal daily rows, persists those derived rows in the `usage_insights` storage domain, and exposes one `usageInsights.snapshot()` Remote method for Settings.

The index counts provider-reported uncached input, output, cache-read, and cache-write tokens. Reasoning tokens remain part of output and are not added a second time. A forked Session begins after its durable `seedLength`, so copied parent history is not double-counted. Longest-session time is the sum of closed turn durations rather than wall-clock idle time, and chat streaks use human messages in the machine's current time zone.

Feature rankings deliberately describe **features**, not installed plugins. Native tool calls, Code Mode dispatches, explicit skill invocations, model routes, and reasoning-effort selections can be recovered from durable events; historical logs do not carry a reliable Loader-plugin owner for every tool. Only identifiers and counters enter the derived cache. Prompts, replies, tool arguments, tool results, titles, paths, attachments, and credentials do not.

## Composition

```yaml
- id: usage-insights
  name: '@deepseek-ai/dsh-usage-insights'
```

The plugin injects Session persistence and the storage-domain registry. It reuses an indexed row when the Session revision matches, rebuilds only changed rows with bounded concurrency, and serves partial results when an individual Session cannot be inspected. The newest folded row for a live Session remains process-local and is invalidated by generation on its next Session event; it is never written under an older durable revision. One refresh has a 12-second Host deadline: pending persistence reads receive the same cancellation signal, timed-out Sessions are counted as omitted, and the shared in-flight promise always settles so a retry can start fresh.

## Model Experience

None, as the plugin only computes a client-facing read model from durable Session records and never changes a model request.

#### KV Cache effect

None; displayed cache-read and cache-write figures are provider accounting already present in Session logs, not a change to request caching.

### Invariant ownership

No invariant companion is published because usage projections are validated by pure functions.

## Known Limitations and Deferred Work

- **Provider counts are authoritative or absent** — invalid, negative, unsafe, or missing token fields are omitted instead of estimated; the snapshot reports how many Sessions were omitted during a partial refresh.
- **Feature ownership is intentionally conservative** — old tool records can identify a tool or skill but cannot reliably map every call back to the Loader plugin that registered it, so the API does not claim a plugin ranking.
- **The first read is bounded but can be partial** — a cold or invalidated cache inspects durable Sessions until the 12-second refresh deadline; completed rows are cached, timed-out rows are reported as omitted, and later reads can continue from those cached revisions.
- **Local time-zone semantics** — daily buckets and streaks follow the Host machine's current time zone, so changing that zone can move events near midnight after the affected rows are rebuilt.
