# Desktop Plugin Marketplace Implementation Plan

English | [中文](2026-08-17-desktop-plugin-market.zh.md)

**Goal:** Mount pinned `dshmarket@1.10.1` only in DeepSeek Harness Desktop and provide it a packaged, profile-scoped package runner with no system Node or pnpm prerequisite.

**Architecture:** A Desktop-only CLI patch mounts a first-party Host adapter before `dshmarket`. The adapter publishes immutable `desktopProfiles.current` and serialized `desktopPnpm.runPlugin()`. Operations re-enter the packaged `dsh plugin` command, preserving upstream profile initialization and bundle reconciliation, while the existing subprocess service owns credential scrubbing and process-tree teardown.

**Tech stack:** Electron 43, Cordis services, Node subprocess streams, pnpm 11.7.0, TypeScript, Vitest, existing DSH profile loader.

## Task 1: Add the packaged pnpm CLI seam

- [ ] Add failing tests in `apps/cli/tests/plugin.spec.ts` for an explicit packaged pnpm entry, absolute-path validation, shell-free argv, and unchanged ordinary PATH behavior.
- [ ] Refactor `apps/cli/src/plugin.ts` minimally so a trusted Desktop-provided absolute pnpm entry runs through `process.execPath`; retain the existing reconciliation logic and default PATH path.
- [ ] Run the focused CLI tests until GREEN.

## Task 2: Build Desktop Host services

- [ ] Create `packages/host/desktop-plugin-runtime` with package metadata, TypeScript config, README pair, source, and tests.
- [ ] Add failing tests for immutable active-profile identity, packaged pnpm resolution, empty/NUL/path rejection, one-operation lock, streamed output, abort/cancel, and effect teardown.
- [ ] Implement `desktopProfiles` as the fixed `web` profile identity for this Desktop generation.
- [ ] Implement `desktopPnpm.runPlugin()` over `ctx.subprocess`, using the exact packaged CLI, exact active `DSH_HOME`, and packaged pnpm entry.
- [ ] Run the new package tests and typecheck until GREEN.

## Task 3: Mount the audited market only in Desktop

- [ ] Add exact runtime dependencies on `dshmarket@1.10.1`, `pnpm@11.7.0`, and the Host adapter to `apps/desktop/package.json`; update the lockfile.
- [ ] Add `apps/desktop/desktop.cordis.patch.yml` with the Host adapter before `dshmarket`.
- [ ] Extend `HarnessProcess` with an absolute patch path and place `--patch <path>` before Web-owned host/port arguments.
- [ ] Resolve the source and packaged patch paths in `apps/desktop/src/main.ts`.
- [ ] Extend `scripts/stage-desktop.ts` and Electron build files to copy and validate the patch, market package, packaged pnpm entry, and adapter output.
- [ ] Add failing then green process/staging tests for exact args and runtime closure.

## Task 4: Prove composition and safety

- [ ] Add a temporary-home config-dump test proving the Desktop patch contains `desktop-plugin-runtime` and `dsh-market`, while ordinary `dsh web --dump-config` contains neither.
- [ ] Boot the assembled Web Host under a temporary `DSH_HOME`; verify `/dsh-market/status`, market client registration, and that Desktop mode reports packaged pnpm ready without provisioning the system.
- [ ] Install and remove a prebuilt fixture plugin; verify dependency reconciliation, Loader state, cancellation/busy behavior, and unchanged session/credential sentinels.
- [ ] Run Desktop, CLI, profile-loader, GUI, lint, runtime-closure, and documentation gates.

## Task 5: Package and record delivery

- [ ] Update Desktop README, package notice, and `PROJECT_CONTEXT.md` with the pinned market, service boundary, limitations, and tests.
- [ ] Build the Intel `.app` and DMG; verify the DMG and a temporary-home packaged smoke.
- [ ] Preserve the shared Windows release inputs and run the existing native Windows Setup build and smoke on the public pull request.
