# DeepSeek Harness Usage Insights Design

English | [中文](2026-08-18-deepseek-harness-usage-insights-design.zh.md)

**Date:** 2026-08-18

**Status:** Approved for implementation

**Target:** DeepSeek Harness Desktop on Intel macOS

## Goal

DeepSeek Harness Desktop adds a Usage section to Settings that mirrors the compact activity dashboard supplied by the user. It reports real local history across every durable Session, including archived Sessions and subagent Sessions, without uploading analytics or retaining message content in the derived index.

The page contains five headline metrics, one 12-month particle visualization with daily, weekly, and cumulative hover scopes, activity insights, and a ranked list of the most-used Skills and Tools. The existing Settings shell, Session logs, and application lifecycle remain authoritative.

## Product decisions

- The Settings navigation receives one `usage` section between Models and Plugins. It uses the existing shell, theme tokens, typography, and scrolling behavior.
- The first page load backfills every durable Session in `DSH_HOME`. Later loads inspect lightweight per-Session persistence revisions and recompute only new, changed, or removed Sessions.
- Archived Sessions and subagent Sessions count. A forked Session excludes its inherited seed prefix, so the same provider usage and calls are not counted once in the parent and again in each descendant.
- Calendar buckets use the Mac's current local time zone. A time-zone change invalidates date-derived cache rows and rebuilds them from the logs.
- The derived index stores only Session identity and revision facts, dates, durations, numeric token buckets, model and effort identifiers, and Skill or Tool names with counts. It never stores prompts, assistant content, tool arguments or results, titles, working directories, credentials, or attachments.
- Provider-reported usage is authoritative. Missing usage is not estimated; the page identifies omitted Sessions instead of presenting estimates as exact measurements.
- Historical logs record Tool names and explicit Skill identities but do not reliably record which Loader plugin owned each Tool at that time. The ranking is therefore named Most-used features and labels each row as a Skill or Tool instead of inventing plugin attribution.

## Metric definitions

The headline row contains these five values:

1. **Total tokens:** sum of uncached input, cache read, cache write, and output buckets reported by providers. Reasoning tokens are already an output subdivision and are not added again.
2. **Peak tokens:** the largest total for one local calendar day.
3. **Longest Session:** the largest per-Session sum of completed `turn/start` to matching `turn/end` wall time. Idle time between turns does not count.
4. **Current streak:** consecutive local calendar days ending today, or yesterday when today has not started yet, that contain at least one human-authored message.
5. **Longest streak:** the longest consecutive run of those activity days.

The activity visualization shows 53 Sunday-aligned calendar weeks through three tabs. Every tab retains the same 53-column by 7-row particle field, including gray particles for zero-use and future days in the current week:

- **Daily:** a 53-column by 7-row calendar heatmap. Color intensity uses per-day token totals and a stable five-level scale derived from non-zero days in the visible range.
- **Weekly:** each column is a weekly aggregate rendered as one to seven blue particles filled from bottom to top over the complete gray field. Hover names the week's Sunday and reports that week's Token total.
- **Cumulative:** each column is the all-history running total through that week, rendered as a bottom-up progressive particle stack. Tokens before the visible 53-week range form the first column's baseline, so the final column agrees with the all-time headline total.

Activity insights show cache-hit rate, most-used model, most-used reasoning effort, unique invoked Skills, total Tool calls, and chat days. Counts include native Tool calls and nested Code Mode dispatches. Skill counts combine explicit Skill invocations with successfully parsed `skill` Tool requests and never retain their raw argument JSON.

## Architecture

The feature is split into a Host provider and a Client settings package.

- `@deepseek-ai/dsh-usage-insights` owns the log fold, per-Session derived rows, global aggregation, storage domain, and read-only Remote method.
- `@deepseek-ai/dsh-client-ui-settings-usage` owns the Settings registration, loading and partial-error states, responsive charts, formatting, localization, and accessibility.
- The Web app bundle mounts both packages. Electron preload receives no new API, filesystem access, IPC method, or permission.

The Host service calls `sessionPersistence.listSnapshots()` to obtain stable Session revisions. Unchanged rows are read from a versioned `usage_insights` storage domain. New or changed logs are inspected through the persistence service and folded without publishing or resuming an Agent. The service keeps one shared refresh in flight, removes rows for logs that no longer exist, and replaces the global snapshot only after the complete refresh settles.

Live `session/event` records update the in-memory row for their owner. Durable cache writes are coalesced and occur at `turn/end` or Session disposal rather than on streaming chunks. A first-load scan and live events use the same pure fold; generation checks prevent a late scan from overwriting newer live values.

The Client requests one immutable aggregate snapshot when the section mounts. The existing connection cancellation ends abandoned reads, and a retry action starts a fresh generation after an error. No background polling runs while Settings is closed.

## Presentation

The page follows the supplied white-space-heavy composition rather than adding dashboard chrome:

- Five equal headline cells sit inside one subtle rounded outline.
- The chart title and three text tabs share one row; month labels stay aligned below the stable particle field in every scope.
- Activity insights and Most-used features form two balanced columns below the chart.
- Feature rows use a small type badge, exact Skill or Tool name, and a right-aligned run count.
- Values use locale-aware compact formatting. Hover opens a rounded visible tooltip with scope-specific copy: the daily date, the weekly Sunday, or the cumulative cutoff week.

The existing approximately 564-pixel Settings content column remains unchanged. Calendar cells compress to fit without horizontal page scrolling. Narrow layouts stack the headline cells and lower columns; 200% zoom retains a single readable column. Light and dark themes use Harness tokens, and meaning never depends on color alone. Charts have keyboard-accessible summaries, visible focus, reduced-motion behavior, and text alternatives.

## Failure handling

- An absent index displays a loading skeleton while the first backfill runs.
- A corrupt or version-mismatched derived row is discarded and rebuilt; it never changes the Session log.
- One unreadable Session does not fail the page. The snapshot reports the omitted count, the UI displays a bounded warning, and Retry re-runs the complete refresh.
- A provider usage sample with invalid or unsafe numeric fields is omitted and counted as incomplete.
- No recorded provider usage renders an unavailable token state rather than a fabricated zero, while activity and call counts that remain derivable still render.
- Refresh cancellation, application exit, and service disposal stop outstanding work and settle the shared refresh before resource teardown.

## Alternatives considered

- **Scan every log in the browser on every opening:** rejected because the renderer should not receive filesystem access or message-bearing logs, and repeated full scans scale poorly.
- **Persist only new telemetry from the release date:** rejected because the user explicitly requires all existing history and because parallel telemetry would become a second authority beside durable Session events.
- **Maintain a standalone analytics database as the source of truth:** rejected because it can drift from deleted, replaced, repaired, or forked logs. A revision-bound, rebuildable derived index gives fast reads without competing with Session persistence.

## Verification

- Pure fold tests cover token buckets, duplicate usage replacement, daily boundaries, DST and time-zone rebuilds, turn duration, current and longest streaks, explicit and model-loaded Skills, native and nested Tools, missing usage, and inherited seed exclusion.
- Service tests cover full backfill, unchanged-revision reuse, changed and removed Sessions, corrupt-cache recovery, concurrent refresh sharing, cancellation, live-event races, and partial errors.
- Real Loader coverage mounts the Host provider, Remote service, Client package, Settings slot, persistence backend, and storage domain without an API key.
- Client tests cover exact formatting, 371-particle preservation and hover totals across all tabs, heat levels, empty/loading/partial/error states, narrow reflow, keyboard summaries, and light/dark token usage.
- Browser acceptance opens the assembled Settings panel at the real 800-pixel window, verifies the approximately 564-pixel content width, normal and 200% zoom, no horizontal overflow, and no console errors.
- Packaged Intel macOS acceptance uses an isolated `DSH_HOME` with deterministic historical fixtures, proves that existing Session artifacts remain byte-identical, and checks application exit plus listener cleanup.
- Live acceptance against the user's `~/.dsh` is read-only for Session artifacts and compares the visible totals with an independent fold before the application is replaced or published.

## Acceptance criteria

The Mac application opens Usage from Settings and immediately reports all available historical Sessions after a bounded first-load backfill. Every displayed number follows the documented event-derived definition, forked history is not double-counted, partial data is disclosed, and no content or credential enters the derived index. The page visually matches the supplied compact dashboard at the real Settings width, remains usable at 200% zoom and in dark mode, and passes source, assembled-Web, and packaged Intel macOS verification before installation.
