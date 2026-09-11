---
description: "View locally indexed usage, activity and feature statistics in Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-usage

English | [中文](README.zh.md)

## Summary

View token totals, activity, cache usage and feature rankings from Usage in Settings. Daily, Weekly and Cumulative scopes share an accessible chart, with loading, retry and partial-data states kept inside the page. The section requests a read-only Host aggregate and never substitutes fabricated zeros for missing metrics.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Invariant ownership](#invariant-ownership)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Read-only **Usage** section for Web and Desktop Settings. The browser plugin registers the localized `usage` section at order 12 and lazily calls `ctx.remote.usageInsights.snapshot()` when the section mounts.

The section shows cumulative and peak tokens, longest active Session time, current streak, and longest streak. All scopes retain the same 53-by-7 particle field: Daily is a calendar heatmap, while Weekly and Cumulative fill each Sunday-aligned column from bottom to top. The visible rounded tooltip uses scope-specific date copy and changes from one day's tokens, to the containing week's total, to the all-history running total through that week. Below the chart, activity insights summarize cache-hit rate, most-used model and reasoning effort, unique skills, tool calls, and chat days; the ranked feature list distinguishes skills from tools.

Loading, retry, empty, and partial-data states stay inside the section. A first load that has not settled after 15 seconds leaves the skeleton for a retryable error; a retained aggregate remains visible with a stale-refresh notice. A later success can still replace either state. Missing metrics render as an em dash rather than a fabricated zero. The layout uses the existing Settings width and semantic theme tokens, supports keyboard tab navigation, collapses the KPI strip at narrow widths, and introduces no horizontal page scroll.

## Invariant ownership

No invariant companion is published because each component validates every Remote state before rendering.


## Model Experience

None, as this package only renders a Host-owned usage snapshot in browser Settings and registers nothing model-facing.

#### KV Cache effect

None; the cache-hit figure is a read-only visualization of provider accounting and this package never assembles or sends a provider request.

## Known Limitations and Deferred Work

- **Snapshot refresh is explicit** — the section reads on mount and retry; it does not subscribe to every live usage event while the dialog stays open.
- **Chart density follows the compact Settings pane** — all three scopes keep 371 particles with accessible summaries and hover totals, but the compact surface intentionally omits per-provider and per-workspace drill-down.
- **No plugin leaderboard** — the list is labeled “Most-used features” because the Host cannot truthfully recover plugin ownership for every historical tool call.

### Dev Note

None.
