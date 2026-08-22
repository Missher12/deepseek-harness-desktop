# Plugin Install Transaction Recovery Implementation Plan

English | [中文](2026-08-20-plugin-install-transaction-recovery.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent failed marketplace operations from leaving ghost profile bundles that break the next application boot, and provide a guarded repair path for already-existing residue.

**Architecture:** Treat `dependencies` and `dsh.profile.bundles` as one manifest transaction. Snapshot both before package-manager mutation, restore both on every non-committed outcome, and detect repair candidates only from the conjunction of an external bundle, no matching dependency, and no installed package directory.

**Tech Stack:** TypeScript, Node.js filesystem APIs, dshmarket HTTP routes and React client, Vitest, pnpm patching.

---

## File map

- `apps/desktop/node_modules/dshmarket/src/profile.ts`: manifest transaction snapshot, restore, residue detection, and backup-before-repair primitives.
- `apps/desktop/node_modules/dshmarket/src/routes.ts`: install/update transaction boundaries and guarded repair endpoint.
- `apps/desktop/node_modules/dshmarket/src/client/MarketSection.tsx`: residue notice and explicit repair action.
- `scripts/dshmarket-profile-transaction.spec.ts`: regression tests against the patched package source and routes.
- `patches/dshmarket@1.10.1.patch`: reproducible pnpm patch for packaged builds.

### Task 1: Reproduce the ghost-bundle failure

- [ ] Add a fixture profile containing in-box bundles plus one external carrier in both `dependencies` and `dsh.profile.bundles`.
- [ ] Simulate a package-manager failure that mutates both fields, and assert the exact pre-operation manifest is restored.
- [ ] Add cancellation, timeout, and post-install validation rejection cases; confirm the new tests fail against the current dependency-only rollback.
- [ ] Add residue-classification tests covering missing external carrier, installed dependency, present package directory, and in-box bundle.

### Task 2: Make marketplace mutations transactional

- [ ] Replace the dependency-only snapshot with a typed snapshot containing cloned dependencies and bundle names.
- [ ] Restore both fields while preserving unrelated manifest keys and the exact in-box and unrelated entries from the snapshot.
- [ ] Call rollback for every outcome that is not a validated commit, including cancellation and timeout.
- [ ] Keep successful validated installs committed and keep update downgrade/self-protection behavior unchanged.

### Task 3: Add guarded residue repair

- [ ] Return repairable and ambiguous bundle diagnostics from the installed endpoint.
- [ ] Add a same-origin POST repair endpoint that accepts only a bundle name already classified as repairable.
- [ ] Create a timestamped profile-manifest backup before removing exactly that bundle entry; never delete package-store content.
- [ ] Add an explicit client notice and repair button, with restart-required copy after success.

### Task 4: Rebuild and verify the patch

- [ ] Build dshmarket so host and client artifacts match the modified source.
- [ ] Regenerate `patches/dshmarket@1.10.1.patch` through the repository's pnpm patch workflow.
- [ ] Run the new transaction suite plus `dshmarket-self-protection`, client-layout, client-artifact, and Desktop staging suites.
- [ ] Verify an isolated profile no longer keeps a failed carrier bundle and the real restored application opens without plugin-loader errors.

### Task 5: Document current state

- [ ] Update `PROJECT_CONTEXT.md` with the transaction invariant, repair rule, current live recovery, and test evidence.
- [ ] Run translation-pairing verification for this plan and focused documentation checks; report unrelated pre-existing corpus failures separately.
