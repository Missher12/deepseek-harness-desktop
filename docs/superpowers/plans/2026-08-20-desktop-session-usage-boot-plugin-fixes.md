# Desktop Session, Usage, Boot, and Plugin Fixes Implementation Plan

English | [中文](2026-08-20-desktop-session-usage-boot-plugin-fixes.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix permanent deletion of resumed archived sessions, add real no-project sessions, make Usage Insights instant and geometry-stable, restore the macOS cold-start progress bar, and make packaged plugin installs independent of a system Node binary.

**Architecture:** Preserve the existing Session/Workspace/Remote boundaries. The Host must retain every API-resumed Agent handle; no-project sessions remain ordinary unaccounted sessions created through `session.create`; Usage Insights uses a bounded validated renderer cache with stale-while-refresh; both startup surfaces share equivalent progress geometry; the Desktop package runtime creates an owner-only temporary `node` shim that delegates to the packaged Electron runtime in Node mode.

**Tech Stack:** TypeScript, React 18, Cordis services, Electron, pnpm, Vitest, CSS Modules, self-contained HTML/CSS.

---

### Task 1: Delete a resumed archived session

**Files:**
- Modify: `packages/api/remotes/src/agent-lookup.ts`
- Modify: `packages/api/remotes/tests/agent-lookup.spec.ts`
- Modify: `packages/host/apiproxy/src/api-proxy.ts`
- Modify: `packages/host/apiproxy/tests/api-proxy-workspace.spec.ts`

- [ ] Add a failing API-remote test proving a cold resume exposes its exact `AgentHandle` to the owning Host callback.
- [ ] Run `pnpm exec vitest run packages/api/remotes/tests/agent-lookup.spec.ts` and confirm the ownership assertion fails because the handle is currently discarded.
- [ ] Add the narrow `retainHandle` option to `ApiRemoteAgentOptions`, call it exactly once after `ctx.agents.resume()`, and return its Agent.
- [ ] Add a Host regression test that resumes, archives, and permanently deletes the same ordinary session.
- [ ] Run the two focused suites and confirm the resumed session is disposed, detached, durably deleted, and purged from Workspace state.

### Task 2: Create and select a no-project session

**Files:**
- Modify: `packages/client/runtime/src/client/contract/workspaces.ts`
- Modify: `packages/client/runtime/src/client/workspaces/service.ts`
- Modify: `packages/client/runtime/tests/workspaces-service.client.spec.ts`
- Modify: `packages/client/ui-conversation/src/client/contract/slots.ts`
- Modify: `packages/client/ui-conversation/src/client/apply.ts`
- Modify: `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`
- Modify: `packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx`
- Modify: `packages/client/ui-conversation/src/client/locales.ts`
- Modify: `packages/client/ui-conversation/tests/apply-inject.client.spec.tsx`
- Modify: `packages/client/ui-conversation/tests/skeleton.client.spec.tsx`
- Modify: `packages/client/ui-workspace/src/client/WorkspacePicker.tsx`
- Modify: `packages/client/ui-workspace/src/client/contract/slots.ts`
- Modify: `packages/client/ui-workspace/src/client/locales.ts`
- Modify: `packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx`

- [ ] Add failing runtime tests for `connectNoProject()`: reuse an unarchived unaccounted blank session, otherwise call `sessions.create()` without `workspaceId` or `cwd`.
- [ ] Add failing picker/root tests for a first-class “No project” menu entry, selected state, enabled composer, and draft hand-off.
- [ ] Run the focused runtime and UI tests and confirm failures name the missing method/entry.
- [ ] Implement `connectNoProject()`, widen the picker owner contract with `onPickNoProject`, and label every current unaccounted session as “No project”.
- [ ] Keep project switching and project creation unchanged; run the focused suites to green.

### Task 3: Make Usage Insights immediate and layout-stable

**Files:**
- Modify: `packages/client/ui-settings-usage/src/client/snapshot-cache.ts`
- Modify: `packages/client/ui-settings-usage/src/client/UsageInsightsSection.tsx`
- Modify: `packages/client/ui-settings-usage/src/client/UsageInsightsSection.module.css`
- Modify: `packages/client/ui-settings-usage/tests/snapshot-cache.client.spec.ts`
- Modify: `packages/client/ui-settings-usage/tests/components.client.spec.tsx`

- [ ] Add failing cache tests for durable localStorage restoration, schema/version rejection, malformed-data rejection, and reset cleanup.
- [ ] Add a failing component geometry test proving the first-load skeleton has the real five-KPI, tab row, 371-cell heatmap, month strip, and two-column detail structure.
- [ ] Run both focused suites and confirm failures come from process-only caching and the 70-cell placeholder.
- [ ] Implement a versioned, privacy-minimal, exception-safe localStorage cache while retaining the process-memory fast path.
- [ ] Rebuild the skeleton with the same containers and dimensions as the ready dashboard, then run both suites to green.

### Task 4: Restore a continuous cold-start loading bar

**Files:**
- Modify: `apps/desktop/renderer/loading-macos.html`
- Modify: `apps/desktop/tests/renderer-pages.spec.ts`
- Modify: `packages/client/web/src/DesktopBootSurface.tsx`
- Modify: `packages/client/web/src/boot-page.module.css`
- Modify: `packages/client/web/tests/boot-page.client.spec.ts`

- [ ] Change the existing native-page test and add a web-surface test that require an accessible indeterminate progress bar on both startup layers.
- [ ] Run both focused suites and confirm they fail because the bar is absent.
- [ ] Add the same thin DeepSeek blue/cyan track and animated fill below the status line in both surfaces, including reduced-motion behavior.
- [ ] Run both focused suites to green and inspect both surfaces at desktop geometry.

### Task 5: Supply packaged Node to pnpm lifecycle scripts

**Files:**
- Modify: `packages/host/desktop-plugin-runtime/src/index.ts`
- Modify: `packages/host/desktop-plugin-runtime/tests/runtime.spec.ts`

- [ ] Add a failing service test requiring a private executable `node` shim directory at the front of `PATH`, the packaged executable in a closed environment variable, and cleanup on disposal.
- [ ] Run `pnpm exec vitest run packages/host/desktop-plugin-runtime/tests/runtime.spec.ts` and confirm the environment assertion fails.
- [ ] Create the per-service private shim lazily, delegate to `facts.executable` under `ELECTRON_RUN_AS_NODE=1`, prepend it to the inherited PATH, and remove it during service teardown.
- [ ] Add a real subprocess smoke fixture where a pnpm lifecycle invokes bare `node`; run it with system Node removed from PATH and confirm it succeeds through the shim.
- [ ] Run the focused suite to green.

### Task 6: Integrate, document, package, and install internally

**Files:**
- Modify: `PROJECT_CONTEXT.md`
- Modify only if required by the release scripts: Desktop version/changelog files selected by the repository’s existing release workflow.

- [ ] Run all focused suites from Tasks 1–5 together.
- [ ] Run `pnpm run typecheck:contracts-ready`, `pnpm run lint:contracts-ready`, and the affected package builds.
- [ ] Run a local macOS Desktop package smoke test, including cold start, no-project send, archive/delete of a resumed session, Usage revisit/relaunch, and installation of the originally failing plugin target.
- [ ] Update `PROJECT_CONTEXT.md` with architecture, current progress, verification evidence, and known boundaries.
- [ ] Build and install the internal macOS application only after all prior gates pass; do not push or publish anything.
