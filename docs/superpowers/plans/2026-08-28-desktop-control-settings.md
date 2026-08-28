# Desktop Control Settings Implementation Plan

English | [中文](2026-08-28-desktop-control-settings.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the misleading aggregate Browser & Computer Control state with independent capability, enablement, permission, and refresh states, then ship the approved compact-list module on macOS.

**Architecture:** Electron main remains the sole authority and projects one frozen display snapshot from coordinator availability, native status, application enumeration, persisted settings, and active-control state. The strict preload bridge carries only this path-free snapshot and closed intents; the React package renders the approved compact list and keeps failures local to the affected row.

**Tech Stack:** TypeScript, Electron IPC, React, CSS Modules, Vitest, Testing Library, bilingual Markdown.

---

### Task 1: Replace the aggregate snapshot contract

**Files:**
- Modify: `apps/desktop/src/preload-api.ts`
- Modify: `apps/desktop/tests/preload-api.spec.ts`
- Modify: `packages/client/ui-desktop-control/src/client/contracts.ts`
- Modify: `packages/client/ui-desktop-control/src/client/store.ts`
- Modify: `packages/client/ui-desktop-control/tests/components.client.spec.tsx`

- [ ] **Step 1: Write failing validator tests for the independent shape.**

```ts ignore-check
const snapshot = {
  browser: { availability: 'available', enabled: false },
  computer: { availability: 'available', enabled: false },
  permissions: { screenViewing: 'granted', assistiveControl: 'granted' },
  refresh: { status: { state: 'ready' }, apps: { state: 'ready' } },
  ordinaryApps: [], emergencyAccelerator: 'CommandOrControl+Shift+F12',
  active: null, stopping: false,
}
expect(isDesktopControlUiSnapshot(snapshot)).toBe(true)
expect(isDesktopControlUiSnapshot({ ...snapshot, supported: true })).toBe(false)
expect(isDesktopControlUiSnapshot({ ...snapshot, leaseId: 'renderer' })).toBe(false)
```

- [ ] **Step 2: Run `pnpm exec vitest run apps/desktop/tests/preload-api.spec.ts packages/client/ui-desktop-control/tests/components.client.spec.tsx`; expect RED because the validators still require `supported`, `browserEnabled`, and `computerEnabled`.**
- [ ] **Step 3: Add exact `DesktopControlCapabilityState` and `DesktopControlRefreshState` unions to both preload and client contracts. Validate every nested object with plain prototypes and exact keys; bound failure messages to 160 UTF-16 code units; keep authority-bearing extensions rejected.**
- [ ] **Step 4: Update `EMPTY_DESKTOP_CONTROL_SNAPSHOT` to use `unknown` availability, disabled policies, unknown permissions, and checking refresh branches.**
- [ ] **Step 5: Re-run the focused tests and both package typechecks; expect PASS.**
- [ ] **Step 6: Commit with `fix(desktop): separate control capability states`.**

### Task 2: Make main-process status refresh independent and durable

**Files:**
- Modify: `apps/desktop/src/control/control-coordinator.ts`
- Modify: `apps/desktop/src/control/ui-authority.ts`
- Modify: `apps/desktop/tests/control-coordinator.spec.ts`
- Modify: `apps/desktop/tests/computer-control-ui.spec.ts`

- [ ] **Step 1: Add failing authority tests for browser/computer independence and partial failures.**

```ts ignore-check
expect((await authority.snapshot()).browser).toEqual({ availability: 'available', enabled: false })
expect((await authority.snapshot()).computer).toEqual({ availability: 'available', enabled: false })
status.mockRejectedValueOnce(new Error('private native detail'))
expect((await authority.snapshot()).refresh.status).toEqual({ state: 'failed', message: 'Computer status could not be refreshed.' })
list.mockRejectedValueOnce(new Error('private app detail'))
expect((await authority.snapshot()).ordinaryApps).toEqual(lastValidApps)
```

- [ ] **Step 2: Run `pnpm exec vitest run apps/desktop/tests/control-coordinator.spec.ts apps/desktop/tests/computer-control-ui.spec.ts`; expect RED because coordinator status omits browser support and `Promise.all` collapses both reads.**
- [ ] **Step 3: Add `browserSupported` beside `computerSupported` in `DesktopControlCoordinatorStatus`. Derive both only from their production adapters.**
- [ ] **Step 4: Replace the combined `Promise.all` catch with separately settled status/list reads. Cache only frozen, validated last-good native status and application projections in the authority instance. First-read failure produces unknown Computer availability; a later failure preserves last-good values and marks only the failed refresh branch. Never surface caught error text.**
- [ ] **Step 5: Keep mutation serialization and main-owned confirmation unchanged. Map the closed setting intents onto `browser.enabled` and `computer.enabled` in returned snapshots.**
- [ ] **Step 6: Re-run focused tests, `pnpm exec tsc -b apps/desktop/tsconfig.json --force`, and scoped Oxlint; expect PASS.**
- [ ] **Step 7: Commit with `fix(desktop): preserve independent control status`.**

### Task 3: Render the approved compact-list module

**Files:**
- Modify: `packages/client/ui-desktop-control/src/client/components.tsx`
- Modify: `packages/client/ui-desktop-control/src/client/desktop-control.module.css`
- Modify: `packages/client/ui-desktop-control/src/client/locales.ts`
- Modify: `packages/client/ui-desktop-control/src/client/index.ts`
- Modify: `packages/client/ui-desktop-control/tests/components.client.spec.tsx`

- [ ] **Step 1: Add failing component tests for the full B layout.**

```tsx ignore-check
const view = render(<DesktopControlSettings snapshot={snapshot} onMutation={mutate} onRetry={retry} />)
expect(view.getByText('2 capabilities available')).toBeTruthy()
expect(view.getByText('Available · Not enabled')).toBeTruthy()
expect(view.getByText('Screen Viewing')).toBeTruthy()
expect(view.getByText('Authorized applications')).toBeTruthy()
fireEvent.click(view.getByRole('button', { name: 'Retry status' }))
expect(retry).toHaveBeenCalledOnce()
```

- [ ] **Step 2: Run `pnpm exec vitest run packages/client/ui-desktop-control/tests/components.client.spec.tsx`; expect RED on the new summary, independent rows, and Retry control.**
- [ ] **Step 3: Implement six ordered regions: header summary, two capability rows, macOS permission rows, authorized applications, emergency Stop shortcut, and current-control row. Use existing Desktop tokens; add compact bordered rows, icon wells, status chips, responsive wrapping, forced-colors support, visible focus, and no horizontal scrolling.**
- [ ] **Step 4: Disable only the affected unsupported/pending switch. Render Available, Unavailable, Unknown, Enabled, and Not enabled as text plus icon; never rely on color. Keep Stop approval-free and show stopping state.**
- [ ] **Step 5: Expose `retry()` from the settings seat by reusing the zero-argument `getComputerControlStatus()` bridge call. Keep one in-flight retry and ignore duplicate clicks; rejected refresh keeps the last snapshot and sets the client-visible retry state supplied by main.**
- [ ] **Step 6: Add complete English and Chinese labels. Test keyboard names, failure/empty states, all capability combinations, active control, Stop, and a narrow container.**
- [ ] **Step 7: Run the component suite, client package typecheck, Desktop typecheck, scoped Oxlint, and `git diff --check`; expect PASS.**
- [ ] **Step 8: Commit with `feat(desktop): redesign control settings module`.**

### Task 4: Document and verify the macOS result

**Files:**
- Modify: `packages/client/ui-desktop-control/README.md`
- Modify: `packages/client/ui-desktop-control/README.zh.md`
- Update: `packages/client/ui-desktop-control/README.i18n.yaml`
- Create: `.agents/notes/implemented/feature/2026-08-28-desktop-control-settings-status.md`
- Create: `.agents/notes/implemented/feature/2026-08-28-desktop-control-settings-status.zh.md`
- Create: `.agents/notes/implemented/feature/2026-08-28-desktop-control-settings-status.i18n.yaml`
- Test: packaged macOS settings smoke and visual screenshot evidence

- [ ] **Step 1: Update the README pair with independent availability, enablement, refresh retention, and the exact renderer security exclusions. Add an implemented Agent Note explaining why aggregate support was removed and why main retains last-valid display state.**
- [ ] **Step 2: Re-record both bilingual pairs with `pnpm run verify-translation-pairing --write <english-path>` and run the scoped pairing checks.**
- [ ] **Step 3: Run focused tests, Desktop/client typechecks, scoped lint, `pnpm run constraints`, `pnpm run publint`, Agent Note format/classification, translation pairing, and `git diff --check`.**
- [ ] **Step 4: Build the Intel macOS app from the final candidate. Start with an isolated Desktop settings home and verify both installed adapters render Available · Not enabled, both granted permissions render independently, Retry does not collapse state, and enabling each capability still requires native confirmation. Capture the full module in light and dark appearance.**
- [ ] **Step 5: Install the verified app only after automated and packaged smoke checks pass. Confirm normal Harness chat still starts and the control module no longer shows the aggregate Unavailable state.**
- [ ] **Step 6: Commit documentation/evidence with `docs(desktop): record control settings status model`.**
