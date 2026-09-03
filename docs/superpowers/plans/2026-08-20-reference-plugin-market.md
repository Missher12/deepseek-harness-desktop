# Reference-Style Plugin Market Implementation Plan

English | [中文](2026-08-20-reference-plugin-market.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Desktop Plugin Market's dense tabs and cards with the approved reference hierarchy while keeping real search, real categories, local personal plugins, and every existing lifecycle operation.

**Architecture:** The Settings shell widens only for section id `market`. Pure helpers in the pinned `dshmarket@1.10.1` source derive Featured/category previews and classify `file:`/`link:` personal plugins; `MarketSection` renders the new shell and routes maintenance actions into the existing views. The dependency patch, generated client bundle, repository tests, and packaged smoke remain synchronized.

**Tech Stack:** TypeScript, React 18, CSS Modules, Cordis settings slots, pnpm dependency patches, Vitest, Testing Library, Playwright/Electron packaged smoke.

---

### Task 1: Make Settings geometry adaptive for the market

**Files:**
- Modify: `packages/client/ui-settings-general/src/client/SettingsRoot.tsx`
- Modify: `packages/client/ui-settings-general/src/client/SettingsRoot.module.css`
- Test: `packages/client/ui-settings-general/tests/settings-root.client.spec.tsx`

- [ ] **Step 1: Write the failing shell test**

Add a `market` row, select it, and assert the dialog receives `data-settings-section="market"` while another section receives its own id. Assert the CSS contains the exact market width contract `min(1040px, calc(100vw - 48px))`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run packages/client/ui-settings-general/tests/settings-root.client.spec.tsx`

Expected: FAIL because the dialog exposes no active-section hook and has one fixed width.

- [ ] **Step 3: Implement the minimal shell hook**

Set `data-settings-section={active}` on the settings dialog and add:

```css
.panel[data-settings-section="market"] {
  width: min(1040px, calc(100vw - 48px));
}
```

Keep the existing 800-pixel width for every other section.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run packages/client/ui-settings-general/tests/settings-root.client.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the shell change**

```bash
git add packages/client/ui-settings-general/src/client/SettingsRoot.tsx packages/client/ui-settings-general/src/client/SettingsRoot.module.css packages/client/ui-settings-general/tests/settings-root.client.spec.tsx
git commit -m "feat(settings): widen the plugin market surface"
```

### Task 2: Define real catalog grouping and personal-plugin classification

**Files:**
- Modify through the pnpm patch workspace: `node_modules/dshmarket/src/client/market-data.ts`
- Modify through the pnpm patch workspace: `node_modules/dshmarket/src/client/MarketSection.tsx`
- Test: `scripts/dshmarket-client-layout.spec.ts`

- [ ] **Step 1: Write failing pure-helper tests**

Import the patched `market-data.ts` and assert these contracts:

```ts ignore-check
catalogSections(registry, visible, 6)
// Featured first; stable registry category order; no duplicate Featured entry;
// each preview <= 6; remainder is exact.

personalPluginNames({ local: 'link:/tmp/local', copied: 'file:/tmp/copied', public: '^1.2.3' })
// => ['local', 'copied']
```

Also preserve the existing search test across name, owner, and localized description.

- [ ] **Step 2: Run the layout test and verify RED**

Run: `pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts`

Expected: FAIL because the new helpers and semantic hooks do not exist.

- [ ] **Step 3: Implement the pure helpers**

Add exported `CatalogSection`, `catalogSections`, and `personalPluginNames` definitions. Featured sorts by descending stars with registry order as the stable tie-break, excludes deprecated plugins, and removes its entries from ordinary category previews. Personal classification accepts only specs beginning with `file:` or `link:`.

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run: `pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts`

Expected: helper assertions pass; presentation assertions may remain RED until Task 3.

### Task 3: Build the approved market hierarchy

**Files:**
- Modify through the pnpm patch workspace: `node_modules/dshmarket/src/client/MarketSection.tsx`
- Modify through the pnpm patch workspace: `node_modules/dshmarket/src/client/Market.module.css`
- Modify through the pnpm patch workspace: `node_modules/dshmarket/src/client/locales.ts`
- Regenerate: `node_modules/dshmarket/client/client.js`
- Regenerate: `node_modules/dshmarket/client/client.js.map`
- Modify: `patches/dshmarket@1.10.1.patch`
- Modify: `pnpm-lock.yaml`
- Test: `scripts/dshmarket-client-layout.spec.ts`
- Test: `scripts/dshmarket-client-artifact.spec.ts`

- [ ] **Step 1: Replace old semantic expectations with reference-layout expectations**

Require hooks for `data-dshmarket-layout="reference"`, full search, installed rail, management trigger, Public/Personal tabs, Featured and category sections, section remainder links, two-column grids, personal empty state, and one-column container fallback. Continue requiring the real Install action, overflow menu, self-protection, and maintenance callbacks.

- [ ] **Step 2: Run source and artifact tests and verify RED**

Run: `pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts`

Expected: FAIL against the old B2 layout.

- [ ] **Step 3: Implement the reference shell**

Render title/subtitle, a full-width search, installed icon rail with gear, Public/Personal mode row, and grouped section overview. Reuse the existing plugin avatar, detail dialog, Install confirmation, progress, overflow operations, filter menu, installed management, updates, activity, themes, backup, and recovery functions. The management trigger selects those legacy views without restoring the old primary tab bar.

- [ ] **Step 4: Implement responsive reference styling**

Use borderless 40-pixel-icon rows and `grid-template-columns: repeat(2, minmax(0, 1fr))`. Apply a container fallback to one column below 680 pixels, keep row actions aligned, hide horizontal overflow, and render a stable skeleton for the initial registry read.

- [ ] **Step 5: Build the package client and regenerate the pnpm patch**

Run the package's `build:client`, then run `pnpm patch-commit <absolute-edit-directory> --patches-dir patches`. Reinstall the lockfile so the new patch hash resolves everywhere. Do not hand-edit minified client output.

- [ ] **Step 6: Run the patch and staging gates**

Run: `pnpm exec vitest run scripts/dshmarket-baseline.spec.ts scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts scripts/dshmarket-self-protection.spec.ts scripts/stage-desktop.spec.ts`

Expected: PASS with the source, browser bundle, source map, exact npm integrity, one staged market, and self-protection intact.

- [ ] **Step 7: Commit the market change**

```bash
git add patches/dshmarket@1.10.1.patch pnpm-lock.yaml scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts
git commit -m "feat(market): adopt the reference plugin catalog"
```

### Task 4: Verify real browser geometry and behavior

**Files:**
- Modify: `apps/desktop/tests/packaged-smoke.ts`
- Modify: `apps/desktop/tests/manifest.spec.ts`
- Modify: `apps/desktop/tests/packaged-smoke-helpers.spec.ts` only if a helper contract changes

- [ ] **Step 1: Update the packaged smoke expectations**

Assert the real market exposes reference layout hooks, a functional search, installed icons, Public and Personal modes, Featured first, localized category sections, no overview duplicates, exact remainder counts, two columns at desktop width, and one column after narrowing. Keep the non-destructive self-protection and ordinary fixture-uninstall checks.

- [ ] **Step 2: Run source-level smoke tests and verify GREEN**

Run: `pnpm exec vitest run apps/desktop/tests/manifest.spec.ts apps/desktop/tests/packaged-smoke-helpers.spec.ts scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts`

Expected: PASS.

- [ ] **Step 3: Commit smoke coverage**

```bash
git add apps/desktop/tests/packaged-smoke.ts apps/desktop/tests/manifest.spec.ts apps/desktop/tests/packaged-smoke-helpers.spec.ts
git commit -m "test(desktop): cover the reference plugin market"
```

### Task 5: Document, verify, package, and install

**Files:**
- Modify: `PROJECT_CONTEXT.md`
- Build: `apps/desktop/release/mac/DeepSeek Harness.app`
- Capture: `apps/desktop/release/desktop-smoke-market-darwin.png`

- [ ] **Step 1: Record the completed behavior in project context**

Document the reference hierarchy, real search, real category sections, `file:`/`link:` Personal rule, preserved maintenance functions, and internal macOS-only boundary.

- [ ] **Step 2: Run verification gates**

Run focused market/shell tests, `pnpm run verify-translation-pairing`, `pnpm run typecheck`, and `pnpm run lint`.

Expected: every command exits 0.

- [ ] **Step 3: Build and run the isolated packaged smoke**

Run: `pnpm run desktop:pack`

Run: `pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts`

Expected: unsigned x86_64 `0.1.8` app builds, the real Electron smoke passes, and the market screenshot shows the reference layout without browser console errors.

- [ ] **Step 4: Back up and install**

Quit the running app, move the current `/Applications/DeepSeek Harness.app` to a timestamped directory under `~/Library/Application Support/DeepSeek Harness Backups`, copy the verified candidate into `/Applications`, compare the executable and `app.asar` bytes, then launch the installed path.

- [ ] **Step 5: Verify installed state**

Confirm x86_64 architecture, version `0.1.8`, the installed main process, the owned loopback Host process, the reference market artifact markers, and the preserved backup. Keep the branch local and do not upload GitHub.
