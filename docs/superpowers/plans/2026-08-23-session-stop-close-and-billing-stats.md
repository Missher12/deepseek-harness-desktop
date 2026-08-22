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

- [x] Write failing projection tests proving usage chunks are replacement samples per turn/step, no public latest-turn value appears before matching `turn/end`, settled failed/aborted turns keep reported usage, and route identity becomes `mixed` when needed.
- [x] Run the focused projection test and confirm the new assertions fail for the missing projection.
- [x] Add `LatestTurnBillingProjection` with four disjoint token buckets, provider/model identity, turn number, and settlement time. Register a versioned replay definition whose internal state updates on usage events but whose wire view changes only at the matching `turn/end`.
- [x] Write failing pricing tests for Beijing weekday peak, weekday off-peak, weekend all-day off-peak, and `deepseek-v4-flash-vision-exp`.
- [x] Implement `pricingTierAt()` plus the official 2026-08-23 price table and keep unknown models unpriced.
- [x] Run both focused suites until green.

## Task 2: Render a stable two-line financial footer and honor the estimate switch

**Files:**
- Modify: `packages/client/ui-conversation/src/client/chat/StatsLine.tsx`
- Modify: `packages/client/ui-conversation/src/client/chat/StatsLine.module.css`
- Modify: `packages/client/ui-conversation/src/client/locales.ts`
- Test: `packages/client/ui-conversation/tests/chat-stats.client.spec.tsx`

- [x] Write failing component tests proving the first performance line is unchanged, the second line shows latest-turn estimate, session estimate, exact provider balance, and localized tier, and turning estimates off hides only estimates/tier while preserving balance.
- [x] Add a validated optional Desktop-preference reader/subscription on `window.dshDesktop`; ordinary Web defaults to enabled. Keep balance refresh on its existing one-minute cadence and do not label local estimates as remaining balance.
- [x] Split financial groups into a second ellipsized row and only price a single supported official model.
- [x] Run the focused StatsLine and money suites until green.

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

- [x] Write failing tests for platform defaults, malformed-file fallback, exact schema validation, atomic persistence, and trusted preference IPC payloads.
- [x] Implement one owner-only `desktop-preferences.json` record under Electron `userData` with `{ closeBehavior, tieredPricingEstimates }`; macOS defaults to keep-running, Windows to quit.
- [x] Expose only `getDesktopPreferences`, one-key `setDesktopPreference`, and `onDesktopPreferences` through the existing isolated preload API.
- [x] Cover Show, real Quit, tray destruction, and bounded native close behavior through the existing Desktop lifecycle and platform suites.
- [x] Add Windows-only tray behavior for keep-running; macOS keeps Dock restore. Explicit app/menu/tray Quit always follows the existing bounded runtime shutdown.
- [x] Run all focused Desktop tests until green.

## Task 4: Add the Desktop preference rows to General Settings

**Files:**
- Create: `packages/client/ui-conversation/src/client/settings/DesktopPreferencesRow.tsx`
- Create: `packages/client/ui-conversation/src/client/settings/DesktopPreferencesRow.module.css`
- Modify: `packages/client/ui-conversation/src/client/apply.ts`
- Modify: `packages/client/ui-conversation/src/client/locales.ts`
- Test: existing Conversation and Desktop bridge suites

- [x] Prove the rows render only when the complete validated Desktop bridge exists and mutations round-trip through it.
- [x] Implement Harness-style General Settings rows: a compact close-behavior selector and one switch for tiered price estimates.
- [x] Register the rows in the existing Desktop-composed Conversation package, avoiding a redundant package and lockfile churn.
- [x] Build and test the affected Client package.

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

- [x] Write failing coordinator tests for continuation linkage, participant-only stop, immediate wait settlement, stopped-reply rejection, idempotency, forged/cross-session zero side effects, and a fresh explicit send starting a new chain.
- [x] Add optional continuation/root stop metadata to the receipt schema without invalidating old durable rows. Resolve roots with cycle and depth guards and serialize stop mutations through the existing receipt commit path.
- [x] Write failing tool/HTTP tests for `stop_session_collaboration`, the capability-protected stop route, and continuation delivery IDs.
- [x] Implement the fifth tool and transport method, and update relay instructions to forbid acknowledgement loops and teach Agent-controlled stopping.
- [x] Write failing client tests, then add a compact Stop/Stopped affordance to the existing outgoing relay transcript row. Do not mount the old messenger drawer, header button, or card UI.
- [x] Run the entire session-messenger suite until green.

## Task 6: Integration, regression, and delivery evidence

**Files:**
- Modify: `PROJECT_CONTEXT.md`
- Modify: affected package README pairs only if public contracts changed
- Modify: `apps/desktop/tests/packaged-smoke.ts` if the preload surface assertion needs extension

- [x] Run affected package typechecks/builds and focused tests.
- [x] Run root production builds for Host, Client Web, and Desktop.
- [x] Run the isolated native macOS packaged smoke and verify runtime/port/process cleanup plus quit and keep-running paths.
- [ ] Trigger the repository's Windows native CI gate for tray/install lifecycle when credentials/workflow are available; report code-level evidence separately until that gate succeeds.
- [x] Scan staged changes and tracked files for credential-like material without printing secret contents.
- [x] Update `PROJECT_CONTEXT.md`, review the diff for unrelated changes, and follow `superpowers:finishing-a-development-branch` before handoff.
