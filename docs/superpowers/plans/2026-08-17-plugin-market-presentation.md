# Plugin Marketplace Presentation Implementation Plan

English | [中文](2026-08-17-plugin-market-presentation.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing marketplace card grid with a compact Harness-native list while preserving the pinned `dshmarket@1.10.1` package identity and all ordinary package operations.

**Architecture:** Keep the npm dependency, Loader id, Settings id, Host routes, and package runner in place. A pnpm `patchedDependencies` patch changes the upstream Client source and generated bundle, plus one Host guard that rejects update attempts targeting `dshmarket` itself. Stable data attributes and source-map content checks prove that the staged and packaged artifact contains the audited patch without relying on CSS-module hashes.

**Tech Stack:** pnpm patched dependencies, `dshmarket@1.10.1`, TypeScript, React 18, Harness UI primitives and design tokens, tsdown/lightningcss, Vitest, Playwright/Electron smoke.

---

### Task 1: Lock and verify the exact upstream baseline

**Files:**
- Create: `scripts/dshmarket-baseline.spec.ts`
- Create: `scripts/fixtures/dshmarket-1.10.1-baseline.json`
- Modify: `PROJECT_CONTEXT.md`

- [ ] **Step 1: Write the failing provenance test**

Resolve `dshmarket/package.json` from the Desktop importer and assert version `1.10.1`, read the npm integrity `sha512-8AWM8RT2tttJsozTBm6mAfI+cNpCIbeBdP9IoydJdHlH/+x72aNqmv3AWdbNfKDDwkkqM2Ce/XRDhha9HG0Q5Q==` from `pnpm-lock.yaml`, assert the recorded upstream git head `6970a6f801108c04234eb953ff0f707feffa621a`, and verify Loader name `dsh-market` plus Settings id `market` from source.

```ts
import { expect } from 'vitest'

declare const manifest: { name: string, version: string }
declare const clientSource: string

expect(manifest).toMatchObject({ name: 'dshmarket', version: '1.10.1' })
expect(clientSource).toContain("export const name = 'dsh-market'")
expect(clientSource).toContain("id: 'market'")
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm exec vitest run scripts/dshmarket-baseline.spec.ts`

Expected: FAIL because the recorded baseline fixture is missing.

- [ ] **Step 3: Record source hashes without using bundle CSS hashes**

The fixture records package identity and SHA-256 for `src/routes.ts`, `src/client/MarketSection.tsx`, `src/client/Market.module.css`, and `src/client/index.ts`. Do not assert the generated CSS module prefix because the upstream build includes the absolute source path in lightningcss hashing.

- [ ] **Step 4: Run the baseline test**

Run: `pnpm exec vitest run scripts/dshmarket-baseline.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the provenance lock**

```bash
git add scripts/dshmarket-baseline.spec.ts scripts/fixtures/dshmarket-1.10.1-baseline.json PROJECT_CONTEXT.md
git commit -m "test: lock marketplace patch baseline"
```

### Task 2: Convert Discover to a compact Harness list

**Files:**
- Patch source: `node_modules/dshmarket/src/client/MarketSection.tsx`
- Patch source: `node_modules/dshmarket/src/client/Market.module.css`
- Patch source if copy changes: `node_modules/dshmarket/src/client/locales.ts`
- Create: `scripts/dshmarket-client-layout.spec.ts`

- [ ] **Step 1: Write failing semantic layout tests**

Assert the source contains `data-dshmarket-layout="compact"` and `data-dshmarket-plugin-row`, keeps the existing installation/update/confirmation callbacks, renders one primary action, and moves source/details/copy package into one overflow menu. Assert the CSS uses a one-column list, 40-pixel icon, two-line clamp, sticky toolbar, horizontal categories, and `--dsw-*` colors.

```ts
import { expect } from 'vitest'

declare const source: string
declare const css: string

expect(source).toContain('data-dshmarket-layout="compact"')
expect(source).toContain('data-dshmarket-plugin-row')
expect(css).toContain('grid-template-columns:1fr')
expect(css).toContain('-webkit-line-clamp:2')
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts`

Expected: FAIL on missing compact markers.

- [ ] **Step 3: Refactor presentation only**

Change the Discover renderer into `PluginRow` while retaining the same marketplace data, action callbacks, pagination, confirmation dialogs, themes, installed/groups/backup flows, and error handling. Use the existing `Menu`, `Tooltip`, `Button`, `SearchInput`, and `Toast` primitives. Keep exactly one primary action per row.

```tsx
<div className={s.pluginRow} data-dshmarket-plugin-row data-package={plugin.package}>
  <img className={s.pluginIcon} width={40} height={40} alt="" />
  <div className={s.pluginCopy}>...</div>
  <div className={s.pluginAction}>{primaryAction}</div>
  <Menu>{overflowActions}</Menu>
</div>
```

- [ ] **Step 4: Make the toolbar stable and Harness-native**

Keep title/refresh, segmented `Discover / Installed / Updates / Activity`, search/filter, and one horizontally scrollable category row in a sticky region. Use token-backed borders, backgrounds, labels, brand, success, warning, and error states; use text plus icons for state.

- [ ] **Step 5: Run upstream and semantic tests**

From the temporary upstream checkout at git head `6970a6f801108c04234eb953ff0f707feffa621a`, run `npm test -- tests/client/market-section.client.spec.tsx tests/client/primitives-guard.spec.ts`.

Then run: `pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts`

Expected: all tests PASS.

- [ ] **Step 6: Commit the source-side work only after the pnpm patch exists in Task 4**

Do not commit edits under `node_modules`; Task 4 captures them in `patches/dshmarket@1.10.1.patch`.

### Task 3: Enforce active-market self-protection in the Host

**Files:**
- Patch source: `node_modules/dshmarket/src/routes.ts`
- Patch generated Host: `node_modules/dshmarket/lib/routes.js`
- Create: `scripts/dshmarket-self-protection.spec.ts`

- [ ] **Step 1: Write the failing route guard test**

Invoke the update route with `package: 'dshmarket'` and assert a stable 409-style rejection occurs before the runner is called. Re-run existing disable/remove self-protection cases and one ordinary package update success.

```ts
import { expect } from 'vitest'

declare function update(input: { package: string }): Promise<{ ok: boolean, code?: string }>
declare const runPlugin: (...args: unknown[]) => unknown

expect(await update({ package: 'dshmarket' })).toMatchObject({ ok: false, code: 'self-protected' })
expect(runPlugin).not.toHaveBeenCalled()
expect(await update({ package: 'dsh-reasoning-effort' })).toMatchObject({ ok: true })
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm exec vitest run scripts/dshmarket-self-protection.spec.ts`

Expected: FAIL because upstream update permits its own package.

- [ ] **Step 3: Add the narrow update rejection**

Reuse the exact package-name normalization already used by disable/remove protection. Reject only the active market package before any package runner or filesystem operation. Do not modify the permission, source, install, rollback, backup, or ordinary update routes.

- [ ] **Step 4: Build Host output and run behavior tests**

From the temporary upstream checkout, run `npm run typecheck && npm test && npm run build`.

Then run: `pnpm exec vitest run scripts/dshmarket-self-protection.spec.ts`

Expected: all tests PASS.

### Task 4: Generate and lock the pnpm dependency patch

**Files:**
- Create: `patches/dshmarket@1.10.1.patch`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Create: `scripts/dshmarket-client-artifact.spec.ts`

- [ ] **Step 1: Rebuild the real Client artifact**

In the exact upstream checkout, run `npm run build:client && node scripts/preflight.mjs`. Copy the modified source plus generated `client/client.js` and `client/client.js.map` into the pnpm patch edit directory. Do not reuse the Git-tag bundle or hand-edit minified output.

- [ ] **Step 2: Commit the patch through pnpm**

Run: `pnpm patch-commit <absolute-pnpm-edit-directory> --patches-dir patches`

Expected: `pnpm-workspace.yaml` gains `dshmarket@1.10.1: patches/dshmarket@1.10.1.patch`, and the lockfile dependency snapshot gains a `patch_hash` while retaining the original tarball integrity.

- [ ] **Step 3: Add artifact coherence tests**

Resolve the real Desktop package and assert source, `client.js`, and `client.js.map` `sourcesContent` all contain the compact layout marker. Assert `lib/routes.js` contains the self-protection marker. Do not inspect hashed class names.

```ts
import { expect } from 'vitest'

declare const source: string
declare const bundle: string
declare const sourceMap: string
declare const hostBundle: string

for (const text of [source, bundle, sourceMap]) {
  expect(text).toContain('data-dshmarket-layout')
}
expect(hostBundle).toContain('self-protected')
```

- [ ] **Step 4: Reinstall from the lock and run artifact tests**

Run: `pnpm install --frozen-lockfile && pnpm exec vitest run scripts/dshmarket-baseline.spec.ts scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-self-protection.spec.ts scripts/dshmarket-client-artifact.spec.ts`

Expected: PASS; `apps/desktop/node_modules/dshmarket/client/client.js` contains the stable marker.

- [ ] **Step 5: Commit the audited patch**

```bash
git add patches/dshmarket@1.10.1.patch pnpm-workspace.yaml pnpm-lock.yaml scripts/dshmarket-*.spec.ts
git commit -m "feat: restyle the desktop plugin marketplace"
```

### Task 5: Prove staging, visual behavior, and update safety

**Files:**
- Modify: `scripts/stage-desktop.ts`
- Modify: `scripts/stage-desktop.spec.ts`
- Modify: `apps/desktop/tests/packaged-smoke.ts`
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `apps/desktop/README.i18n.yaml`
- Modify: `PROJECT_CONTEXT.md`
- Create: `.agents/notes/proposed/feature/2026-08-17-harness-native-plugin-market.md`
- Create: `.agents/notes/proposed/feature/2026-08-17-harness-native-plugin-market.zh.md`
- Create: `.agents/notes/proposed/feature/2026-08-17-harness-native-plugin-market.i18n.yaml`

- [ ] **Step 1: Add failing stage assertions**

Require the compact marker in staged `client/client.js`, matching marker in its source map, exact version `1.10.1`, and Host self-protection marker. Assert the stage contains one and only one `dshmarket` package.

- [ ] **Step 2: Run stage tests and confirm RED**

Run: `pnpm exec vitest run scripts/stage-desktop.spec.ts apps/desktop/tests/manifest.spec.ts`

Expected: FAIL until staging performs the semantic checks.

- [ ] **Step 3: Extend staging and packaged smoke**

Fail staging when the dependency is unpatched or source/bundle/map disagree. In packaged smoke, open Settings → Plugin Market and verify the compact root marker, Discover/Installed/Updates/Activity switching, search, horizontal categories, one primary row action, and no console errors. Verify a direct self-update request is rejected and an ordinary fixture package operation still reaches the existing runner.

- [ ] **Step 4: Run build and repository gates**

Run: `pnpm run build && pnpm exec vitest run scripts/dshmarket-*.spec.ts scripts/stage-desktop.spec.ts apps/desktop/tests/manifest.spec.ts && pnpm run typecheck && pnpm run lint && pnpm run doc-sync && git diff --check`

Expected: every command exits `0`.

- [ ] **Step 5: Complete real Mac visual acceptance**

Build the staged Intel app, open the real marketplace at approximately 564 pixels content width, and capture Discover, Installed, Updates, and Activity in light/dark themes and at 200% zoom. Verify rows do not overflow, descriptions clamp to two lines, categories scroll horizontally, dialogs and operations retain upstream behavior, and the browser console stays clean.

- [ ] **Step 6: Commit acceptance wiring and documentation**

```bash
git add scripts/stage-desktop.ts scripts/stage-desktop.spec.ts apps/desktop/tests/packaged-smoke.ts apps/desktop/README* PROJECT_CONTEXT.md .agents/notes/proposed/feature/2026-08-17-harness-native-plugin-market*
git commit -m "test: verify Harness-native plugin market"
```
