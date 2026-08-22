# Session Stop, Close Behavior, and Billing Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real stop boundary for one cross-session collaboration chain, configurable Desktop close behavior, and a compact financial footer with a switch for tiered estimates.

**Architecture:** Extend the existing receipt graph instead of adding a second messenger UI, keep Desktop preferences in one atomic `userData` record behind a narrow validated preload bridge, and derive latest-turn billing through the existing durable projection registry. The normal Harness transcript remains the only communication surface; the outgoing relay row gains only a compact Stop action.

**Tech Stack:** TypeScript, Cordis, React, Electron, Schemastery, Vitest, pnpm, electron-builder.

---

## Task 1: Settle latest-turn usage and correct official pricing tiers

**Files:**
- Modify: `packages/llm/token-meter/src/projection.ts`
- Modify: `packages/llm/token-meter/src/usage-projection.ts`
- Modify: `packages/llm/token-meter/src/index.ts`
- Modify: `packages/llm/token-meter/src/types.ts`
- Test: `packages/llm/token-meter/tests/token-usage-projection.spec.ts`
- Modify: `packages/client/ui-conversation/src/client/chat/usage-money.ts`
- Test: `packages/client/ui-conversation/tests/usage-money.client.spec.ts`

- [ ] Write failing projection tests proving usage chunks are replacement samples per turn/step, no public latest-turn value appears before matching `turn/end`, settled failed/aborted turns keep reported usage, and route identity becomes `mixed` when needed.
- [ ] Run the focused projection test and confirm the new assertions fail for the missing projection.
- [ ] Add `LatestTurnBillingProjection` with four disjoint token buckets, provider/model identity, turn number, and settlement time. Register a versioned replay definition whose internal state updates on usage events but whose wire view changes only at the matching `turn/end`.
- [ ] Write failing pricing tests for Beijing weekday peak, weekday off-peak, weekend all-day off-peak, and `deepseek-v4-flash-vision-exp`.
- [ ] Implement `pricingTierAt()` plus the official 2026-08-23 price table and keep unknown models unpriced.
- [ ] Run both focused suites until green.

## Task 2: Render a stable two-line financial footer and honor the estimate switch

**Files:**
- Modify: `packages/client/ui-conversation/src/client/chat/StatsLine.tsx`
- Modify: `packages/client/ui-conversation/src/client/chat/StatsLine.module.css`
- Modify: `packages/client/ui-conversation/src/client/locales.ts`
- Test: `packages/client/ui-conversation/tests/chat-stats.client.spec.tsx`

- [ ] Write failing component tests proving the first performance line is unchanged, the second line shows latest-turn estimate, session estimate, exact provider balance, and localized tier, and turning estimates off hides only estimates/tier while preserving balance.
- [ ] Add a validated optional Desktop-preference reader/subscription on `window.dshDesktop`; ordinary Web defaults to enabled. Keep balance refresh on its existing one-minute cadence and do not label local estimates as remaining balance.
- [ ] Split financial groups into a second ellipsized row with its own tooltip, and only price a single supported official model.
- [ ] Run the focused StatsLine and money suites until green.

## Task 3: Persist Desktop preferences and implement native close behavior

**Files:**
- Create: `apps/desktop/src/preferences.ts`
- Create: `apps/desktop/src/window/tray.ts`
- Modify: `apps/desktop/src/preload-api.ts`
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/window/platform.ts`
- Test: `apps/desktop/tests/preferences.spec.ts`
- Test: `apps/desktop/tests/preload-api.spec.ts`
- Test: `apps/desktop/tests/window-platform.spec.ts`
- Test: `apps/desktop/tests/window-tray.spec.ts`

- [ ] Write failing tests for platform defaults, malformed-file fallback, exact schema validation, atomic persistence, and trusted preference IPC payloads.
- [ ] Implement one owner-only `desktop-preferences.json` record under Electron `userData` with `{ closeBehavior, tieredPricingEstimates }`; macOS defaults to keep-running, Windows to quit.
- [ ] Expose only `getDesktopPreferences`, one-key `setDesktopPreference`, and `onDesktopPreferences` through the existing isolated preload API.
- [ ] Write failing tray-controller tests for Show, real Quit, and destruction when the preference changes to quit.
- [ ] Add Windows-only tray behavior for keep-running; macOS keeps Dock restore. Explicit app/menu/tray Quit always follows the existing bounded runtime shutdown.
- [ ] Run all focused Desktop tests until green.

## Task 4: Add the Desktop preference rows to General Settings

**Files:**
- Create: `packages/client/ui-settings-desktop-preferences/package.json`
- Create: `packages/client/ui-settings-desktop-preferences/tsconfig.json`
- Create: `packages/client/ui-settings-desktop-preferences/tsdown.config.ts`
- Create: `packages/client/ui-settings-desktop-preferences/src/index.ts`
- Create: `packages/client/ui-settings-desktop-preferences/src/client/index.ts`
- Create: `packages/client/ui-settings-desktop-preferences/src/client/contracts.ts`
- Create: `packages/client/ui-settings-desktop-preferences/src/client/DesktopPreferencesRow.tsx`
- Create: `packages/client/ui-settings-desktop-preferences/src/client/DesktopPreferencesRow.module.css`
- Create: `packages/client/ui-settings-desktop-preferences/src/client/locales.ts`
- Test: `packages/client/ui-settings-desktop-preferences/tests/browser-plugin.client.spec.tsx`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/desktop.cordis.patch.yml`
- Modify: `pnpm-lock.yaml`

- [ ] Write a failing client-package test proving two rows register only when the Desktop bridge exists and mutations round-trip through the validated bridge.
- [ ] Implement Harness-style General Settings rows: a compact close-behavior selector and one switch for tiered price estimates.
- [ ] Wire the package into the Desktop patch/dependency graph and update the lockfile.
- [ ] Build and test the new package.

## Task 5: Stop a complete cross-session collaboration chain

**Files:**
- Modify: `packages/extensions/session-messenger/src/types.ts`
- Modify: `packages/extensions/session-messenger/src/spec.ts`
- Modify: `packages/extensions/session-messenger/src/envelope.ts`
- Modify: `packages/extensions/session-messenger/src/coordinator.ts`
- Modify: `packages/extensions/session-messenger/src/waits.ts`
- Modify: `packages/extensions/session-messenger/src/tools.ts`
- Modify: `packages/extensions/session-messenger/src/http.ts`
- Modify: `packages/extensions/session-messenger/src/index.ts`
- Modify: `packages/extensions/session-messenger/src/client/store.ts`
- Modify: `packages/extensions/session-messenger/src/client/OutgoingRelayView.tsx`
- Modify: `packages/extensions/session-messenger/src/client/OutgoingRelayView.module.css`
- Modify: `packages/extensions/session-messenger/src/client/index.tsx`
- Test: `packages/extensions/session-messenger/tests/coordinator.spec.ts`
- Test: `packages/extensions/session-messenger/tests/tools.spec.ts`
- Test: `packages/extensions/session-messenger/tests/http.spec.ts`
- Test: `packages/extensions/session-messenger/tests/client-store.client.spec.ts`
- Test: `packages/extensions/session-messenger/tests/outgoing-row.client.spec.tsx`

- [ ] Write failing coordinator tests for continuation linkage, participant-only stop, immediate wait settlement, stopped-reply rejection, idempotency, forged/cross-session zero side effects, and a fresh explicit send starting a new chain.
- [ ] Add optional continuation/root stop metadata to the receipt schema without invalidating old durable rows. Resolve roots with cycle and depth guards and serialize stop mutations through the existing receipt commit path.
- [ ] Write failing tool/HTTP tests for `stop_session_collaboration`, the capability-protected stop route, and continuation delivery IDs.
- [ ] Implement the fifth tool and transport method, and update relay instructions to forbid acknowledgement loops and teach Agent-controlled stopping.
- [ ] Write failing client tests, then add a compact Stop/Stopped affordance to the existing outgoing relay transcript row. Do not mount the old messenger drawer, header button, or card UI.
- [ ] Run the entire session-messenger suite until green.

## Task 6: Integration, regression, and delivery evidence

**Files:**
- Modify: `PROJECT_CONTEXT.md`
- Modify: affected package README pairs only if public contracts changed
- Modify: `apps/desktop/tests/packaged-smoke.ts` if the preload surface assertion needs extension

- [ ] Run affected package typechecks/builds and focused tests.
- [ ] Run root production builds for Host, Client Web, and Desktop.
- [ ] Run the isolated native macOS packaged smoke and verify runtime/port/process cleanup plus quit and keep-running paths.
- [ ] Trigger the repository's Windows native CI gate for tray/install lifecycle when credentials/workflow are available; report code-level evidence separately until that gate succeeds.
- [ ] Scan staged changes and tracked files for credential-like material without printing secret contents.
- [ ] Update `PROJECT_CONTEXT.md`, review the diff for unrelated changes, and follow `superpowers:finishing-a-development-branch` before handoff.
