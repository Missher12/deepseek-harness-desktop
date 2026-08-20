# macOS Marketplace, Usage, and Startup Polish Implementation Plan

English | [中文](2026-08-19-macos-market-usage-startup-polish.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved DeepSeek-colored macOS startup transition, Usage skeleton and process-memory refresh, B2 marketplace row, and truthful DeepSeek cost/balance facts without changing unrelated Host behavior or Windows delivery.

**Architecture:** The Darwin native loading page owns the one-time intro while the existing runtime startup continues concurrently. The kernel-owned Web `AppRoot` renders a matching Desktop-only hold surface, mounts the settled application under its exit overlay, and removes the overlay through CSS without adding a second window or a plugin dependency. Usage owns one process-memory snapshot cache, while the pinned dshmarket patch changes only Client row presentation and regenerates its built artifacts. The existing durable token projection supplies an explicitly estimated session cost, while a capability-gated same-origin Host bridge exposes only validated balance facts from DeepSeek's documented endpoint.

**Tech Stack:** Electron, TypeScript, React, CSS Modules, HTML/CSS, pnpm dependency patches, Vitest, Testing Library, Playwright packaged smoke, bilingual Markdown.

---

### Task 1: Add the macOS startup intro and direct Web reveal

**Files:**
- Create: `apps/desktop/renderer/loading-macos.html`
- Create: `packages/client/web/src/DesktopBootSurface.tsx`
- Create: `packages/client/web/src/DesktopBootSurface.module.css`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/tests/renderer-pages.spec.ts`
- Modify: `packages/client/web/src/{AppRoot.tsx}`
- Modify: `packages/client/web/src/{AppRoot.module.css}`
- Modify: `packages/client/web/src/{boot.tsx}`
- Test: `packages/client/web/tests/{app-root.client.spec.tsx}`

- [ ] **Step 1: Write failing macOS renderer and kernel transition tests**

Require a self-contained Darwin renderer with the restrictive CSP, DeepSeek color markers, no remote URL, no fake progressbar, and reduced-motion CSS. Extend the `AppRoot` fixture with `macDesktop`; before settlement assert the Desktop hold surface is present and `renderApp` has not run, then flip `settled` and assert the real UI and an exit-phase overlay render together. Keep the existing generic Web assertions unchanged when `macDesktop` is false.

```tsx
expect(macosHtml).toContain('data-macos-startup')
expect(macosHtml).toContain('#4d6bfe')
expect(macosHtml).not.toContain('role="progressbar"')
expect(macosHtml).not.toMatch(/https?:\/\//u)

const bed = mount({ macDesktop: true })
expect(bed.container.querySelector('[data-desktop-boot-phase="hold"]')).not.toBeNull()
act(() => { bed.settled.set(true) })
expect(bed.getByTestId('real-ui')).toBeTruthy()
expect(bed.container.querySelector('[data-desktop-boot-phase="exit"]')).not.toBeNull()
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts packages/client/web/tests/{app-root.client.spec.tsx}`

Expected: FAIL because the Darwin page, Desktop boot component, and direct-reveal state do not exist.

- [ ] **Step 3: Implement the self-contained native intro**

Select `loading-macos.html` only when `process.platform === 'darwin'`; retain `loading.html` for every other platform. Build the intro from inline SVG/text and local CSS: near-black background, `#4d6bfe` primary blue, cold cyan highlight, white type, one scan, and a 900-millisecond assembly followed by an indefinite hold. Hide decorative layers from accessibility, keep truthful local-runtime text, and make reduced motion show the hold frame immediately.

```ts
import { fileURLToPath } from 'node:url'

const loadingPath = fileURLToPath(new URL(
  process.platform === 'darwin' ? '../renderer/loading-macos.html' : '../renderer/loading.html',
  import.meta.url,
))
```

- [ ] **Step 4: Implement the kernel hold and exit surface**

Add a self-contained `DesktopBootSurface` with `phase: 'hold' | 'exit'`, failed entry IDs, and bounded boot error text. `boot.tsx` identifies the Mac Desktop only when `surface=desktop` and the browser user agent is macOS, then passes `macDesktop` into `AppRoot`. `AppRoot` calls `renderApp()` only after settlement; on Mac it keeps the overlay above the real UI and changes its phase to `exit`, whose 240–320 millisecond animation ends with `visibility: hidden` and `pointer-events: none`. Generic Web and Windows behavior remains the existing spinner and one-pass switch.

```tsx
if (props.macDesktop) {
  return (
    <div className={css.desktopRoot}>
      {settled ? props.renderApp() : null}
      <DesktopBootSurface phase={settled ? 'exit' : 'hold'} failed={failed} error={error} />
    </div>
  )
}
```

- [ ] **Step 5: Run startup tests and commit**

Run: `pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts apps/desktop/tests/main-lifecycle.spec.ts packages/client/web/tests/{app-root.client.spec.tsx} apps/web/tests/settings-chrome.e2e.ts`

Expected: PASS; the existing lifecycle still overlaps the loading page with conflict detection and runtime startup.

Commit: `git add apps/desktop packages/client/web && git commit -m "feat(desktop): add macOS startup reveal"`

### Task 2: Replace Usage loading text with a structural skeleton and cached refresh

**Files:**
- Create: `packages/client/ui-settings-usage/src/client/snapshot-cache.ts`
- Modify: `packages/client/ui-settings-usage/src/client/UsageInsightsSection.tsx`
- Modify: `packages/client/ui-settings-usage/src/client/UsageInsightsSection.module.css`
- Modify: `packages/client/ui-settings-usage/src/client/locales.ts`
- Test: `packages/client/ui-settings-usage/tests/components.client.spec.tsx`
- Test: `packages/client/ui-settings-usage/tests/styles.client.spec.ts`
- Test: `packages/client/ui-settings-usage/tests/browser-usage.client.spec.tsx`

- [ ] **Step 1: Write failing skeleton and refresh-retention tests**

Reset the internal cache after each test. Assert the first unresolved request shows one busy structural skeleton with no localized loading sentence or fake numeric value. After one successful mount, unmount and remount with a pending request; assert the last snapshot renders immediately. Reject that refresh and assert the snapshot remains visible with localized stale status and Retry. Resolve a later retry and assert the fresh value replaces it.

```tsx
expect(view.container.querySelector('[data-usage-skeleton]')?.getAttribute('aria-busy')).toBe('true')
expect(screen.queryByText(en.loading)).toBeNull()
expect(view.container.textContent).not.toContain('0')

first.unmount()
render(<UsageInsightsSection {...props(() => refresh.promise)} />)
expect(screen.getByText('96.5K')).toBeTruthy()
await act(async () => { refresh.reject(new Error('offline')) })
expect(screen.getByText('96.5K')).toBeTruthy()
expect(screen.getByRole('status').textContent).toBe(en.refreshFailed)
```

- [ ] **Step 2: Run Usage tests and confirm RED**

Run: `pnpm exec vitest run packages/client/ui-settings-usage/tests/components.client.spec.tsx packages/client/ui-settings-usage/tests/styles.client.spec.ts`

Expected: FAIL because the component still renders `loading` text and discards the visible snapshot on retry failure.

- [ ] **Step 3: Add the process-memory snapshot owner**

Implement a module-private `UsageInsightsSnapshot | undefined` with internal read, write, and test-reset functions. Initialize `ViewState` from that cache. Every mount still calls `load()` once; successful reads atomically update state and the cache. Failed reads use a functional state update: retain a ready snapshot with `refresh: 'failed'`, or enter the existing first-load error state when no snapshot exists. Retry changes only refresh state when a snapshot is visible.

```ts
type UsageInsightsSnapshot = Readonly<Record<string, unknown>>

let lastSnapshot: UsageInsightsSnapshot | undefined

export function readUsageSnapshot(): UsageInsightsSnapshot | undefined { return lastSnapshot }
export function writeUsageSnapshot(snapshot: UsageInsightsSnapshot): void { lastSnapshot = snapshot }
export function resetUsageSnapshotForTest(): void { lastSnapshot = undefined }
```

- [ ] **Step 4: Implement the final-geometry skeleton and localized stale state**

Render five blank KPI cells, a 53×7 neutral activity field, and two detail-column placeholder groups under `aria-busy="true"`. Use Harness skeleton and business-primary tokens, reserve final dimensions, and run a subtle shimmer only when motion is allowed. Add `refreshFailed` in English and Chinese. Keep the cached dashboard interactive while the bounded stale status and Retry appear above it.

```tsx
if (state.status === 'loading') return <UsageSkeleton />

{state.refresh === 'failed' ? (
  <div className={css.refreshFailure} role="status">
    <span>{t('refreshFailed')}</span>
    <button type="button" onClick={retry}>{t('retry')}</button>
  </div>
) : null}
```

- [ ] **Step 5: Run Usage component and browser tests and commit**

Run: `pnpm exec vitest run packages/client/ui-settings-usage/tests`

Expected: PASS for first load, cached revisit, refresh success/failure, chart behavior, narrow layout, and style tokens.

Commit: `git add packages/client/ui-settings-usage && git commit -m "feat(usage): add skeleton and cached refresh"`

### Task 3: Finish the B2 high-density marketplace row

**Files:**
- Modify through pnpm patch workspace: `node_modules/dshmarket/src/client/MarketSection.tsx`
- Modify through pnpm patch workspace: `node_modules/dshmarket/src/client/Market.module.css`
- Modify generated patch workspace: `node_modules/dshmarket/client/client.js`
- Modify generated patch workspace: `node_modules/dshmarket/client/client.js.map`
- Modify: `patches/dshmarket@1.10.1.patch`
- Modify: `scripts/dshmarket-client-layout.spec.ts`
- Modify: `scripts/dshmarket-client-artifact.spec.ts`

- [ ] **Step 1: Write failing B2 source and artifact tests**

Require a 42-pixel image, inline category chip beside the name, one-line description, separate metadata line, DeepSeek-primary compact action region, icon-only `IconEllipsisOutline16` overflow control with a plugin-specific accessible label, first-row alignment for title/category/action/overflow at narrow widths, and the same semantic markers in source, bundle, and source map.

```ts ignore-check
for (const artifact of [source, bundle, sourceMap]) {
  expect(artifact).toContain('data-dshmarket-layout="b2"')
  expect(artifact).toContain('data-dshmarket-plugin-category')
  expect(artifact).toContain('data-dshmarket-plugin-description')
}
expect(css).toMatch(/\.av\{width:42px;height:42px/)
expect(source).toContain('IconEllipsisOutline16')
```

- [ ] **Step 2: Run market tests and confirm RED**

Run: `pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts`

Expected: FAIL because the current row uses a 40-pixel image, a two-line description, a category below the description, and a text `More` button.

- [ ] **Step 3: Edit the exact pinned upstream source and rebuild Client artifacts**

Use an exact upstream `dshmarket@1.10.1` checkout or pnpm patch edit directory. Preserve Host routes and operation semantics. Import `IconEllipsisOutline16`, place the category chip in the title row, keep owner/stars/date in the metadata row, clamp the description to one line, keep Install and overflow aligned with that title row at narrow widths, use a 42-pixel rounded image with deterministic fallback, and give the icon-only overflow trigger `aria-label={`${t('moreActions')}: ${p.name}`}`. Use existing `--dsw-alias-*` tokens for DeepSeek primary and dark mode.

```tsx
<div className={css.pluginTitleRow}>
  <div className={css.nm}>{p.name}</div>
  <span className={css.tag} data-dshmarket-plugin-category>{categoryLabel}</span>
</div>
<div className={css.owner}>{metadata}</div>
<div className={css.desc} data-dshmarket-plugin-description>{desc}</div>
```

- [ ] **Step 4: Regenerate the pnpm patch without hand-editing minified output**

Run the package's Client build in the exact upstream checkout, copy `src/client/MarketSection.tsx`, `src/client/Market.module.css`, `client/client.js`, and `client/client.js.map` into the pnpm edit directory, then run `pnpm patch-commit <absolute-pnpm-edit-directory> --patches-dir patches`. Reinstall with the lockfile and confirm the exact upstream tarball integrity remains unchanged while the patch hash updates.

Run: `pnpm install --frozen-lockfile`

Expected: the installed Desktop dependency contains B2 source and matching generated artifacts.

- [ ] **Step 5: Run market, staging, and self-protection tests and commit**

Run: `pnpm exec vitest run scripts/dshmarket-baseline.spec.ts scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts scripts/dshmarket-self-protection.spec.ts scripts/stage-desktop.spec.ts`

Expected: PASS; source/bundle/map agree, exactly one marketplace is staged, and self-update, self-disable, and self-removal remain refused.

Commit: `git add patches/dshmarket@1.10.1.patch pnpm-lock.yaml scripts && git commit -m "feat(market): refine the B2 plugin row"`

### Task 4: Add official session-cost estimation and exact account balance

**Files:**
- Create: `packages/client/ui-conversation/src/client/chat/usage-money.ts`
- Modify: `packages/client/ui-conversation/src/client/chat/StatsLine.tsx`
- Modify: `packages/client/ui-conversation/src/client/locales.ts`
- Test: `packages/client/ui-conversation/tests/usage-money.client.spec.ts`
- Test: `packages/client/ui-conversation/tests/chat-stats.client.spec.tsx`
- Create: `packages/llm/llm-deepseek/src/balance.ts`
- Modify: `packages/llm/llm-deepseek/src/index.ts`
- Test: `packages/llm/llm-deepseek/tests/balance.spec.ts`

- [ ] **Step 1: Write failing official-price and mixed-model tests**

Assert current official CNY prices with no time-of-day tier, cache writes billed as cache misses, compact formatting, and no estimate for unknown or mixed models. Require a durable billing-route projection that returns one model only when all billed usage records across the complete log agree.

```ts ignore-check
expect(priceOfModel('deepseek-v4-flash')).toEqual({ cacheHit: 0.02, cacheMiss: 1, output: 2 })
expect(priceOfModel('deepseek-v4-pro')).toEqual({ cacheHit: 0.025, cacheMiss: 3, output: 6 })
expect(projectedBillingModel([flashUsage, proUsage])).toEqual({ kind: 'mixed' })
expect(sessionCostCny(usage, undefined)).toBeNull()
```

- [ ] **Step 2: Run the Client money tests and confirm RED**

Run: `pnpm exec vitest run packages/client/ui-conversation/tests/usage-money.client.spec.ts packages/client/ui-conversation/tests/chat-stats.client.spec.tsx`

Expected: FAIL because the current draft still uses obsolete peak/off-peak prices and prices the whole session with the last model.

- [ ] **Step 3: Implement the minimal truthful Client projection**

Replace the tier table with one immutable official-price table. Remove clock inputs and peak-hour helpers. Fold billed provider/model route metadata into the durable `tokenBillingModel` whole-log projection; return one route only when every observed billed record agrees. Append localized `This session est. ≈ ¥{cost}` only for non-zero billable usage and a known single model. Fetch balance through the optional bridge once on mount and every 60 seconds; show the exact returned currency/total only on success, while missing bridges and failures remain silent.

```ts
const V4_PRICES = {
  'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 },
  'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3, output: 6 },
} as const
```

- [ ] **Step 4: Write failing Host balance-bridge tests**

Cover CNY preference, USD fallback, malformed and unavailable payloads, GET/HEAD behavior, 403 for absent or wrong capability, 405 for mutations, 60-second success cache, concurrent request coalescing, 10-second timeout, disposal, HTML injection escaping, and no mount when `webServer` is absent. Tests must use placeholder credentials and never print a real value.

```ts ignore-check
expect(parseDeepSeekBalance(providerBody, 100)).toMatchObject({ currency: 'CNY', totalBalance: 110 })
expect(await requestWithoutCapability()).toMatchObject({ status: 403 })
expect(providerFetch).toHaveBeenCalledTimes(1)
```

- [ ] **Step 5: Implement and verify the capability-gated balance bridge**

Mount one exact same-origin route only when `webServer` exists. Reuse `resolveApiKey`, keep the random capability generation-bound and header-only, validate finite non-negative provider strings, use constant-time capability comparison, cache successful snapshots for 60 seconds, coalesce in-flight reads, abort after 10 seconds, and unregister the route and HTML tap through the Cordis effect.

Run: `pnpm exec vitest run packages/llm/llm-deepseek/tests/balance.spec.ts packages/client/ui-conversation/tests/usage-money.client.spec.ts packages/client/ui-conversation/tests/chat-stats.client.spec.tsx`

Expected: PASS with no secret value in snapshots, errors, or test output.

### Task 5: Record the shipped decision and current project state

**Files:**
- Create: `.agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.md`
- Create: `.agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.zh.md`
- Create: `.agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.i18n.yaml`
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `apps/desktop/README.i18n.yaml`
- Modify: `packages/client/ui-settings-usage/README.md`
- Modify: `packages/client/ui-settings-usage/README.zh.md`
- Modify: `packages/client/ui-settings-usage/README.i18n.yaml`
- Modify: `PROJECT_CONTEXT.md`

- [ ] **Step 1: Write the implemented Agent Note pair**

Record the present-tense decision: one native window, Darwin-only intro selection, kernel-owned direct reveal, truthful failure behavior, process-memory Usage snapshot, and Client-only B2 presentation. Include the rejected alternatives of a second splash window, fixed fake progress, persistent browser Usage data, and modifying marketplace Host behavior, plus the cost of a small visual exit interval without a cold-start speed claim.

- [ ] **Step 2: Update the owning bilingual READMEs and project context**

Document the macOS startup sequence in the Desktop README and first-load/cached-refresh states in the Usage README. Update `PROJECT_CONTEXT.md` with current files, scope, completed tests, and the explicit Windows exclusion. Preserve existing history and unrelated progress entries.

- [ ] **Step 3: Record and verify every bilingual pair**

Run: `pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.md apps/desktop/README.md packages/client/ui-settings-usage/README.md`

Run: `pnpm run verify-agent-note-format && pnpm run verify-translation-pairing .agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.md apps/desktop/README.md packages/client/ui-settings-usage/README.md`

Expected: all three pairs are structurally consistent and current.

- [ ] **Step 4: Commit documentation**

Commit: `git add .agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.md .agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.zh.md .agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.i18n.yaml apps/desktop/README.md apps/desktop/README.zh.md apps/desktop/README.i18n.yaml packages/client/ui-settings-usage/README.md packages/client/ui-settings-usage/README.zh.md packages/client/ui-settings-usage/README.i18n.yaml PROJECT_CONTEXT.md && git commit -m "docs: record macOS UI polish"`

### Task 6: Run macOS release-shaped verification

**Files:**
- Modify if required by acceptance coverage: `apps/desktop/tests/packaged-smoke.ts`
- Modify if required by acceptance coverage: `apps/desktop/tests/packaged-smoke.spec.ts`

- [ ] **Step 1: Run all focused source tests together**

Run: `pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts apps/desktop/tests/main-lifecycle.spec.ts apps/desktop/tests/readiness.spec.ts packages/client/web/tests/{app-root.client.spec.tsx} packages/client/ui-settings-usage/tests scripts/dshmarket-baseline.spec.ts scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts scripts/dshmarket-self-protection.spec.ts scripts/stage-desktop.spec.ts packages/extensions/session-messenger/tests`

Expected: PASS with no regression in cross-Session messaging, startup ownership, Usage aggregation presentation, or marketplace protections.

- [ ] **Step 2: Run build, type, lint, and documentation gates**

Run: `pnpm run build && pnpm run build:desktop:main && pnpm run typecheck && pnpm run lint && pnpm run doc-sync && git diff --check`

Expected: every command exits 0 and no generated or vendor file is accidentally dirty.

- [ ] **Step 3: Stage and package the Intel macOS application**

Run: `pnpm run desktop:pack`

Expected: Electron Builder produces an unsigned x64 macOS `.app` directory whose resources contain the Darwin loading page, current Web bundle, Usage package, and the single patched dshmarket package.

- [ ] **Step 4: Run isolated packaged smoke and visual acceptance**

Run: `pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts`

Expected: an isolated `DSH_HOME` proves one native window, one owned Harness process tree, random loopback origin, direct startup-to-app transition, Usage first-load and revisit behavior, B2 marketplace geometry, cross-Session messaging availability, clean quit, and no console errors. Capture startup, Usage, and Marketplace screenshots for manual geometry review without clicking destructive controls.

- [ ] **Step 5: Inspect the final diff and commit any acceptance-only test change**

Run: `git status --short && git diff --check && git log --oneline origin/main..HEAD`

Expected: only the documented macOS startup, Usage, marketplace, tests, and prose files differ; no Windows workflow, installer, artifact, credential, live Session, or application installation changed.

Commit when Task 5 changed tests: `git add apps/desktop/tests && git commit -m "test(desktop): cover macOS UI polish"`
