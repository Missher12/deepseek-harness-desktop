# DeepSeek Harness Usage Insights Implementation Plan

English | [中文](2026-08-18-deepseek-harness-usage-insights.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Follow the active repository `AGENTS.md`; do not delegate unless the current collaboration policy permits it.

**Goal:** Add a privacy-preserving, all-history usage dashboard to the macOS DeepSeek Harness Settings panel, closely matching the supplied reference while reporting only metrics that durable session logs can support accurately.

**Architecture:** A Host package folds immutable session inspections into per-session derived rows and persists those rows in a rebuildable storage domain keyed by session id and opaque log revision. A read-only Typert Remote aggregates the rows into one bounded snapshot. A Client package owns the Settings section, localized rendering, chart projections, loading/error states, and responsive styles. The Web bundle composes both halves; Electron gains no new IPC or filesystem permission.

**Tech Stack:** TypeScript, Cordis services and Loader, Typert Remote generation, Zod storage schemas, React 18, CSS Modules, Vitest, Testing Library, Playwright/Electron packaging scripts.

---

## File map

- Create `packages/session/usage-insights/` for the pure fold, cache schema, aggregate service, Remote contract, invariant, docs, and tests.
- Create `packages/client/ui-settings-usage/` for the Settings slot registration, React dashboard, chart helpers, locale dictionaries, CSS, invariant, docs, and tests.
- Modify `packages/api/remotes/src/client/index.ts`, package metadata, and references to mount and re-export the generated Remote client.
- Modify `packages/client/ui-settings-general/src/client/SettingsRoot.tsx` only to assign the new `usage` section a native nav glyph.
- Modify `packages/bundle/web-app/cordis.patch.yml` and `package.json` to compose the Host and Client packages.
- Modify root TypeScript project references and workspace metadata generated from package manifests.
- Add an implemented bilingual Agent Note under `.agents/notes/implemented/feature/`.
- Update `PROJECT_CONTEXT.md` with the shipped behavior, boundaries, and current verification evidence.

### Task 1: Establish red tests for the pure session fold

**Files:**

- Create: `packages/session/usage-insights/tests/fold.spec.ts`
- Create: `packages/session/usage-insights/src/types.ts`
- Create: `packages/session/usage-insights/src/fold.ts`

**Steps:**

- [ ] Add fixtures for `turn/start`, `turn/end`, provider usage chunks/final messages, request model/effort changes, direct and nested tool calls, explicit skill-invocation sources, malformed skill arguments, and fork `seedLength`.
- [ ] Assert replacement semantics for repeated usage samples from the same turn/step and assert reasoning tokens are not double counted.
- [ ] Assert local-time date bucketing, DST-safe streaks, completed-turn duration, current-streak grace through yesterday, and all-time longest streak.
- [ ] Assert non-finite, negative, fractional, and unsafe provider counts are omitted and increment the incomplete counter instead of being estimated.
- [ ] Run `pnpm vitest run packages/session/usage-insights/tests/fold.spec.ts` and confirm the new expectations fail before implementation.
- [ ] Implement a synchronous pure fold that retains only derived numeric/name data and ignores events before `header.seedLength`.
- [ ] Re-run the focused test and commit `feat(usage): fold durable session activity`.

### Task 2: Build the rebuildable Host index and aggregate Remote

**Files:**

- Create: `packages/session/usage-insights/src/spec.ts`
- Create: `packages/session/usage-insights/src/aggregate.ts`
- Create: `packages/session/usage-insights/src/index.ts`
- Create: `packages/session/usage-insights/src/invariant.ts`
- Create: `packages/session/usage-insights/tests/service.spec.ts`
- Create: `packages/session/usage-insights/tests/invariant.spec.ts`
- Create: `packages/session/usage-insights/tests/loader-composition.spec.ts`
- Create: `packages/session/usage-insights/package.json`
- Create: `packages/session/usage-insights/tsconfig.json`

**Steps:**

- [ ] Write failing service tests for initial backfill, revision reuse, changed/deleted sessions, time-zone rebuild, corrupt/version-mismatched cache recovery, one shared refresh, cancellation isolation, partial read failures, and live invalidation races.
- [ ] Define a `usage_insights` storage domain whose records contain only session identity/revision, time zone, last sequence, daily numeric buckets, model/effort counters, skill/tool counters, and aggregate scalars.
- [ ] Implement `UsageInsightsGateway.snapshot()` as a read-only Remote: list revisions, reuse matching rows, inspect only changed rows, delete disappeared rows, aggregate a bounded twelve-month daily series and top-five features, and return omitted-session counts.
- [ ] Buffer or invalidate live `session/event` changes so an in-flight backfill cannot overwrite newer in-memory facts; coalesce durable cache updates at complete turn boundaries and disposal.
- [ ] Prove real Loader composition without a provider key and prove unload releases the Remote and storage domain.
- [ ] Run the focused Host test set, then `pnpm run build:lib:host` to generate `./typert` and `./remote` artifacts.
- [ ] Commit `feat(usage): index all local session history`.

### Task 3: Mount the Remote in the Client API assembly

**Files:**

- Modify: `packages/api/remotes/src/client/index.ts`
- Modify: `packages/api/remotes/package.json`
- Modify: `packages/api/remotes/tsconfig.client.json`
- Modify: `packages/api/remotes/tsconfig.host.json`
- Modify: `tsconfig.base.json`
- Modify: `tsconfig.host.json`

**Steps:**

- [ ] Add a generated Remote contribution import and client-safe snapshot type re-export.
- [ ] Add workspace dependencies and project references without importing a Host runtime value into browser code.
- [ ] Run the remotes typecheck/build gates and verify `ctx.remote.usageInsights.snapshot()` is typed end-to-end.
- [ ] Commit with the following Client feature after the assembled wire is exercised.

### Task 4: Establish red tests for Client projections and page states

**Files:**

- Create: `packages/client/ui-settings-usage/tests/projection.client.spec.ts`
- Create: `packages/client/ui-settings-usage/tests/components.client.spec.tsx`
- Create: `packages/client/ui-settings-usage/tests/browser-usage.client.spec.tsx`
- Create: `packages/client/ui-settings-usage/tests/invariant.client.spec.ts`

**Steps:**

- [ ] Assert locale-aware compact token and duration formatting without converting unavailable data to zero.
- [ ] Assert that daily, weekly, and cumulative scopes all retain the full 53-by-7 particle field, with stable intensity, scope-correct hover totals, and month labels derived from the Host-provided local date range.
- [ ] Assert loading, empty, partial, error/retry, tab keyboard behavior, top-feature badges, and accessible metric/chart summaries.
- [ ] Assert no page-level horizontal overflow at an 800px window, the normal approximately 564px content column, and 200% zoom/narrow layout.
- [ ] Run the focused Client tests and confirm they fail before the implementation exists.

### Task 5: Implement the screenshot-matched Settings section

**Files:**

- Create: `packages/client/ui-settings-usage/src/client/index.ts`
- Create: `packages/client/ui-settings-usage/src/client/UsageInsightsSection.tsx`
- Create: `packages/client/ui-settings-usage/src/client/charts.ts`
- Create: `packages/client/ui-settings-usage/src/client/format.ts`
- Create: `packages/client/ui-settings-usage/src/client/locales.ts`
- Create: `packages/client/ui-settings-usage/src/client/UsageInsightsSection.module.css`
- Create: `packages/client/ui-settings-usage/src/index.ts`
- Create: `packages/client/ui-settings-usage/src/invariant.ts`
- Create: `packages/client/ui-settings-usage/src/css-modules.d.ts`
- Create: `packages/client/ui-settings-usage/package.json`
- Create: `packages/client/ui-settings-usage/tsconfig.json`
- Create: `packages/client/ui-settings-usage/tsdown.config.ts`
- Modify: `packages/client/ui-settings-general/src/client/SettingsRoot.tsx`
- Modify: `tsconfig.client.json`

**Steps:**

- [ ] Register `settings.section` id `usage` at order 12 so it appears between Models and Plugins, with localized label `使用统计` / `Usage`.
- [ ] Render five equal KPI cells, daily/weekly/cumulative particle tabs, activity insights, and “Most-used features” with truthful Skill/Tool badges. Daily remains a 53-by-7 calendar heatmap; weekly and cumulative scopes fill each Sunday-aligned column from bottom to top and expose scope-specific Chinese/English tooltip copy.
- [ ] Use existing `--dsw-alias-*` tokens, tabular numerals, semantic controls, dark-mode-safe color mixing, reduced-motion behavior, and responsive wrapping without changing the global Settings shell width.
- [ ] Add a distinct native nav icon using the existing primitive vocabulary, with gear fallback preserved for unknown sections.
- [ ] Run the focused Client tests and commit `feat(settings): add usage insights dashboard`.

### Task 6: Compose the shipped Web/Mac bundle and document the package contracts

**Files:**

- Modify: `packages/bundle/web-app/cordis.patch.yml`
- Modify: `packages/bundle/web-app/package.json`
- Create: `packages/session/usage-insights/README.md`
- Create: `packages/session/usage-insights/README.zh.md`
- Create: `packages/session/usage-insights/README.i18n.yaml`
- Create: `packages/client/ui-settings-usage/README.md`
- Create: `packages/client/ui-settings-usage/README.zh.md`
- Create: `packages/client/ui-settings-usage/README.i18n.yaml`
- Create: `.agents/notes/implemented/feature/2026-08-18-local-usage-insights.md`
- Create: `.agents/notes/implemented/feature/2026-08-18-local-usage-insights.zh.md`
- Create: `.agents/notes/implemented/feature/2026-08-18-local-usage-insights.i18n.yaml`
- Modify: `PROJECT_CONTEXT.md`

**Steps:**

- [ ] Mount the Host package after storage/session persistence and mount the Client package after API remotes and Settings base services.
- [ ] Add package docs covering Model Experience, KV-cache accounting, privacy boundaries, cold backfill cost, partial data, and the inability to attribute old tool calls to Loader plugins.
- [ ] Record the implemented extension-point and cache decision in a bilingual Agent Note; regenerate translation sidecars.
- [ ] Update project context with implementation status and dated verification evidence.
- [ ] Run translation pairing, Markdown links/wrap, doc sync, package manifests, and TypeScript project-reference gates.
- [ ] Commit `docs: record local usage insights boundary`.

### Task 7: Run repository-level regression and visual acceptance

**Files:**

- Test only; fix only files already inside this feature's scope if a failure is caused by the change.

**Steps:**

- [ ] Run focused Host/Client coverage at 100% for both new packages.
- [ ] Run changed-package lint/typecheck/build and the real Web Loader composition tests.
- [ ] Launch the assembled Web settings with a deterministic isolated `DSH_HOME`; capture normal-width, dark-theme, narrow, and 200%-zoom screenshots and check console errors and horizontal overflow.
- [ ] Independently fold the same fixture logs and compare the UI's five KPIs, activity cells, insight rows, and top features to the expected numbers.
- [ ] Run `git diff --check`, generated-file checks, invariant gates, and the repository pre-push checklist appropriate to the touched packages.

### Task 8: Package and accept the Intel macOS app without mutating real history

**Files:**

- Build outputs under the repository's existing desktop distribution paths only.

**Steps:**

- [ ] Build the Intel macOS artifact using the repository's established desktop packaging command.
- [ ] Launch the packaged `.app` against an isolated deterministic `DSH_HOME`; verify the Settings page, tabs, dark mode, zoom, retry path, and no console/runtime errors.
- [ ] Snapshot hashes of fixture JSONL logs before and after acceptance and require byte-identical results.
- [ ] Run a final read-only acceptance against the user's existing `~/.dsh`: compare UI totals to an independent offline fold and verify no history artifact changed.
- [ ] Install/replace the Mac app only through the repository's established reversible install path after isolated acceptance passes; retain a recovery path for the previous app.
- [ ] Record artifact path, architecture, version, size, SHA-256, tests, screenshots, and any remaining limitations.
- [ ] Send the completion notification to Codex task `019ffbac-ff3a-7be0-920c-d6bffb1ffcfc` only after all required acceptance checks pass.
