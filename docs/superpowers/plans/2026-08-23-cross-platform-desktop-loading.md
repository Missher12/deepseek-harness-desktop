# Cross-Platform Desktop Loading Implementation Plan

English | [中文](2026-08-23-cross-platform-desktop-loading.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Windows and macOS the same DeepSeek Harness startup and real plugin-progress presentation while leaving ordinary browser users on the generic Web boot page.

**Architecture:** Replace the platform-selected local HTML pair with one self-contained Desktop loading page. Generalize the Web kernel's `surface=desktop` detector so both native platforms receive the icon, light theme, linear progress, and truthful active/total count; retain platform differences only in Electron window chrome.

**Tech Stack:** Electron, framework-free HTML/CSS, TypeScript DOM, Vitest/jsdom.

---

### Task 1: Specify one native Desktop startup document

**Files:**
- Modify: `apps/desktop/tests/renderer-pages.spec.ts`
- Modify: `apps/desktop/renderer/loading.html`
- Delete: `apps/desktop/renderer/loading-macos.html`
- Modify: `apps/desktop/src/main.ts`

- [x] **Step 1: Write a failing shared-page test**

Replace the separate generic/macOS assertions with one test that reads `loading.html` and requires:

```ts ignore-check
expect(html).toContain('data-desktop-startup')
expect(html).toContain('data-desktop-local-progress')
expect(html).toContain('../assets/icon-source.png')
expect(html).toContain('正在准备你的工作区')
expect(html).toContain('启动本地服务')
expect(html).toContain('height: 5px')
expect(html).toContain('#4d6bfe')
expect(html).toContain('color-scheme: light')
expect(html).not.toMatch(/https?:\/\//u)
```

Also read `src/main.ts` and require it not to contain `loading-macos.html` or a `process.platform` branch around the local loading document.

- [x] **Step 2: Run the renderer test and verify RED**

Run: `pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts`

Expected: FAIL because Windows still receives the old generic document and `main.ts` selects a macOS-only file.

- [x] **Step 3: Make the polished document platform-neutral**

Move the complete contents of `loading-macos.html` into `loading.html`, rename `data-macos-startup` to `data-desktop-startup`, rename `data-macos-local-progress` to `data-desktop-local-progress`, and remove `loading-macos.html`.

Set the main-process path to one constant:

```ts ignore-check
const loadingPath = fileURLToPath(new URL('../renderer/loading.html', import.meta.url))
```

- [x] **Step 4: Run the renderer test and verify GREEN**

Run: `pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts apps/desktop/tests/main-lifecycle.spec.ts`

Expected: both files pass; startup concurrency and show timing remain unchanged.

### Task 2: Give both native platforms truthful plugin progress

**Files:**
- Modify: `packages/client/web/src/desktop-surface.ts`
- Modify: `packages/client/web/src/boot-page.ts`
- Modify: `packages/client/web/src/boot-page.module.css`
- Modify: `packages/client/web/src/DesktopBootSurface.tsx`
- Modify: `packages/client/web/tests/boot-page.client.spec.ts`
- Modify: `packages/client/web/tests/DesktopBootSurface.client.spec.tsx`
- Modify: `apps/desktop/tests/renderer-pages.spec.ts`

- [x] **Step 1: Write failing Windows Desktop boot assertions**

Define the expected detector behavior:

```ts ignore-check
expect(isDesktopSurface('?surface=desktop')).toBe(true)
expect(isDesktopSurface('')).toBe(false)
```

Mount `BootPage` with `{ search: '?surface=desktop' }` for a Windows-like environment and require `data-dsh-boot-desktop`, `data-dsh-boot-linear`, the Desktop icon, and a real `25%` after one of four entries activates. Keep a separate ordinary Web test that still requires `HARNESS` and the circular spinner.

- [x] **Step 2: Run the Web boot tests and verify RED**

Run: `pnpm exec vitest run packages/client/web/tests/boot-page.client.spec.ts packages/client/web/tests/DesktopBootSurface.client.spec.tsx`

Expected: FAIL because the current detector rejects Windows user agents and emits `data-dsh-boot-mac` only on macOS.

- [x] **Step 3: Generalize the explicit Desktop marker**

Implement the closed marker check:

```ts
export function isDesktopSurface(search: string): boolean {
  return new URLSearchParams(search).get('surface') === 'desktop'
}
```

In `BootPage`, replace `macDesktop` with `desktop`, use `data-dsh-boot-desktop`, and keep the existing icon, light background, linear progress, active/total count, percent, failure replacement, and ordinary Web fallback. Rename CSS selectors from `[data-dsh-boot-mac]` to `[data-dsh-boot-desktop]`; the class names may remain internal to minimize unrelated churn.

- [x] **Step 4: Run focused Web/Desktop tests and verify GREEN**

Run: `pnpm exec vitest run packages/client/web/tests/boot-page.client.spec.ts packages/client/web/tests/DesktopBootSurface.client.spec.tsx apps/desktop/tests/renderer-pages.spec.ts apps/desktop/tests/window-options.spec.ts`

Expected: native Windows and macOS share the Desktop surface, ordinary Web stays generic, and native frame behavior remains platform-specific.

- [x] **Step 5: Commit the independently testable loading change**

```bash
git add apps/desktop/renderer apps/desktop/src/main.ts apps/desktop/tests/renderer-pages.spec.ts packages/client/web/src packages/client/web/tests
git commit -m "fix(desktop): unify native loading surfaces"
```

### Task 3: Cross-surface regression verification

**Files:**
- Modify: `PROJECT_CONTEXT.md`

- [x] **Step 1: Run the complete focused regression set**

Run:

```bash
pnpm exec vitest run \
  packages/session/usage-insights/tests/aggregate.spec.ts \
  packages/client/ui-settings-usage/tests/charts.client.spec.ts \
  packages/client/ui-settings-usage/tests/components.client.spec.tsx \
  packages/client/ui-settings-usage/tests/styles.client.spec.ts \
  packages/client/web/tests/boot-page.client.spec.ts \
  packages/client/web/tests/DesktopBootSurface.client.spec.tsx \
  apps/desktop/tests/renderer-pages.spec.ts \
  apps/desktop/tests/main-lifecycle.spec.ts \
  apps/desktop/tests/window-options.spec.ts
```

Expected: every focused test passes.

- [x] **Step 2: Build production Host, Client, Web, and Desktop main**

Run: `pnpm run build:lib && pnpm run build:web && pnpm run build:desktop:main`

Expected: exit code 0 with no missing renderer asset or TypeScript error.

- [x] **Step 3: Record the current implementation boundary**

Update `PROJECT_CONTEXT.md` with the shared Desktop loading decision, Usage aggregate intensity behavior, tested platforms, and the fact that native Windows installer acceptance remains required before publishing a Windows asset.

- [x] **Step 4: Commit documentation and verification boundary**

```bash
git add PROJECT_CONTEXT.md docs/superpowers/plans/2026-08-23-*.md
git commit -m "docs: record shared desktop loading plan"
```
