# DeepSeek Harness Windows Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a tested Windows 10/11 x64 per-user Setup executable that installs and launches the complete DeepSeek Harness desktop application without external runtime prerequisites.

**Architecture:** Extend the verified Intel Electron application through injected platform decisions rather than forking the UI or runtime. Windows uses standard native window behavior, fail-closed PowerShell process discovery, exact-PID `taskkill /T /F` tree cleanup, and Electron Builder NSIS packaging; native Windows CI proves the installed application and uninstall lifecycle with temporary data.

**Tech Stack:** TypeScript 6, Electron 43.4, Electron Builder 26.15, NSIS, Vitest 4, Playwright Electron, GitHub Actions `windows-latest`.

---

### Task 1: Adopt the rounded cross-platform icon

**Files:**
- Create: `apps/desktop/assets/icon-source-rounded.png`
- Create: `apps/desktop/assets/icon.ico`
- Modify: `apps/desktop/assets/icon.icns`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/tests/manifest.spec.ts`
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `scripts/stage-desktop.ts`
- Modify: `scripts/stage-desktop.spec.ts`

- [ ] **Step 1: Write the failing asset and manifest assertions**

Require `icon-source-rounded.png`, `icon.ico`, and `icon.icns` in the stage; require `win.icon: assets/icon.ico` and `mac.icon: assets/icon.icns` in the parsed builder configuration; assert that the Electron main process references `icon-source-rounded.png`.

- [ ] **Step 2: Run the focused tests and verify the missing Windows icon failure**

Run: `pnpm exec vitest run apps/desktop/tests/manifest.spec.ts scripts/stage-desktop.spec.ts`

Expected: FAIL because `icon.ico` and the rounded-source requirement are absent.

- [ ] **Step 3: Generate deterministic platform icon containers from the approved PNG**

Generate macOS iconset sizes 16–1024 with `sips` and build `assets/icon.icns` with `iconutil`. Use Pillow to save the same RGBA source as `assets/icon.ico` with embedded 16, 24, 32, 48, 64, 128, and 256 pixel frames. Keep `icon-source-rounded.png` as the source of truth and preserve the original user image as historical input.

- [ ] **Step 4: Update the runtime and stage requirements**

Use `icon-source-rounded.png` for `app.dock.setIcon`, require all three current icon assets in `stageDesktop`, and document source/output hashes in both READMEs.

- [ ] **Step 5: Run the focused tests**

Run: `pnpm exec vitest run apps/desktop/tests/manifest.spec.ts scripts/stage-desktop.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit the icon unit**

```bash
git add apps/desktop/assets apps/desktop/src/main.ts apps/desktop/tests/manifest.spec.ts apps/desktop/README.md apps/desktop/README.zh.md scripts/stage-desktop.ts scripts/stage-desktop.spec.ts
git commit -m "design: adopt rounded desktop application icon"
```

### Task 2: Add Windows-native window and menu behavior

**Files:**
- Create: `apps/desktop/src/window/platform.ts`
- Create: `apps/desktop/tests/window-platform.spec.ts`
- Modify: `apps/desktop/src/window/options.ts`
- Modify: `apps/desktop/src/window/menu.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/tests/window-options.spec.ts`
- Modify: `apps/desktop/tests/menu.spec.ts`

- [ ] **Step 1: Write failing tests for Windows framing, menus, and close behavior**

Define the wished-for platform API:

```ts
export interface DesktopPlatformBehavior {
  hideWindowOnClose: boolean
  setDockIcon: boolean
}

export function desktopPlatformBehavior(platform: NodeJS.Platform): DesktopPlatformBehavior
```

Assert `win32` omits `titleBarStyle` and `trafficLightPosition`, includes Settings and Quit under File, uses `CmdOrCtrl` accelerators, and returns `hideWindowOnClose: false`. Preserve current macOS behavior.

- [ ] **Step 2: Run tests and verify the new API is missing**

Run: `pnpm exec vitest run apps/desktop/tests/window-platform.spec.ts apps/desktop/tests/window-options.spec.ts apps/desktop/tests/menu.spec.ts`

Expected: FAIL because `window/platform.ts` and injected platform parameters do not exist.

- [ ] **Step 3: Implement the minimal platform policy**

Implement two explicit policies: Darwin uses the hidden-inset title bar, app menu, close-to-Dock, and Dock icon; Windows uses the standard frame, File-menu Settings/Quit entries, close-to-quit, and no Dock API. Pass `process.platform` from `main.ts`; keep tests deterministic through explicit platform arguments.

- [ ] **Step 4: Run the focused tests**

Run: `pnpm exec vitest run apps/desktop/tests/window-platform.spec.ts apps/desktop/tests/window-options.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/main-lifecycle.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the native behavior unit**

```bash
git add apps/desktop/src/window apps/desktop/src/main.ts apps/desktop/tests
git commit -m "feat: add Windows desktop window behavior"
```

### Task 3: Own the Windows Harness process tree

**Files:**
- Create: `apps/desktop/src/harness/process-tree.ts`
- Create: `apps/desktop/tests/process-tree.spec.ts`
- Modify: `apps/desktop/src/harness/process.ts`
- Modify: `apps/desktop/tests/process.spec.ts`

- [ ] **Step 1: Write failing tests for platform-correct spawn and termination**

Define:

```ts
export type TerminationMode = 'graceful' | 'force'

export interface ProcessTreeRunner {
  run(command: string, args: readonly string[]): void
}

export function terminateProcessTree(
  pid: number,
  mode: TerminationMode,
  platform: NodeJS.Platform,
  runner?: ProcessTreeRunner,
): void
```

Assert Windows uses `taskkill ['/PID', String(pid), '/T', '/F']`, rejects non-positive PIDs, and contains already-gone command failures. Assert Windows spawns with `detached: false`; Darwin retains `detached: true` and negative-PID `SIGTERM` then `SIGKILL` escalation.

- [ ] **Step 2: Run tests and verify the Windows termination API is missing**

Run: `pnpm exec vitest run apps/desktop/tests/process-tree.spec.ts apps/desktop/tests/process.spec.ts`

Expected: FAIL because the process-tree module and Windows spawn policy do not exist.

- [ ] **Step 3: Implement exact-PID Windows tree cleanup**

Use synchronous `taskkill` only for the application-owned positive PID and its descendants. Keep POSIX group signals for Darwin. Inject `platform` and `terminateTree` into `HarnessProcess`; Windows performs one forced tree termination and awaits the exact child exit, while POSIX preserves graceful escalation.

- [ ] **Step 4: Run focused lifecycle tests**

Run: `pnpm exec vitest run apps/desktop/tests/process-tree.spec.ts apps/desktop/tests/process.spec.ts apps/desktop/tests/main-lifecycle.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the process ownership unit**

```bash
git add apps/desktop/src/harness apps/desktop/tests/process-tree.spec.ts apps/desktop/tests/process.spec.ts
git commit -m "feat: stop the owned Harness tree on Windows"
```

### Task 4: Fail closed on an existing Windows Harness

**Files:**
- Modify: `apps/desktop/src/harness/ownership.ts`
- Modify: `apps/desktop/tests/ownership.spec.ts`

- [ ] **Step 1: Write failing Windows discovery tests**

Inject `platform: 'win32'` and a process list containing quoted Windows paths. Assert a command containing `@deepseek-ai\dsh\lib\bin.js web` is detected without calling `listOpenFiles`; unrelated Electron and CLI commands are ignored. Assert process-list failures reject rather than returning no conflict.

- [ ] **Step 2: Run tests and verify Windows commands are not recognized**

Run: `pnpm exec vitest run apps/desktop/tests/ownership.spec.ts`

Expected: FAIL on Windows path recognition and Windows no-open-file behavior.

- [ ] **Step 3: Implement PowerShell process discovery**

Run `powershell.exe -NoLogo -NoProfile -NonInteractive -Command` with `Get-CimInstance Win32_Process`, select `ProcessId,CommandLine`, and parse its compressed JSON output. Normalize slash direction and case for command classification. On Windows treat any observable `dsh web` as a conflict; on Darwin preserve exact `DSH_HOME` open-file proof.

- [ ] **Step 4: Run the focused tests**

Run: `pnpm exec vitest run apps/desktop/tests/ownership.spec.ts apps/desktop/tests/main-lifecycle.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the conflict detection unit**

```bash
git add apps/desktop/src/harness/ownership.ts apps/desktop/tests/ownership.spec.ts
git commit -m "feat: detect conflicting Harness runtimes on Windows"
```

### Task 5: Build the one-click NSIS Setup executable

**Files:**
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/package.json`
- Modify: `package.json`
- Modify: `apps/desktop/tests/manifest.spec.ts`
- Modify: `scripts/stage-desktop.ts`
- Modify: `scripts/stage-desktop.spec.ts`

- [ ] **Step 1: Write failing Setup configuration assertions**

Parse `electron-builder.yml` and assert `win.target` is NSIS x64, `win.icon` is `assets/icon.ico`, artifact name is `DeepSeek-Harness-Setup-${version}-win-x64.${ext}`, and NSIS is one-click, per-user, non-elevating, shortcut-creating, run-after-finish, and data-preserving. Require root `desktop:setup` and package `pack:setup` scripts.

- [ ] **Step 2: Run tests and verify NSIS configuration is absent**

Run: `pnpm exec vitest run apps/desktop/tests/manifest.spec.ts scripts/stage-desktop.spec.ts`

Expected: FAIL because the Setup target and scripts do not exist.

- [ ] **Step 3: Add Windows packaging configuration**

Configure Electron Builder with unsigned Windows x64 NSIS output, current-user one-click installation, desktop and Start-menu shortcuts, `runAfterFinish: true`, and `deleteAppDataOnUninstall: false`. Preserve the Intel macOS commands and DMG configuration.

- [ ] **Step 4: Run focused configuration and staging tests**

Run: `pnpm exec vitest run apps/desktop/tests/manifest.spec.ts scripts/stage-desktop.spec.ts`

Expected: PASS.

- [ ] **Step 5: Build the platform-independent application and stage**

Run: `pnpm run desktop:stage`

Expected: build succeeds and validates the desktop stage, including Windows icon and native `.node` modules.

- [ ] **Step 6: Commit the Setup configuration unit**

```bash
git add apps/desktop/electron-builder.yml apps/desktop/package.json apps/desktop/tests/manifest.spec.ts package.json scripts/stage-desktop.ts scripts/stage-desktop.spec.ts
git commit -m "build: add one-click Windows Setup packaging"
```

### Task 6: Prove install, launch, quit, and uninstall on Windows

**Files:**
- Create: `apps/desktop/tests/windows-packaged-smoke.spec.ts`
- Create: `scripts/windows-desktop-smoke.ps1`
- Create: `.github/workflows/windows-desktop.yml`
- Modify: `apps/desktop/package.json`
- Modify: `package.json`

- [ ] **Step 1: Write the Windows packaged smoke before the workflow**

The Vitest/Playwright smoke must locate the unpacked Windows executable, launch it with temporary `DSH_HOME` and user data, wait for `body[data-dsh-surface="desktop"]`, verify a random `127.0.0.1` URL, open Settings, quit, and poll the tracked Electron and listener PIDs to absence through PowerShell process and TCP-owner queries.

- [ ] **Step 2: Add the installer lifecycle script**

The PowerShell script silently installs Setup into a temporary per-user location, checks the executable and shortcuts, launches the installed app with temporary data, invokes the packaged smoke, silently uninstalls, and verifies that application files and shortcuts are absent while the temporary Harness data remains.

- [ ] **Step 3: Add the native Windows workflow**

Use `windows-latest`, Node 22.20, pnpm 11.7, frozen install, focused desktop tests, `desktop:setup`, the packaged smoke, installer lifecycle script, `Get-FileHash -Algorithm SHA256`, and `actions/upload-artifact`. Do not read repository or environment secrets.

- [ ] **Step 4: Validate workflow syntax and platform-independent tests**

Run: `pnpm exec vitest run apps/desktop/tests/*.spec.ts scripts/stage-desktop.spec.ts`

Expected on macOS: all platform-independent tests pass; packaged Windows tests skip because no Windows executable is present.

- [ ] **Step 5: Commit the native verification unit**

```bash
git add .github/workflows/windows-desktop.yml apps/desktop/tests/windows-packaged-smoke.spec.ts scripts/windows-desktop-smoke.ps1 apps/desktop/package.json package.json
git commit -m "ci: verify Windows desktop installation lifecycle"
```

### Task 7: Record the cross-platform desktop decision and run release checks

**Files:**
- Create: `.agents/notes/implemented/feature/2026-08-14-windows-desktop-setup.md`
- Create: `.agents/notes/implemented/feature/2026-08-14-windows-desktop-setup.zh.md`
- Create: `.agents/notes/implemented/feature/2026-08-14-windows-desktop-setup.i18n.yaml`
- Modify: `PROJECT_CONTEXT.md`
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `docs/superpowers/specs/2026-08-14-deepseek-harness-windows-setup-design.md`
- Modify: `docs/superpowers/specs/2026-08-14-deepseek-harness-windows-setup-design.zh.md`

- [ ] **Step 1: Write the implemented Agent Note and current-state docs**

Record the Windows per-user Setup decision, exact runtime ownership differences, rejected portable archive and native UI alternatives, unsigned limitation, verification tiers, and native Windows coverage requirement. Update the project context and desktop README without claiming a Windows Setup was run on macOS.

- [ ] **Step 2: Record bilingual consistency hashes**

Run `pnpm run verify-translation-pairing --write` for the Agent Note, Windows design, and desktop README pairs.

- [ ] **Step 3: Run focused behavior and build checks**

```bash
pnpm exec vitest run apps/desktop/tests/*.spec.ts scripts/stage-desktop.spec.ts packages/boot/app-boot/tests/profile.spec.ts
pnpm run build:desktop:main
pnpm run lint
pnpm run doc-sync
git diff --check
```

Expected: all available tests and gates pass; the Windows packaged smoke remains separately identified until `windows-latest` runs it.

- [ ] **Step 4: Inspect the final diff and secret surface**

Run focused secret-pattern scans only over the commits introduced by this branch, verify that no `DSH_HOME` content, `.env`, credential value, generated user data, release directory, or temporary installer data is tracked, and confirm `git status --short` is clean after committing.

- [ ] **Step 5: Commit the documentation and verification unit**

```bash
git add .agents/notes/implemented/feature/2026-08-14-windows-desktop-setup* PROJECT_CONTEXT.md apps/desktop/README* docs/superpowers
git commit -m "docs: record Windows desktop Setup delivery"
```
