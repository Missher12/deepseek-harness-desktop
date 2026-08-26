# `dsh-lark` Harness Command Center Implementation Plan

English | [中文](2026-08-26-dsh-lark-command-center.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make exact `/` open a complete, owner-only Harness command center whose supported operations act on the current ordinary Session through native Harness services.

**Architecture:** A package-local `CommandCenterService` renders signed cards and adapts a fixed remote-safe command set to the current Agent and Host APIs. `CommandRouter` keeps identity/event admission and durable ordinary-message routing. `BindingController` gains one strict created-Session binding path. No Harness core or Desktop conversation code changes.

**Tech Stack:** TypeScript, Cordis, Host ApiProxy, Harness command/tool/job registries, Zod, Vitest, Feishu interactive cards, pnpm workspace tooling.

---

### Task 1: Record and pair the approved design

**Files:**
- Create: `docs/superpowers/specs/2026-08-26-dsh-lark-command-center-design.md`
- Create: `docs/superpowers/specs/2026-08-26-dsh-lark-command-center-design.zh.md`
- Create: `docs/superpowers/specs/2026-08-26-dsh-lark-command-center-design.i18n.yaml`
- Create: `docs/superpowers/plans/2026-08-26-dsh-lark-command-center.md`
- Create: `docs/superpowers/plans/2026-08-26-dsh-lark-command-center.zh.md`
- Create: `docs/superpowers/plans/2026-08-26-dsh-lark-command-center.i18n.yaml`

- [ ] Verify both bilingual pairs with the repository pairing tool.

### Task 2: Pin router and created-Session behavior with failing tests

**Files:**
- Modify: `packages/extensions/lark/tests/commands.host.spec.ts`
- Modify: `packages/extensions/lark/tests/binding.host.spec.ts`

- [ ] Require exact `/` to call `sendCommandCenter`, while `/进入` and `/切换` retain project selection.
- [ ] Require command aliases, argument validation, known-skill durable admission, and unknown-slash help.
- [ ] Require `bindCreated` to accept only the exact ordinary Session returned in the current workspace with matching cwd, including a blank Session, and reject every stale or cross-project target.
- [ ] Run focused tests and observe RED.

### Task 3: Implement the command center and signed selectors

**Files:**
- Create: `packages/extensions/lark/src/command-center.ts`
- Modify: `packages/extensions/lark/src/commands.ts`
- Modify: `packages/extensions/lark/src/binding.ts`
- Modify: `packages/extensions/lark/src/state.ts`
- Modify: `packages/extensions/lark/src/index.ts`
- Modify: `packages/extensions/lark/package.json`
- Modify: `packages/extensions/lark/tsconfig.json`

- [ ] Render the complete catalog with bounded safe buttons.
- [ ] Adapt Session create/rename, model/reasoning selection, native command execution, skills, tools, jobs/subagents, usage, and diagnostics to current Harness services.
- [ ] Extend signed one-use action types for command-center, model-provider, model, and reasoning selections.
- [ ] Keep a fixed allowlist for native commands and require the current user-invocable skill catalog before durable skill admission.
- [ ] Route card callbacks through the same identity action admission boundary.
- [ ] Run focused tests and observe GREEN.

### Task 4: Add service-level tests and protect existing behavior

**Files:**
- Create: `packages/extensions/lark/tests/command-center.host.spec.ts`
- Modify: `packages/extensions/lark/tests/identity.host.spec.ts`
- Modify: `packages/extensions/lark/tests/state.host.spec.ts`

- [ ] Test catalog completeness, action signing, model and reasoning revalidation, native-command allowlisting, bounded views, and diagnostics redaction.
- [ ] Test model/provider failures and created-but-unbound failure reporting.
- [ ] Run the complete Lark test suite.

### Task 5: Document the shipped behavior

**Files:**
- Modify: `packages/extensions/lark/README.md`
- Modify: `packages/extensions/lark/README.zh.md`
- Modify: `packages/extensions/lark/README.i18n.yaml`
- Modify: `PROJECT_CONTEXT.md`
- Create: `.agents/notes/implemented/feature/2026-08-26-lark-harness-command-center.md`
- Create: `.agents/notes/implemented/feature/2026-08-26-lark-harness-command-center.zh.md`
- Create: `.agents/notes/implemented/feature/2026-08-26-lark-harness-command-center.i18n.yaml`

- [ ] Record exact command behavior, security boundaries, model experience, and known exclusions.
- [ ] Verify every bilingual pair and repository documentation gate.

### Task 6: Build, install, and verify the removable Bundle

**Files:**
- Modify: only generated manifest/lock artifacts required by the package dependency change.
- Create locally only: a versioned tarball under `artifacts/`.

- [ ] Run typecheck, lint/diff checks, package Bundle build, and pack inspection.
- [ ] Install the exact tarball into the current `web` Profile, restart Harness, and verify enabled/connected/paired/bound state without printing secrets or identities.
- [ ] Verify installed package bytes match the tarball and the plugin remains independently removable.
- [ ] Run the repository pre-push checks, commit only intended files, and push `codex/dsh-lark-desktop-compat`.
