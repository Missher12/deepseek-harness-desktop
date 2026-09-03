# macOS System Update Implementation Plan

English | [中文](2026-08-20-macos-system-update.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-blocking System Update settings section that reports official Harness progress and installs only verified, compatible Intel macOS Desktop releases.

**Architecture:** Electron main owns a closed update state machine, fixed GitHub endpoints, validation, download, checksum, and helper launch. Preload exposes narrow typed commands; a Desktop-only settings plugin renders cached state immediately. Official core tags are informational, while an allowlisted Desktop release manifest is the only install authority.

**Tech Stack:** Electron, TypeScript, React slot registration, Node.js HTTPS/crypto/fs/process APIs, Vitest, electron-builder, pnpm.

---

## File map

- `apps/desktop/src/update/*`: version parsing, manifest/release selection, downloader, state service, and recoverable installer helper.
- `apps/desktop/src/main.ts`, `preload-api.ts`, and `preload.ts`: lifecycle ownership and narrow IPC bridge.
- `packages/client/ui-settings-system-update/*`: Desktop-only Settings contribution, store, locale copy, and component tests.
- `apps/desktop/desktop.cordis.patch.yml`, `apps/desktop/package.json`, `tsconfig.client.json`: packaged plugin wiring.
- `scripts/stage-desktop.ts` and `apps/desktop/electron-builder.yml`: immutable build metadata and packaged helper/artifact checks.

### Task 1: Lock validation and state behavior with failing tests

- [ ] Add pure tests for `dsh-v<semver>` parsing, Desktop manifest validation, fixed repository and HTTPS allowlists, platform/architecture, size, and checksum requirements.
- [ ] Add release-selection tests for current, upstream-only, compatible Desktop, invalid manifest, downgrade, and rate-limit states.
- [ ] Add service tests for immediate cached state, delayed automatic check, 24-hour throttle, ETag, manual bypass, bounded errors, and teardown cancellation.
- [ ] Add preload tests proving renderer callers cannot supply repository, URL, filesystem path, or command values.

### Task 2: Implement main-process update ownership

- [ ] Implement the closed state snapshot and pure release selectors with immutable running build metadata.
- [ ] Implement fixed-endpoint requests with timeout, ETag, bounded response size, rate-limit handling, and no credential lookup.
- [ ] Implement owner-only staging, bounded redirects, progress events, byte-count checks, SHA-256 verification, and incomplete-file cleanup.
- [ ] Start automatic checking only after application readiness and persist only public version/check metadata under user data.

### Task 3: Implement recoverable installation

- [ ] Add a packaged helper invoked directly without a shell and supplied only fixed, validated paths from the main process.
- [ ] Mount the verified DMG read-only and verify one app bundle, bundle identifier, Desktop version, x86_64 executable, and packaged metadata.
- [ ] Back up the current app, replace it, verify the replacement, launch it, and restore/relaunch the previous app on post-backup failure.
- [ ] If the application parent is not writable, open the already-verified DMG for manual drag installation without elevation.

### Task 4: Add the Desktop-only Settings section

- [ ] Create a normal client package that registers through the settings slot only when the Desktop bridge exists.
- [ ] Use the framework store seat for update snapshots; components receive hooks and actions rather than subscribing manually.
- [ ] Render final two-row geometry immediately with placeholders, then show Desktop version, included core, newest official core, progress, last check, and bounded recovery text.
- [ ] Expose Check Again, Download Update, and Restart and Install only for valid state transitions; show upstream-only updates as waiting for Desktop adaptation.

### Task 5: Package and verify the internal build

- [ ] Wire the package, helper, and immutable update metadata into Desktop staging and electron-builder validation.
- [ ] Run focused update, preload, client, type, lint, staging, and existing Desktop lifecycle tests.
- [ ] Build the Intel macOS DMG and compare packaged metadata, architecture, size, and SHA-256 with local evidence.
- [ ] Install the local internal build, verify cold start is not delayed, open System Update, and verify the real page has no console or plugin-loader errors; do not publish to GitHub.

### Task 6: Update project documentation

- [ ] Record the two-channel policy, update state, packaging evidence, and known absence of a currently installable public Desktop release in `PROJECT_CONTEXT.md`.
- [ ] Run translation-pairing verification for this plan and the design pair; report unrelated pre-existing corpus failures separately.
