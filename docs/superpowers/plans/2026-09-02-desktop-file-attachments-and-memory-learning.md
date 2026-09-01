# Desktop File Attachments and Memory & Learning Implementation Plan

English | [中文](2026-09-02-desktop-file-attachments-and-memory-learning.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship provider-neutral document attachments, a clear Memory & Learning settings experience, and release guards that keep Browser/Computer Control out of DeepSeek Harness Desktop on Intel macOS and Windows x64.

**Architecture:** Extend the existing attachment Service Definition and local provider with immutable document storage and bounded extraction, add a durable `document` content block, and project it to deterministic text in each production LLM adapter. Generalize the composer attachment draft from images to an ordered image-or-document union. Keep the existing Brain Hub runtime untouched while renaming and simplifying only its user-facing settings projection.

**Tech Stack:** TypeScript, React, Cordis, Typert Remote, Zod/Schemastery, PDF.js, fflate, fast-xml-parser, Vitest, Vite browser snapshots, Electron/electron-builder, NSIS, GitHub Actions.

---

### Task 1: Lock the release scope and dependencies

**Files:**
- Modify: `apps/desktop/tests/manifest.spec.ts`
- Modify: `apps/desktop/tests/packaged-smoke.ts`
- Modify: `scripts/stage-desktop.spec.ts`
- Modify: `packages/attachment/attachment-local/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write release-absence tests**

Add assertions that Desktop dependencies, staged files, packaged files, settings rows, and model tool catalogs contain none of `tool-agent-control`, `tool-browser-control`, `tool-computer-control`, `ui-desktop-control`, `control-runtime`, `computer-use-helper`, or `extensions/chromium`.

- [ ] **Step 2: Run the tests and confirm RED where a missing negative gate is expected**

Run: `pnpm exec vitest run apps/desktop/tests/manifest.spec.ts scripts/stage-desktop.spec.ts`

Expected: the new staged-roster assertion fails until the exact forbidden roster is implemented.

- [ ] **Step 3: Add one exact forbidden-artifact roster and declare extraction dependencies**

The release verifier checks normalized repository-relative paths and exact package names. Add direct `pdfjs-dist`, `fflate`, and `fast-xml-parser` dependencies to `@deepseek-ai/dsh-attachment-local`; do not rely on transitive packages.

- [ ] **Step 4: Regenerate the lockfile and verify GREEN**

Run: `pnpm install && pnpm exec vitest run apps/desktop/tests/manifest.spec.ts scripts/stage-desktop.spec.ts`

Expected: focused tests pass and the supply-chain policy accepts the new direct dependencies.

### Task 2: Define durable document attachment contracts

**Files:**
- Modify: `packages/attachment/attachment/src/types.ts`
- Modify: `packages/attachment/attachment/src/error.ts`
- Modify: `packages/attachment/attachment/src/index.ts`
- Modify: `packages/attachment/attachment/src/admission.ts`
- Modify: `packages/attachment/attachment/tests/admission.spec.ts`
- Modify: `packages/attachment/attachment/tests/index.spec.ts`
- Modify: `packages/llm/llm/src/types.ts`
- Modify: `packages/llm/llm/tests/content.spec.ts`

- [ ] **Step 1: Write failing contract and admission tests**

Cover the closed document media types, five-document/20 MiB/50 MiB limits, canonical display names, mixed-batch ordering, `document` content-block typing, and rejection of unknown fields and invalid counts.

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run packages/attachment/attachment/tests packages/llm/llm/tests/content.spec.ts`

Expected: tests fail because document types and Service methods do not exist.

- [ ] **Step 3: Implement the minimal provider-neutral contract**

Add `DocumentAttachmentRef`, `DocumentMediaType`, `SaveDocumentAttachment`, `StoredDocumentAttachment`, and `DocumentAttachmentLimits`. Extend `AttachmentStore` with `documentLimits`, `validateDocument`, `saveDocument(s)`, and `readDocument`. Augment `ContentBlockMap` with `{ type: 'document'; attachment: DocumentAttachmentRef }`.

- [ ] **Step 4: Verify GREEN and strict types**

Run: `pnpm exec vitest run packages/attachment/attachment/tests packages/llm/llm/tests/content.spec.ts && pnpm --filter @deepseek-ai/dsh-attachment typecheck`

Expected: focused tests and package typecheck pass.

### Task 3: Implement immutable local extraction

**Files:**
- Create: `packages/attachment/attachment-local/src/document.ts`
- Create: `packages/attachment/attachment-local/src/document-store.ts`
- Create: `packages/attachment/attachment-local/src/ooxml.ts`
- Create: `packages/attachment/attachment-local/tests/document.spec.ts`
- Create: `packages/attachment/attachment-local/tests/ooxml.spec.ts`
- Modify: `packages/attachment/attachment-local/src/index.ts`
- Modify: `packages/attachment/attachment-local/src/invariant.ts`
- Modify: `packages/attachment/attachment-local/README.md`
- Modify: `packages/attachment/attachment-local/README.zh.md`

- [ ] **Step 1: Write extractor and storage RED tests**

Fixtures cover UTF-8 text/code, a small PDF, DOCX text, XLSX shared strings and stored values, Windows-style names, deterministic truncation, digest verification, encrypted/macro/legacy/binary rejection, ZIP traversal, oversized entries, excessive entries, and corrupt stored bytes.

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run packages/attachment/attachment-local/tests/document.spec.ts packages/attachment/attachment-local/tests/ooxml.spec.ts`

Expected: module-not-found failures for the new extractor and store.

- [ ] **Step 3: Implement bounded extraction and storage**

Plain text uses fatal UTF-8 decoding. PDF.js extracts ordered page text under page/output limits. OOXML extraction uses bounded fflate entries and fast-xml-parser, reads only the required document/workbook parts, ignores macros and external relationships, and never evaluates formulas. Store source and extracted bytes by SHA-256 in provider-owned directories with owner-only temporary writes and atomic rename.

- [ ] **Step 4: Verify GREEN and coverage**

Run: `pnpm exec vitest run packages/attachment/attachment-local/tests --coverage.enabled --coverage.include=packages/attachment/attachment-local/src/**`

Expected: all local attachment tests pass and changed extraction files have complete branch coverage or justified unreachable exclusions.

### Task 4: Carry documents through the authenticated prompt wire

**Files:**
- Modify: `packages/host/apiproxy/src/api/sessions.ts`
- Modify: `packages/host/apiproxy/src/api/sessions.schema.ts`
- Modify: `packages/host/apiproxy/src/api-proxy.ts`
- Modify: `packages/host/apiproxy/tests/client-handler.spec.ts`
- Modify: `packages/host/apiproxy/tests/api-proxy.spec.ts`
- Modify: `packages/client/runtime/src/client/contract/session.ts`
- Modify: `packages/client/connection/src/client/fixture.ts`

- [ ] **Step 1: Write prompt-wire RED tests**

Cover canonical base64, exact keys, media/name bounds, mixed ordered batches, atomic invalid-member rejection, missing attachment service, cancellation, and zero path leakage.

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run packages/host/apiproxy/tests/client-handler.spec.ts packages/host/apiproxy/tests/api-proxy.spec.ts`

Expected: document prompt parts fail schema validation.

- [ ] **Step 3: Implement document prompt admission**

Add one strict `document` request part and make `durablePromptContent` validate all image/document inputs before publishing ordered durable blocks. Serialize all attachment writes through the existing per-agent admission owner so steering and queued prompts cannot interleave a batch.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run packages/host/apiproxy/tests packages/client/connection/tests && pnpm --filter @deepseek-ai/dsh-api-proxy typecheck`

Expected: wire, Host, and client contract tests pass.

### Task 5: Project documents into model requests

**Files:**
- Modify: `packages/llm/llm/src/content.ts`
- Modify: `packages/llm/llm/tests/content.spec.ts`
- Modify: `packages/llm/llm-deepseek/src/serialize.ts`
- Modify: `packages/llm/llm-deepseek/tests/serialize.spec.ts`
- Modify: `packages/llm/llm-pi-ai/src/context.ts`
- Modify: `packages/llm/llm-pi-ai/tests/context.spec.ts`

- [ ] **Step 1: Write deterministic projection RED tests**

Assert stable filename/media/truncation tags, integrity failures, nested tool-result handling, exact source order, abort behavior, no raw path, and identical text for DeepSeek and pi-ai adapters.

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run packages/llm/llm/tests/content.spec.ts packages/llm/llm-deepseek/tests/serialize.spec.ts packages/llm/llm-pi-ai/tests/context.spec.ts`

Expected: document blocks are currently ignored.

- [ ] **Step 3: Implement one shared transient document projection**

`projectDocumentsForRequest()` reads each unique reference once, verifies it, and replaces every occurrence with a deterministic tagged text block. Both adapters call it before their existing image conversion. Unknown merge-extensible blocks keep existing behavior.

- [ ] **Step 4: Verify GREEN**

Run the focused tests from Step 2 and typecheck the three LLM packages.

Expected: both adapters expose identical document text and preserve image behavior.

### Task 6: Generalize the composer and conversation UI

**Files:**
- Modify: `packages/client/ui-conversation/src/client/input/contract.ts`
- Modify: `packages/client/ui-conversation/src/client/input/machine.ts`
- Modify: `packages/client/ui-conversation/src/client/sessions/conversation.ts`
- Modify: `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`
- Modify: `packages/client/ui-conversation/src/client/contract/slots.ts`
- Modify: `packages/client/ui-attachment/src/client/ComposerAttachments.tsx`
- Create: `packages/client/ui-attachment/src/DocumentChip.tsx`
- Create: `packages/client/ui-attachment/src/DocumentChip.module.css`
- Modify: `packages/client/ui-attachment/src/client/MessageImages.tsx`
- Modify: `packages/client/ui-attachment/src/client/locales.ts`
- Modify: relevant client tests under both packages

- [ ] **Step 1: Write UI and state RED tests**

Cover mixed order, drag overlay, chooser accept list, atomic batch failure, document chip semantics, keyboard removal, image preview preservation, draft restore, send/clear, queue/steer, and localized unsupported/oversized/extraction errors.

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run packages/client/ui-attachment/tests packages/client/ui-conversation/tests/input-bar.client.spec.tsx packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx`

Expected: file drops are filtered through the current image-only path.

- [ ] **Step 3: Implement one ordered draft attachment union**

Generalize draft ids and controller storage without duplicating image and document state machines. Keep image lightbox behavior. Add file chips and pass document bytes only in the explicit prompt request.

- [ ] **Step 4: Verify GREEN and assembled snapshots**

Run: `pnpm run test:gui && DSH_SNAPSHOT=replay pnpm run test:web`

Expected: GUI and replay snapshots pass with intentional localized attachment updates.

### Task 7: Rename and simplify Memory & Learning

**Files:**
- Modify: `packages/client/ui-settings-brain/src/client/BrainSettingsSection.tsx`
- Modify: `packages/client/ui-settings-brain/src/client/BrainSettingsSection.module.css`
- Modify: `packages/client/ui-settings-brain/src/client/locales.ts`
- Modify: `packages/client/ui-settings-brain/tests/apply.client.spec.tsx`
- Modify: `packages/client/ui-settings-brain/README.md`
- Modify: `packages/client/ui-settings-brain/README.zh.md`
- Modify: `apps/desktop/desktop.cordis.patch.yml`
- Regenerate: affected Web snapshots and documentation catalogs

- [ ] **Step 1: Write visible-copy RED tests**

Assert `Memory & Learning` / `记忆与学习`, two real provider rows, a plain-language explanation, no visible `External Brain`, no provider ids/paths/raw errors, and unchanged pathless snapshot calls.

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run packages/client/ui-settings-brain/tests apps/desktop/tests/manifest.spec.ts`

Expected: current title and navigation still read External Brain / 外置大脑.

- [ ] **Step 3: Implement the presentation-only change**

Rename copy and reduce the compatibility detail to supporting text. Do not change Brain Hub interfaces, provider ordering, recall limits, injection text, database ownership, or failure behavior.

- [ ] **Step 4: Verify GREEN and regenerate derivatives**

Run focused tests, `pnpm run gen-tool-catalog`, the relevant snapshot refresh command, and translation pairing writes for edited pairs.

Expected: source and generated user-facing output use the new name while internal identifiers remain stable.

### Task 8: Document, package, and publish the branch

**Files:**
- Create: `.agents/notes/implemented/feature/2026-09-02-desktop-document-attachments-and-memory-learning.md`
- Create: Chinese counterpart and i18n record
- Modify: `PROJECT_CONTEXT.md`
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: release metadata only if all release-version gates require the next patch version

- [ ] **Step 1: Record the shipped decision and limitations**

Document durable document blocks, extraction limits, rejected formats, control-product absence, user-visible naming, and the distinct macOS/Windows evidence requirements. Do not claim legacy Office, arbitrary archives, raw provider files, or native Windows acceptance before it runs.

- [ ] **Step 2: Run focused and product verification**

Run attachment, Host, LLM, GUI, Brain, Desktop manifest/stage, snapshot replay, Host/Client/Desktop builds, scoped lint, documentation sync, dependency policy, and `git diff --check`.

Expected: every command exits `0`; any platform-skipped test is listed explicitly.

- [ ] **Step 3: Build and smoke macOS artifacts**

Run the official Desktop stage and isolated packaged smoke with a temporary `DSH_HOME`. Inspect `app.asar`, attachment extraction assets, settings navigation, and absence of control artifacts.

Expected: Intel macOS packaged smoke passes without touching the installed daily application or real user data.

- [ ] **Step 4: Commit and push**

Run the repository pre-push skill, commit coherent changes, push `codex/dsh-next-desktop`, and create a GitHub PR against `main`. Do not tag or publish a release asset until Windows native evidence exists for the same commit.

- [ ] **Step 5: Run Windows native CI from the identical commit**

Trigger the existing Windows workflow and require Setup build, isolated install, launch, document drag/drop scenario, settings label, process cleanup, uninstall, and user-data preservation.

Expected: Windows evidence identifies the exact pushed commit; failures remain open and are never represented by macOS or cross-compilation output.
