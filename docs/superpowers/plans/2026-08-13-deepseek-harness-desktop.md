# DeepSeek Harness Desktop Implementation Record

English | [中文](2026-08-13-deepseek-harness-desktop.zh.md)

**Date:** 2026-08-13

**Status:** Implemented; Intel macOS live migration verified; native Windows artifact verification pending

## Objective

Convert the official DeepSeek Harness Web surface into a self-contained Intel macOS application with a Codex-style focused window, random loopback port, native lifecycle, and rounded whale icon.

## Phase 1: Baseline and safety

- Pin the official repository baseline and preserve the upstream remote.
- Inspect the installed Web runtime, data root, process tree, and fixed-port ownership without changing them.
- Work on an isolated `codex/deepseek-desktop-app` branch and worktree.
- Use temporary `DSH_HOME` directories for every automated and packaged test.
- Keep the Hermes-owned process on port 65000 running until the user explicitly approves migration.

## Phase 2: Native shell

- Add `apps/desktop` with Electron 43.4.0 and x86_64-only packaging.
- Implement single-instance behavior, native menus, loading and failure pages, window-state persistence, and safe external navigation.
- Disable renderer Node integration; enable context isolation, sandboxing, and Web security.
- Expose only three validated desktop commands and three validated recovery actions through preload.
- Launch the bundled CLI on `127.0.0.1` with port `0`, accept only its validated loopback URL, and wait for readiness.
- Track and stop only the exact owned process group.

## Phase 3: Desktop presentation

- Reuse the official React/Vite application and WebSocket transport.
- Add an explicit desktop surface query and body marker.
- Keep the sessions, conversation, and details columns while reducing browser-only chrome.
- Wire the native new-session, command-search, and settings actions to stable renderer hooks.
- Preserve the accepted shared 1254×1254 RGBA whale icon master without redesigning it, and generate the macOS `.icns` plus Windows `.ico` from that master.

## Phase 4: Self-contained packaging

- Add a deterministic stage step that deploys the desktop dependency graph, copies built application files, and validates required native binaries.
- Include the complete workspace dependency closure needed by the CLI, bundles, and dynamically mounted client plugins.
- Emit the sandbox preload as CommonJS `preload.cjs`.
- Keep runtime `node_modules` under `app.asar.unpacked` and redirect Harness profile fallback links to those physical packages.
- Permit config-only HMR without Node's internal ESM loader while retaining the internal-loader requirement for module HMR.
- Build an unsigned local `.app` and Intel DMG with bundle identifier `ai.deepseek.harness.desktop`.

## Phase 5: Verification

Run the focused regression suite:

```sh
pnpm exec vitest run apps/desktop/tests scripts/stage-desktop.spec.ts packages/boot/app-boot/tests/profile.spec.ts packages/boot/app-boot/tests/user-patches.spec.ts --config vitest.config.ts
```

Run static and dependency checks:

```sh
pnpm run build
pnpm run lint
pnpm run verify-runtime-closure
pnpm run doc-sync
```

Build and validate the artifacts:

```sh
pnpm run desktop:pack
pnpm run desktop:dmg
hdiutil verify apps/desktop/release/DeepSeek-Harness-0.1.0-mac-x64.dmg
```

The packaged smoke must launch from an external temporary directory, verify the preload bridge, random loopback listener, three-column shell, stable plugin graph, settings dialog, native Quit, descendant cleanup, and listener cleanup.

## Delivered files

- `apps/desktop/`: Electron source, static renderer pages, icon assets, packaging configuration, and desktop tests.
- `scripts/stage-desktop.ts`: self-contained staging and validation.
- `packages/boot/app-boot/src/profile.ts`: physical asar-unpacked fallback targets.
- `vendor/hmr/src/index.ts`: config-only HMR compatibility for packaged Node.
- Existing Web client packages: desktop markers, presentation, and native command hooks.
- `PROJECT_CONTEXT.md`: project status, architecture, safety boundary, and release evidence.

## Live migration result

The Intel macOS application now owns the live `~/.dsh` runtime. The exact legacy process group stopped gracefully, port 65000 was released, the independent Hermes gateway remained running, and the installed application passed HTTP, window, Dock, Finder icon, and physical package-link checks on a random loopback port. A permission-restricted pre-migration backup remains available; no data migration or credential copy was performed.
