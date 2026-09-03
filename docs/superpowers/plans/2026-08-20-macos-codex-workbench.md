# Intel Mac Codex-style Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a removable Intel Mac workbench opened by one button beside `Session log`, with Terminal, Browser, Files, Side Chat, Review, stable DeepSeek Harness branding, and bounded reasoning typewriter motion.

**Architecture:** Add a generic optional utility column to `ui-layout`, then mount one Desktop-only Host/Client extension into it. Files, Review, Terminal, and Side Chat remain Host-backed and workspace/session scoped; only the isolated Browser `WebContentsView` crosses the Electron preload boundary.

**Tech Stack:** TypeScript, React 18, Cordis Host/Client plugins, Node streams and PTY subprocess service, Electron 43 `WebContentsView`, CSS Modules, Vitest/jsdom, Playwright packaged smoke, electron-builder, macOS `hdiutil`.

English | [中文](2026-08-20-macos-codex-workbench.zh.md)

---

### Task 1: Lock the product name to DeepSeek Harness

**Files:**
- Modify: `packages/client/ui-renderer/src/client/DocumentTitle.tsx`
- Modify: `packages/client/ui-renderer/tests/document-title.client.spec.tsx`
- Modify: `packages/client/ui-sidebar/src/client/SidebarRoot.tsx`
- Modify: `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx`
- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: Write failing fallback tests**

```text
expect(document.title).toBe('DeepSeek Harness')
expect(view.getByText('DeepSeek Harness')).toBeTruthy()
expect(document.title).toBe('Session title — DeepSeek Harness')
```

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm exec vitest run packages/client/ui-renderer/tests/document-title.client.spec.tsx packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx --config vitest.config.ts
```

Expected: the fallback assertions receive `DSH Local Build`.

- [ ] **Step 3: Replace the three generic fallbacks**

```text
const DEFAULT_CLIENT_TITLE = 'DeepSeek Harness'
```

Retain official-brand overrides and the session-title suffix.

- [ ] **Step 4: Re-run Step 2 and verify GREEN**

Expected: both files pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/vite.config.ts packages/client/ui-renderer packages/client/ui-sidebar
git commit -m "fix(client): keep DeepSeek Harness branding"
```

### Task 2: Add a generic utility column

**Files:**
- Modify: `packages/client/ui-layout/src/client/index.ts`
- Modify: `packages/client/ui-layout/src/client/service.ts`
- Modify: `packages/client/ui-layout/src/client/stores.ts`
- Modify: `packages/client/ui-layout/src/client/columns.ts`
- Modify: `packages/client/ui-layout/src/client/AppFrame.tsx`
- Modify: `packages/client/ui-layout/src/client/AppFrame.module.css`
- Modify: `packages/client/ui-layout/tests/apply.client.spec.ts`
- Modify: `packages/client/ui-layout/tests/service.client.spec.ts`
- Modify: `packages/client/ui-layout/tests/layout-store.client.spec.ts`
- Modify: `packages/client/ui-layout/tests/app-frame.client.spec.tsx`

- [ ] **Step 1: Write failing controller and geometry tests**

```text
expect(layout.snapshot()).toMatchObject({ utilityOpen: false, utilityMode: 'terminal', utilityWidth: 420 })
layout.openUtility('browser')
expect(layout.snapshot()).toMatchObject({ utilityOpen: true, utilityMode: 'browser', details: 0 })
layout.openDetails()
expect(layout.snapshot().utilityOpen).toBe(false)
```

Also require `layout.utility`, a 320–720 width clamp, a right-side resize handle, and `data-utility-drawer` below the narrow breakpoint.

- [ ] **Step 2: Run layout tests and verify RED**

```bash
pnpm exec vitest run packages/client/ui-layout/tests --config vitest.config.ts
```

- [ ] **Step 3: Implement the closed API and store**

```text
export const UTILITY_MODES = ['terminal', 'browser', 'files', 'side-chat', 'review'] as const
export type UtilityMode = typeof UTILITY_MODES[number]
```

Add `openUtility`, `closeUtility`, `toggleUtility`, and `setUtilityWidth` to `ILayout`. Opening utility closes details; opening details closes utility. Wide layout becomes `sidebar | center | details | utility`; narrow layout renders utility as a fixed right drawer. Closing preserves width, Escape restores trigger focus, and reduced motion removes transitions.

- [ ] **Step 4: Re-run Step 2 and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-layout
git commit -m "feat(layout): add optional utility panel"
```

### Task 3: Mount the Desktop workbench shell

**Files:**
- Create: `packages/extensions/desktop-workbench/package.json`
- Create: `packages/extensions/desktop-workbench/tsconfig.json`
- Create: `packages/extensions/desktop-workbench/tsconfig.host.json`
- Create: `packages/extensions/desktop-workbench/tsconfig.client.json`
- Create: `packages/extensions/desktop-workbench/tsdown.config.ts`
- Create: `packages/extensions/desktop-workbench/cordis.patch.yml`
- Create: `packages/extensions/desktop-workbench/src/index.ts`
- Create: `packages/extensions/desktop-workbench/src/invariant.ts`
- Create: `packages/extensions/desktop-workbench/src/client/index.tsx`
- Create: `packages/extensions/desktop-workbench/src/client/WorkbenchPanel.tsx`
- Create: `packages/extensions/desktop-workbench/src/client/WorkbenchPanel.module.css`
- Create: `packages/extensions/desktop-workbench/src/client/HeaderButton.tsx`
- Create: `packages/extensions/desktop-workbench/src/client/locales.ts`
- Create: `packages/extensions/desktop-workbench/src/client/preferences.ts`
- Create: `packages/extensions/desktop-workbench/tests/client.client.spec.tsx`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/desktop.cordis.patch.yml`

- [ ] **Step 1: Write the failing composition test**

```text
expect(utilityIds).toEqual(['session-log-download', 'desktop-workbench'])
expect(button).toHaveAttribute('aria-expanded', 'false')
fireEvent.click(button)
expect(button).toHaveAttribute('aria-expanded', 'true')
expect(tabs.map(tab => tab.textContent)).toEqual(['终端', '浏览器', '文件', '侧边聊天', '审阅'])
```

- [ ] **Step 2: Run the new suite and verify RED**

```bash
pnpm exec vitest run packages/extensions/desktop-workbench/tests/client.client.spec.tsx --config vitest.config.ts
```

- [ ] **Step 3: Implement the split Host/Client package**

Follow `session-messenger` split-build conventions. Register an icon-only `desktop-workbench` entry after `session-log-download` and `WorkbenchPanel` in `layout.utility`. Persist a clamped width under `dsh.desktop-workbench.width.v1`, implement tablist arrow keys and Escape, and use continuous Harness surfaces without cards or perpetual animation.

```text
export function loadWidth(storage: Storage): number {
  const value = Number(storage.getItem('dsh.desktop-workbench.width.v1'))
  return Number.isFinite(value) ? Math.min(720, Math.max(320, value)) : 420
}
```

- [ ] **Step 4: Add the package only to Desktop composition**

Add the dependency and insert `@deepseek-ai/dsh-desktop-workbench` after session-messenger in `desktop.cordis.patch.yml`; do not touch the ordinary Web profile.

- [ ] **Step 5: Re-run Step 2 and verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/package.json apps/desktop/desktop.cordis.patch.yml packages/extensions/desktop-workbench
git commit -m "feat(desktop): add Codex-style workbench shell"
```

### Task 4: Make Side Chat visible in both conversations

**Files:**
- Modify: `packages/extensions/session-messenger/src/types.ts`
- Modify: `packages/extensions/session-messenger/src/coordinator.ts`
- Modify: `packages/extensions/session-messenger/src/client/index.tsx`
- Modify: `packages/extensions/session-messenger/src/client/store.ts`
- Delete: `packages/extensions/session-messenger/src/client/MessengerDrawer.tsx`
- Delete: `packages/extensions/session-messenger/src/client/MessengerHeaderButton.tsx`
- Delete: `packages/extensions/session-messenger/src/client/MessengerUiController.ts`
- Create: a Desktop workbench Side Chat component (subsequently removed)
- Create: its scoped style module (subsequently removed)
- Modify: `packages/client/ui-conversation/src/client/chat/RelayNodeView.tsx`
- Modify: `packages/client/ui-conversation/src/client/chat/RelayNodeView.module.css`
- Modify: `packages/extensions/session-messenger/tests/coordinator.client.spec.ts`
- Modify: `packages/extensions/session-messenger/tests/client.client.spec.tsx`
- Modify: `packages/extensions/desktop-workbench/tests/client.client.spec.tsx`

- [ ] **Step 1: Write failing durable visibility tests**

```text
expect(source.events.at(-1)).toMatchObject({
  type: 'session-messenger/outgoing',
  ignorable: true,
  data: { targetSessionId: target.id, body: 'hello', status: 'delivered' },
})
expect(target.events.some(event => event.type === 'user/message')).toBe(true)
```

Also prove reply linkage, wake/no-wake, exact target id, and zero open/archive/delete/navigation side effects.

- [ ] **Step 2: Run messenger/workbench tests and verify RED**

```bash
pnpm exec vitest run packages/extensions/session-messenger/tests packages/extensions/desktop-workbench/tests/client.client.spec.tsx --config vitest.config.ts
```

- [ ] **Step 3: Add one UI-only event and renderer**

```text
'session-messenger/outgoing': {
  deliveryId: DeliveryId
  targetSessionId: SessionId
  body: string
  status: 'delivered' | 'delivery-recovery-pending'
  replyToDeliveryId?: DeliveryId
}
```

Append it with `ignorable: true` only after coordinator acceptance. Register a Client conversation definition for the source-side inline row; never add it to model history. Keep target relays and linked replies as ordinary visible relay nodes.

- [ ] **Step 4: Restore only the transport/store and build Side Chat**

Provide the existing messenger store/send/reply face but register no legacy header button, drawer, or overlay. Render current Session ID/copy, target Session ID, message, wake, reply context, send, and metadata-only recent status as one continuous panel.

- [ ] **Step 5: Re-run Step 2 and verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add packages/extensions/session-messenger packages/extensions/desktop-workbench packages/client/ui-conversation/src/client/chat
git commit -m "feat(messenger): show cross-session conversation flow"
```

### Task 5: Add bounded Files and Review modes

**Files:**
- Create: `packages/extensions/desktop-workbench/src/protocol.ts`
- Create: `packages/extensions/desktop-workbench/src/http.ts`
- Create: `packages/extensions/desktop-workbench/src/workspace-path.ts`
- Create: `packages/extensions/desktop-workbench/src/files.ts`
- Create: `packages/extensions/desktop-workbench/src/review.ts`
- Create: `packages/extensions/desktop-workbench/src/client/transport.ts`
- Create: `packages/extensions/desktop-workbench/src/client/FilesMode.tsx`
- Create: `packages/extensions/desktop-workbench/src/client/ReviewMode.tsx`
- Create: `packages/extensions/desktop-workbench/src/client/ReadOnlyModes.module.css`
- Create: `packages/extensions/desktop-workbench/tests/workspace-path.host.spec.ts`
- Create: `packages/extensions/desktop-workbench/tests/read-only.host.spec.ts`
- Create: `packages/extensions/desktop-workbench/tests/client.client.spec.tsx`

- [ ] **Step 1: Write failing containment and bounds tests**

```text
await expect(resolveWorkspacePath(root, '../secret')).rejects.toThrow(/outside workspace/)
await expect(resolveWorkspacePath(root, 'linked-outside')).rejects.toThrow(/outside workspace/)
expect((await readFilePreview(sessionId, 'large.txt')).truncated).toBe(true)
expect((await gitDiff(sessionId, 'changed.ts')).text.length).toBeLessThanOrEqual(MAX_DIFF_BYTES)
```

- [ ] **Step 2: Run the new suites and verify RED**

```bash
pnpm exec vitest run packages/extensions/desktop-workbench/tests/workspace-path.host.spec.ts packages/extensions/desktop-workbench/tests/read-only.host.spec.ts packages/extensions/desktop-workbench/tests/client.client.spec.tsx --config vitest.config.ts
```

- [ ] **Step 3: Implement capability-bound read-only Host routes**

Resolve the live session on Host, canonicalize `session.header.cwd`, canonicalize every requested child, and reject traversal/symlink escape. Cap directories at 200 entries and text previews at 256 KiB; return metadata for binary files. Invoke Git with argument arrays only:

```text
['git', '-C', workspaceRoot, 'status', '--porcelain=v2', '--branch', '-z']
['git', '-C', repositoryRoot, 'diff', '--no-ext-diff', '--unified=3', '--', relativePath]
```

- [ ] **Step 4: Implement Client modes**

Files supports lazy folders, filter, preview, copy path, and draft-only `@path`. Review supports status, selected bounded diff, copy, refresh, and draft-only `在当前聊天中审阅`. Neither mode mutates files or Git.

- [ ] **Step 5: Re-run Step 2 and verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add packages/extensions/desktop-workbench
git commit -m "feat(workbench): add files and review modes"
```

### Task 6: Add the human-owned Terminal

**Files:**
- Create: `packages/extensions/desktop-workbench/src/terminal.ts`
- Create: `packages/extensions/desktop-workbench/src/client/TerminalMode.tsx`
- Create: `packages/extensions/desktop-workbench/src/client/TerminalMode.module.css`
- Create: `packages/extensions/desktop-workbench/tests/terminal.host.spec.ts`
- Modify: `packages/extensions/desktop-workbench/tests/client.client.spec.tsx`
- Modify: `packages/extensions/desktop-workbench/src/http.ts`
- Modify: `packages/extensions/desktop-workbench/src/client/transport.ts`

- [ ] **Step 1: Write failing ownership and cleanup tests**

```text
const opened = await terminals.open(clientA, sessionA.id, { rows: 24, cols: 80 })
await expect(terminals.write(clientB, opened.id, 'pwd\n')).rejects.toThrow(/foreign terminal/)
await terminals.disconnect(clientA)
expect(fakeHandle.terminate).toHaveBeenCalledOnce()
expect(opened.cwd).toBe(sessionA.header.cwd)
```

Also pin a four-terminal cap, 16 KiB input cap, 1 MiB retained-output cap, resize bounds, signal vocabulary, and Host-dispose cleanup.

- [ ] **Step 2: Run Terminal tests and verify RED**

```bash
pnpm exec vitest run packages/extensions/desktop-workbench/tests/terminal.host.spec.ts packages/extensions/desktop-workbench/tests/client.client.spec.tsx --config vitest.config.ts
```

- [ ] **Step 3: Implement a separate user-terminal registry**

Resolve cwd from `ctx.sessions`, choose `/bin/zsh` with `/bin/bash` fallback on macOS, and call `ctx.subprocess.spawnTerminal` directly:

```text
const handle = await ctx.subprocess.spawnTerminal({
  argv: [shell, '-l'], cwd, rows, cols, graceMs: 1_500,
  env: { TERM: 'xterm-256color', DSH_UI_TERMINAL: '1' },
})
```

Key ownership by generated client connection id, emit bounded output events, and await `terminate()` on close, disconnect, session removal, plugin dispose, and Host shutdown. Never register these terminals in `ctx.terminals`.

- [ ] **Step 4: Add routes and Client terminal surface**

Expose capability-bound open/list/input/resize/signal/close and one SSE stream. Render up to four terminal tabs, ANSI-safe bounded output, exact UTF-8 input, copy, clear-view, restart, close, and ResizeObserver dimensions. Inactive mode pauses DOM batching, not the Host process.

- [ ] **Step 5: Re-run Step 2 and verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add packages/extensions/desktop-workbench
git commit -m "feat(workbench): add user terminal mode"
```

### Task 7: Add the isolated Electron Browser

**Files:**
- Create: `apps/desktop/src/browser/controller.ts`
- Create: `apps/desktop/src/browser/contracts.ts`
- Create: `apps/desktop/tests/browser-contracts.spec.ts`
- Modify: `apps/desktop/src/preload-api.ts`
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/tests/preload-api.spec.ts`
- Create: `packages/extensions/desktop-workbench/src/client/BrowserMode.tsx`
- Create: `packages/extensions/desktop-workbench/src/client/BrowserMode.module.css`
- Modify: `packages/extensions/desktop-workbench/tests/client.client.spec.tsx`

- [ ] **Step 1: Write failing validation and lifecycle tests**

```text
expect(isWorkbenchBrowserRequest({ kind: 'navigate', value: 'https://example.com' })).toBe(true)
expect(isWorkbenchBrowserRequest({ kind: 'navigate', value: 'file:///tmp/a' })).toBe(false)
expect(isTrustedHarnessMainFrame(mainContents, mainFrame, activeOrigin)).toBe(true)
expect(isTrustedHarnessMainFrame(mainContents, childFrame, activeOrigin)).toBe(false)
```

Also require finite clipped bounds, popup/download/permission denial, hide-before-switch, crash state, and destroy-on-close.

- [ ] **Step 2: Run Browser tests and verify RED**

```bash
pnpm exec vitest run apps/desktop/tests/browser-contracts.spec.ts packages/extensions/desktop-workbench/tests/client.client.spec.tsx --config vitest.config.ts
```

- [ ] **Step 3: Implement the controller and preload bridge**

Create `WebContentsView` lazily with sandbox, context isolation, web security, no Node, and `persist:dsh-workbench-browser`. Accept only show/hide, HTTP(S) navigate/search, back, forward, reload, stop, and bounded state. Validate exact main `webContents`, main frame, and active random-loopback origin on every call. Expose only:

```text
showWorkbenchBrowser(bounds: DesktopBrowserBounds): Promise<DesktopBrowserSnapshot>
hideWorkbenchBrowser(): Promise<void>
controlWorkbenchBrowser(request: DesktopBrowserRequest): Promise<DesktopBrowserSnapshot>
onWorkbenchBrowserState(listener: (snapshot: DesktopBrowserSnapshot) => void): () => void
```

- [ ] **Step 4: Implement Browser mode**

Render address/search, back, forward, reload/stop, external open, and a native-view placeholder. Report `getBoundingClientRect()` through ResizeObserver while active and hide native pixels before every unmount or mode switch.

- [ ] **Step 5: Re-run Step 2 and verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src apps/desktop/tests packages/extensions/desktop-workbench
git commit -m "feat(desktop): add isolated workbench browser"
```

### Task 8: Replace reasoning shimmer with typewriter motion

**Files:**
- Modify: `packages/client/ui-conversation/src/client/chat/ReasoningRow.tsx`
- Modify: `packages/client/ui-conversation/src/client/chat/ReasoningRow.module.css`
- Modify: `packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx`

- [ ] **Step 1: Write failing cadence and cleanup tests**

```text
expect(summary.textContent).not.toBe('Newest reasoning tokens keep arriving')
flushAnimationFrames(4)
expect(summary.textContent?.length).toBeGreaterThan(0)
rerenderSettled()
expect(summary.textContent).toBe('Inspect the session')
expect(animationFrames.size).toBe(0)
```

Cover expanded text, document hidden, unmount, and reduced motion.

- [ ] **Step 2: Run the focused suite and verify RED**

```bash
pnpm exec vitest run packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx --config vitest.config.ts
```

- [ ] **Step 3: Implement bounded grapheme reveal**

Reveal at least one grapheme per frame, accelerate above a 48-grapheme backlog, cap lag at 120 ms, and flush on settled, expanded, hidden document, or reduced motion. Cancel every scheduled frame. Replace the sweep pseudo-element with a quiet caret visible only during active running reveal.

```text
const summary = running && !expanded ? displayed : running ? latestLine(text) : firstLine(text)
```

- [ ] **Step 4: Re-run Step 2 and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-conversation/src/client/chat packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx
git commit -m "feat(conversation): smooth reasoning typewriter"
```

### Task 9: Audit, document, build, and install 0.3.0

**Files:**
- Create: `.agents/notes/implemented/feature/2026-08-20-macos-codex-workbench.md`
- Create: `.agents/notes/implemented/feature/2026-08-20-macos-codex-workbench.zh.md`
- Create: `.agents/notes/implemented/feature/2026-08-20-macos-codex-workbench.i18n.yaml`
- Create: `packages/extensions/desktop-workbench/README.md`
- Create: `packages/extensions/desktop-workbench/README.zh.md`
- Create: `packages/extensions/desktop-workbench/README.i18n.yaml`
- Modify: `packages/extensions/session-messenger/README.md`
- Modify: `packages/extensions/session-messenger/README.zh.md`
- Modify: `packages/extensions/session-messenger/README.i18n.yaml`
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `apps/desktop/README.i18n.yaml`
- Modify: `apps/desktop/tests/packaged-smoke.ts`
- Modify: `apps/desktop/package.json`
- Modify: `PROJECT_CONTEXT.md`

- [ ] **Step 1: Extend packaged acceptance**

```text
await expect(page.getByText('DeepSeek Harness', { exact: true })).toBeVisible()
await expect(sessionLog.locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-desktop-workbench-trigger', '')
await expect(page.locator('[data-workbench-mode]')).toHaveCount(5)
expect(await processTreeGone(harnessPid)).toBe(true)
```

Add width persistence, narrow layout, Side Chat visible flow, Files/Review non-mutation, Terminal open/write/close, Browser deny/teardown, reasoning caret/no shimmer, random listener, clean Quit, and unchanged `DSH_HOME`.

- [ ] **Step 2: Run focused regression**

```bash
pnpm exec vitest run packages/client/ui-renderer/tests/document-title.client.spec.tsx packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx packages/client/ui-layout/tests packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx packages/extensions/session-messenger/tests packages/extensions/desktop-workbench/tests apps/desktop/tests/preload-api.spec.ts apps/desktop/tests/navigation.spec.ts apps/desktop/tests/browser-contracts.spec.ts --config vitest.config.ts
```

- [ ] **Step 3: Run production gates**

```bash
pnpm run typecheck
pnpm run build:official
pnpm run build:desktop:main
pnpm run doc-sync
```

Fix feature-caused failures. Record unrelated pre-existing corpus failures separately.

- [ ] **Step 4: Bump Desktop to 0.3.0 and build Intel artifacts**

```bash
pnpm run desktop:dmg
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts --config vitest.config.ts
hdiutil verify apps/desktop/release/DeepSeek-Harness-0.3.0-mac-x64.dmg
```

- [ ] **Step 5: Install through the verified helper and audit the running app**

```text
CFBundleShortVersionString = 0.3.0
Mach-O architecture = x86_64
listener = 127.0.0.1:<random>
sidebar brand = DeepSeek Harness
renderer console errors = 0
~/.dsh preserved = true
```

Exercise all modes, cross-session reply, Browser isolation, terminal teardown, non-mutation, reasoning motion, updater, native Quit, and idle CPU after resources close.

- [ ] **Step 6: Record evidence and commit**

Record exact test totals, audit findings, artifact paths, sizes, SHA-256, `hdiutil`, installed version, listener, architecture, console evidence, and data preservation.

```bash
git add .agents/notes/implemented/feature packages/extensions/desktop-workbench packages/extensions/session-messenger apps/desktop PROJECT_CONTEXT.md
git commit -m "docs(desktop): record workbench acceptance"
```

- [ ] **Step 7: Review without publication**

```bash
git diff --check
git status --short --branch
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: clean worktree, no Windows changes, no secret-shaped values, and no GitHub push, PR, tag, or Release mutation.
