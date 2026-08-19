# macOS Marketplace, Usage, and Startup Polish Design

English | [中文](2026-08-19-macos-market-usage-startup-polish-design.zh.md)

**Date:** 2026-08-19

**Status:** Approved for implementation

**Target:** DeepSeek Harness Desktop on Intel macOS

## Goal

The Intel macOS application presents a denser plugin marketplace, shows a dashboard-shaped placeholder before Usage data arrives, replaces the generic startup spinner with a short industrial intro that uses DeepSeek colors and enters the real page directly, and adds truthful session-cost and DeepSeek account-balance facts to the composer statistics strip. The cross-Session messaging protocol, marketplace Host behavior, Usage aggregation, Electron security policy, and one-native-window architecture remain unchanged.

## Scope and Boundaries

This delivery changes four bounded paths: the patched `dshmarket@1.10.1` Client list, `@deepseek-ai/dsh-client-ui-settings-usage`, the macOS Desktop startup surfaces, and the existing composer statistics strip plus an optional read-only DeepSeek balance bridge. It does not add a Windows build, Windows acceptance work, ARM macOS packaging, a new analytics source, a second BrowserWindow, network-loaded visual assets, or a new marketplace operation.

Source components remain portable where the repository already shares them, but release-shaped validation and delivery target Intel macOS only. Existing light and dark theme tokens remain authoritative after the application enters the real UI.

## Visual Language

The startup treatment borrows the motion language of a dark industrial game interface without copying external artwork, fonts, text, or brand assets. A near-black field, DeepSeek blue, cold cyan, white type, fine grid lines, clipped word layers, sparse technical labels, and one horizontal scan replace the demo's yellow accent. The primary palette uses local CSS and existing Harness theme tokens; it performs no network request.

The DeepSeek name remains readable and brand-consistent. Large outline `HARNESS` lettering, bounded runtime labels, and staggered microcopy create the visual hierarchy. Decorative text describes real local properties such as Desktop runtime, Sessions, plugins, and Usage; it never presents a fake percentage, fabricated status, or credential-bearing value.

## Startup Sequence

The existing native loading page gains a macOS-specific self-contained variant. It begins immediately, assembles the DeepSeek wordmark and supporting text in approximately 900 milliseconds, then holds a low-motion dark frame while runtime readiness continues. Runtime startup and conflict detection keep their current ordering and overlap; the intro does not start the Harness process late.

The Desktop URL identifies the Darwin surface. Before Client plugins settle, the self-sufficient `AppRoot` renders a matching kernel-owned hold frame instead of the generic `Loading plugins…` spinner only for that surface. It imports no plugin package and preserves the current fail-loud per-entry diagnostics when boot fails.

When the Client loader settles, `AppRoot` mounts the real application underneath the startup overlay. A 240–320 millisecond DeepSeek-blue wipe removes the overlay, so the next visible surface is the usable page rather than a skeleton, blank frame, or second loading message. The wipe overlaps the first real application render and does not delay runtime startup or plugin activation. Reduced-motion mode skips assembly, scan, and wipe motion and switches directly from a static brand frame to the real page.

This work improves startup continuity and perceived latency. It does not claim a lower cold-start duration without measured evidence; deeper plugin-graph or bundle-splitting changes remain separate work.

## Usage Loading and Refresh

The first Usage visit renders a structural skeleton matching the final five-metric summary, activity field, and two detail columns. Skeleton cells expose no numbers, use `aria-busy`, retain the final page dimensions, and use a subtle DeepSeek-blue shimmer that becomes static under reduced-motion mode. The visible `Loading…` sentence is removed.

The Client keeps only the last successful immutable Usage snapshot in process memory. Revisiting Settings renders that snapshot immediately while starting one background refresh. A successful refresh replaces it atomically. A failed refresh retains the visible snapshot, marks it as potentially stale with a bounded localized status, and offers Retry; a first-load failure with no snapshot retains the current explicit error and Retry state. No browser storage, Session content, or new telemetry is added.

## Marketplace B2 Row

Discover results use one high-density horizontal row. A fixed 42-pixel DeepSeek-blue deterministic initial tile is painted immediately on the left; a remote owner image fades over it only after decoding, so a slow or failed request never leaves a blank image box. The central column contains the plugin name with an inline category chip, one metadata line for owner, stars, and publication date, and a one-line description. A DeepSeek-primary compact action and an icon-only overflow menu sit on the right; details, source, and package-name copy remain in the overflow menu.

The row reserves image and action geometry before content arrives, clamps long values, and avoids horizontal page overflow. The plugin name, inline category, primary action, and overflow action remain aligned on the first row at narrow Settings widths; long names yield space through ellipsis instead of pushing either action below the title. Focus, accessible names, source warnings, deprecated state, installation progress, dark mode, and reduced motion retain explicit coverage. Host routes, confirmation, locking, backup, rollback, self-protection, and package mutation semantics do not change.

## Session Cost and Account Balance

The composer statistics strip adds `This session est. ¥…` only when the durable whole-log token projection contains billable usage and the companion durable `tokenBillingModel` projection identifies exactly one supported DeepSeek V4 route. The estimate uses the current official CNY prices per one million tokens: Flash cache-hit/cache-miss/output at ¥0.02/¥1/¥2 and Pro at ¥0.025/¥3/¥6. Cache writes are counted with uncached input. Unknown or mixed models hide the estimate rather than presenting a misleading number. The label and tooltip state clearly that the figure is an estimate.

The exact account balance comes from DeepSeek's documented `GET /user/balance` endpoint through an optional capability-gated same-origin Host bridge that reuses the configured credential without exposing it to logs or application state. The Host validates the provider payload, prefers CNY when several currencies are returned, caches successful reads for 60 seconds, coalesces concurrent reads, and times out after 10 seconds. The Client shows the returned currency and total only after a successful read; unavailable credentials, non-DeepSeek endpoints, provider errors, or malformed responses remain silent instead of showing a fake zero or an error in the chat strip.

## Failure and Accessibility

Startup failures remain on the kernel-owned surface with exact failed entry identifiers and bounded error text. Runtime conflict and native failure pages retain their existing recovery actions. Usage skeletons and refresh states announce truthful busy or stale status without moving keyboard focus. Marketplace controls retain plugin-specific accessible names and visible focus.

Every animated surface honors `prefers-reduced-motion`. Color never carries status alone, decorative layers are excluded from the accessibility tree, and the real application remains keyboard reachable immediately after the startup overlay leaves.

## Verification

Component and source-shape tests cover the macOS loading page, Darwin URL selection, kernel hold and exit states, reduced motion, Usage skeleton and cached refresh behavior, Marketplace B2 hierarchy and overflow controls, official CNY pricing, mixed-model suppression, balance payload validation, capability rejection, cache/coalescing, and quiet Client fallback. Existing startup lifecycle, readiness, Usage projection, marketplace behavior, and cross-Session messaging tests remain green.

Browser acceptance exercises the real 800-pixel Desktop window in light and dark themes, narrow Settings width, 200% zoom, long English values, keyboard navigation, reduced motion, startup failure, first Usage load, cached refresh failure, and marketplace operation progress. The page must have no horizontal overflow, blank intermediate frame, duplicate startup animation, or console error.

Packaged Intel macOS smoke uses an isolated `DSH_HOME`, opens the real application through the native launcher, captures the startup and settled surfaces, verifies one BrowserWindow and one owned Harness process tree, and confirms clean exit. No Windows artifact is built, modified, released, or claimed by this delivery.

## Out of Scope

Windows UI or installer work, ARM macOS packaging, a second splash window, remote fonts or media, copied Endfield assets, persistent Usage caching in the browser, changes to Usage metric definitions, marketplace Host behavior, cross-Session messaging behavior, deep plugin lazy-loading, provider invoice reconciliation, non-DeepSeek provider pricing, and public release or deployment are outside this change.
