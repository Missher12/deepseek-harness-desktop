# Local External Brain 0.3.8 Implementation Plan

English | [中文](2026-08-24-local-external-brain-038.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship DeepSeek Harness Desktop 0.3.8 for Intel macOS and Windows x64 with one local Brain Hub, the Harness-native MSE provider, reversible reviewed-memory consolidation, and bundled read-only TencentDB compatibility.

**Architecture:** `@deepseek-ai/dsh-missher-brain@0.1.1-rc.2` owns one injection and budget path; `dsh-missher-memory@0.2.0` owns factual state, FTS5, capsules, and the legacy read-only reader; `dsh-missher-evolution@0.1.1` owns procedural learning. Desktop pins immutable provider archives, composes Brain before both providers, and produces both native installers from one public source commit.

**Tech Stack:** TypeScript, Cordis, React, Typert Remote, Node `worker_threads`, `node:sqlite`/FTS5, Vitest, Electron/electron-builder, GitHub Actions, PowerShell, macOS `hdiutil`.

---

## Repository and File Map

- Desktop repository: `/Users/missher/Documents/ChatGPT/Deepseek-Desktop`; implementation worktree: `.worktrees/external-brain-038` from public `origin/main` after the design commit lands.
- Memory repository: `/Users/missher/Documents/ChatGPT/Deepseek-Desktop/.worktrees/dsh-missher-memory-github`; implementation worktree sibling: `dsh-missher-memory-brain-020` from `origin/main` (`5c672a4` or newer).
- MSE repository: `/Users/missher/Documents/Missher Evolution System`; implementation worktree: `.worktrees/harness-brain-provider` from `codex/universal-agent-mse` (`43eb7d0` or its reviewed successor), never from the dirty primary worktree.
- Public MSE package repository: `/Users/missher/Documents/ChatGPT/Deepseek-Desktop/.worktrees/dsh-missher-evolution-public`; it receives only an allowlisted Harness package export, never Hermes, Feishu, credentials, runtime state, or personal configuration.
- Brain Hub lives in the public Desktop monorepo at `packages/brain/missher-brain/` as the workspace release member `@deepseek-ai/dsh-missher-brain@0.1.1-rc.2`.
- Memory schema, migration, FTS, consolidation, and TencentDB isolation stay in the standalone memory repository.
- Desktop composition, release metadata, packaging smoke, and native installers stay under `apps/desktop/` and `scripts/`.

### Task 1: Create the Brain Hub provider contract

**Files:**
- Create: `packages/brain/missher-brain/package.json`
- Create: `packages/brain/missher-brain/tsconfig.json`
- Create: `packages/brain/missher-brain/src/contracts.ts`
- Create: `packages/brain/missher-brain/src/registry.ts`
- Test: `packages/brain/missher-brain/tests/registry.spec.ts`

- [ ] **Step 1: Write the failing registry and lease tests**

```typescript
it('rejects duplicate provider ids and disposes registrations', () => {
  const registry = new BrainProviderRegistry()
  const dispose = registry.register(fakeProvider('memory'))
  expect(() => registry.register(fakeProvider('memory'))).toThrow('duplicate provider')
  dispose()
  expect(registry.list()).toEqual([])
})

it('accepts only selected contribution handles', async () => {
  const batch = fakeBatch(['m1', 'm2'])
  await batch.accept(['m2'])
  expect(batch.accepted()).toEqual(['m2'])
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm exec vitest run packages/brain/missher-brain/tests/registry.spec.ts`

Expected: FAIL because `BrainProviderRegistry` and the provider contract do not exist.

- [ ] **Step 3: Add the minimal versioned contract and registry**

```typescript
export type BrainContributionKind = 'reviewed-memory' | 'memory-capsule' | 'legacy-memory' | 'learned-rule'

export interface BrainContribution {
  handle: string
  providerId: string
  kind: BrainContributionKind
  text: string
  reference: string
  recordedAt: string
  score: number
  pinned: boolean
}

export interface PreparedBrainBatch {
  items: readonly BrainContribution[]
  accept(handles: readonly string[]): Promise<void>
  cancel(): Promise<void>
}

export interface BrainProvider {
  readonly protocolVersion: 1
  readonly id: string
  readonly byteBudget: number
  prepare(input: { projectKey: string; query: string; signal: AbortSignal }): Promise<PreparedBrainBatch>
  status(): Promise<{ state: 'ready' | 'disabled' | 'unavailable'; count: number }>
}
```

`BrainProviderRegistry.register()` rejects an empty ID, a second live registration with the same ID, protocol versions other than `1`, and budgets outside `1..6000`; its disposer removes only the exact registered object.

- [ ] **Step 4: Run tests and package checks**

Run: `pnpm exec vitest run packages/brain/missher-brain/tests/registry.spec.ts && pnpm --filter @deepseek-ai/dsh-missher-brain run typecheck`

Expected: all registry tests pass and strict TypeScript exits `0`.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/brain/missher-brain pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(brain): add provider contract"
```

### Task 2: Implement one fail-open Brain Hub injection path

**Files:**
- Create: `packages/brain/missher-brain/src/arbiter.ts`
- Create: `packages/brain/missher-brain/src/index.ts`
- Create: `packages/brain/missher-brain/src/injection.ts`
- Test: `packages/brain/missher-brain/tests/arbiter.spec.ts`
- Test: `packages/brain/missher-brain/tests/injection.spec.ts`

- [ ] **Step 1: Write failing arbitration and failure-isolation tests**

```typescript
it('keeps reviewed facts ahead of legacy duplicates and accepts selected handles only', async () => {
  const result = await arbitrate([reviewed('same', 'm1'), legacy('same', 't1'), activeRule('r1')], {
    maxItems: 6,
    maxBytes: 4000,
  })
  expect(result.items.map(item => item.handle)).toEqual(['m1', 'r1'])
})

it('returns the downstream decision when every provider times out', async () => {
  expect(await runPreStep({ providers: [neverProvider()], timeoutMs: 20 })).toEqual(downstreamDecision)
})
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `pnpm exec vitest run packages/brain/missher-brain/tests/arbiter.spec.ts packages/brain/missher-brain/tests/injection.spec.ts`

Expected: FAIL because arbitration and injection are absent.

- [ ] **Step 3: Implement deterministic budgets and a shared cancellation deadline**

```typescript
const KIND_PRIORITY: Record<BrainContributionKind, number> = {
  'reviewed-memory': 400,
  'memory-capsule': 350,
  'learned-rule': 300,
  'legacy-memory': 100,
}

export function rank(item: BrainContribution): number {
  return KIND_PRIORITY[item.kind] + item.score + Number(item.pinned) * 1000
}
```

The pre-step hook runs only for top-level direct-user first steps. It prepares providers concurrently under one `AbortController`, de-duplicates normalized text without mutating either store, selects at most six items/4,000 bytes, calls `accept()` only for selected handles, calls `cancel()` for unselected or abandoned batches, and catches every provider or formatting error before returning the original decision.

- [ ] **Step 4: Run focused tests and coverage**

Run: `pnpm exec vitest run packages/brain/missher-brain/tests --coverage.enabled --coverage.include=packages/brain/missher-brain/src/**`

Expected: all tests pass and new Host statements, branches, functions, and lines are `100%`.

- [ ] **Step 5: Commit the injector**

```bash
git add packages/brain/missher-brain
git commit -m "feat(brain): arbitrate local memory and rules"
```

### Task 3: Adapt and publish the Harness-native MSE provider

**Files:**
- Modify: `harness-plugin/src/adapter.ts`
- Create: `harness-plugin/src/brain-provider.ts`
- Modify: `harness-plugin/src/index.ts`
- Modify: `harness-plugin/src/client/index.ts`
- Modify: `harness-plugin/package.json`
- Create: `scripts/export_public_harness_plugin.mjs`
- Test: `harness-plugin/tests/brain-provider.spec.ts`
- Test: `harness-plugin/tests/public-export.spec.ts`

- [ ] **Step 1: Write failing single-use and feedback-isolation tests**

```typescript
it('does not accept a prepared rule until Brain Hub selects it', async () => {
  const batch = await provider.prepare(turnInput('direct user correction'))
  expect(store.auditByAction('rules_injected')).toHaveLength(0)
  await batch.accept([batch.items[0]!.handle])
  expect(store.auditByAction('rules_injected')).toHaveLength(1)
})

it('never learns recalled or maintenance text', async () => {
  await provider.observe(pluginMessage('missher-brain', 'recalled text'))
  await provider.observe(pluginMessage('missher-memory', 'maintenance text'))
  expect(store.captureCount()).toBe(0)
})
```

- [ ] **Step 2: Run the focused MSE tests and confirm RED**

Run: `pnpm --dir harness-plugin exec vitest run tests/brain-provider.spec.ts tests/public-export.spec.ts`

Expected: FAIL because provider preparation and the public export allowlist do not exist.

- [ ] **Step 3: Split preparation from acceptance and add the safe export**

`MseAdapter.prepareStep()` returns a single-use prepared rule without calling `acceptInjection`. `MseBrainProvider.accept()` calls `acceptInjection` exactly once for the selected opaque handle; `cancel()` disposes the prepared turn. Standalone `preStep()` uses the same provider and immediately accepts the item it injects, preserving current behavior when Brain Hub is absent.

The public export script copies only `harness-plugin/{src,tests,README*,LICENSE,package.json,tsconfig*.json,cordis.patch.yml}` plus the allowlisted embedded SDK sources required by the build. It exits non-zero if the output contains `Hermes`, `Feishu`, token-like values, runtime state, `.env`, Python hooks, Cron, Gateway files, databases, or install scripts.

- [ ] **Step 4: Run MSE regression and package verification**

Run: `pnpm --dir harness-plugin test && pnpm --dir harness-plugin run typecheck && pnpm --dir harness-plugin run build && pnpm --dir harness-plugin run pack && pnpm --dir harness-plugin run verify:package -- harness-plugin/dist/dsh-missher-evolution-0.1.1.tgz`

Expected: existing 103-or-newer tests plus the new provider/export tests pass; the package is version `0.1.1`, contains no install script or private runtime material, and its native smoke passes on macOS Intel, macOS Apple Silicon, and Windows x64 CI.

- [ ] **Step 5: Commit and publish immutable MSE 0.1.1**

```bash
git add harness-plugin scripts/export_public_harness_plugin.mjs PROJECT_CONTEXT.md
git commit -m "feat(harness): expose MSE brain provider"
```

Create the public allowlisted repository only after the export test passes, push a reviewed PR, tag `v0.1.1`, upload the canonical CI `.tgz` and LF/ASCII checksum, and anonymously re-download it before Desktop references the URL.

### Task 4: Move memory state to schema 2 and a serialized worker

**Files:**
- Create: `src/shared/state-protocol.ts`
- Create: `src/workers/state-runtime.ts`
- Create: `src/workers/state.worker.ts`
- Create: `src/host/state-worker.ts`
- Modify: `src/host/state-store.ts`
- Create: `src/host/state-schema.ts`
- Test: `tests/state-worker.spec.ts`
- Test: `tests/schema-migration.spec.ts`

- [ ] **Step 1: Write failing migration and worker-termination tests**

```typescript
it('migrates v1 atom rows without changing content or bindings', async () => {
  const before = await snapshotV1(databasePath)
  await store.open()
  expect(await snapshotV2(databasePath)).toMatchObject(before)
  expect(await pragmaUserVersion(databasePath)).toBe(2)
})

it('leaves the v1 database authoritative when migration is interrupted', async () => {
  await expect(openWithFault('after-backup')).resolves.toMatchObject({ status: 'incompatible-state' })
  expect(await pragmaUserVersion(databasePath)).toBe(1)
})
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm exec vitest run tests/state-worker.spec.ts tests/schema-migration.spec.ts`

Expected: FAIL because schema 2 and the state worker do not exist.

- [ ] **Step 3: Implement additive schema 2 migration through the worker**

```sql
ALTER TABLE approved_memories ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active';
CREATE TABLE memory_capsules (
  capsule_id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL REFERENCES projects(project_key) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  content TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE maintenance_runs (
  run_id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL REFERENCES projects(project_key) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  result TEXT NOT NULL,
  input_count INTEGER NOT NULL,
  output_count INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);
PRAGMA user_version = 2;
```

The proxy keeps the existing async `StateStore` API while all `DatabaseSync` operations execute in one terminating worker. Migration writes a `0600` backup before `BEGIN IMMEDIATE`, validates the key and v1 schema, performs the transaction, and restores authority to the untouched v1 file on any fault.

- [ ] **Step 4: Run full memory regression**

Run: `pnpm test && pnpm run typecheck && pnpm run build`

Expected: 100-or-newer existing tests and all new worker/migration tests pass; no test reads or writes the live `$DSH_HOME`.

- [ ] **Step 5: Commit schema 2**

```bash
git add src tests package.json PROJECT_CONTEXT.md
git commit -m "feat(memory): add reversible schema two state"
```

### Task 5: Add indexed recall and isolate bundled TencentDB compatibility

**Files:**
- Create: `src/workers/fts-index.ts`
- Modify: `src/host/approved-search.ts`
- Modify: `src/host/reader-worker.ts`
- Modify: `src/workers/sqlite-reader.worker.ts`
- Modify: `src/host/path-policy.ts`
- Test: `tests/fts-search.spec.ts`
- Test: `tests/tencentdb-isolation.spec.ts`
- Test: `tests/long-history.spec.ts`

- [ ] **Step 1: Write failing native FTS and byte-preservation tests**

```typescript
it('searches 50,000 mixed Chinese and English atoms under the p95 budget', async () => {
  const samples = await benchmarkSearch(seedAtoms(50_000), ['架构边界', 'retry policy'], 40)
  expect(percentile(samples, 95)).toBeLessThan(150)
})

it('never changes the legacy vectors database', async () => {
  const before = await sha256(vectorsDb)
  await searchLegacyAndRunMaintenance(vectorsDb)
  expect(await sha256(vectorsDb)).toBe(before)
})
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `pnpm exec vitest run tests/fts-search.spec.ts tests/tencentdb-isolation.spec.ts tests/long-history.spec.ts`

Expected: FAIL because approved-memory search still scans in process and the cross-operation preservation assertion is absent.

- [ ] **Step 3: Implement FTS5 and strict legacy-source separation**

Create an FTS5 table maintained transactionally for active atoms and capsules. Query normalization remains parameterized and rejects sensitive or malformed input. The legacy worker opens the exact resolved `vectors.db` with `{ readOnly: true, allowExtension: false }`, rejects root/database symlinks and containment failure, exposes only labeled recall rows, and has no mutation operation in its protocol.

Brain preparation de-duplicates legacy rows only in the returned batch. It never inserts them into FTS, candidates, capsules, MSE, exports, deletion, or reset. Current reviewed memory wins an exact duplicate; contradictions retain both labels and timestamps.

- [ ] **Step 4: Run performance, security, and full regression**

Run: `pnpm exec vitest run tests/fts-search.spec.ts tests/tencentdb-isolation.spec.ts tests/path-policy.spec.ts tests/query-policy.spec.ts tests/long-history.spec.ts && pnpm test`

Expected: FTS p95 is below 150 ms on the reference Intel Mac, path/SQL/symlink tests pass, the fixture database hash is unchanged, and the full suite is green.

- [ ] **Step 5: Commit indexed recall**

```bash
git add src tests README.md README.zh.md PROJECT_CONTEXT.md
git commit -m "feat(memory): index durable recall safely"
```

### Task 6: Implement reversible automatic consolidation

**Files:**
- Create: `src/host/consolidation-policy.ts`
- Create: `src/host/consolidation-service.ts`
- Create: `src/host/consolidation-validation.ts`
- Create: `src/workers/consolidation-runtime.ts`
- Modify: `src/index.ts`
- Test: `tests/consolidation.spec.ts`
- Test: `tests/consolidation-faults.spec.ts`

- [ ] **Step 1: Write failing eligibility, validation, and rollback tests**

```typescript
it('excludes pending, pinned, recent, cross-project, and incompatible-kind atoms', async () => {
  expect(selectEligible(fixtureAtoms(), policy)).toEqual(['old-project-progress-1', 'old-project-progress-2', 'old-project-progress-3', 'old-project-progress-4'])
})

it('rejects a capsule that invents an identifier', async () => {
  expect(validateCapsule({ content: 'Deploy commit deadbeef', sourceIds }, sources)).toEqual({ ok: false, reason: 'identifier-fidelity' })
})

it('rolls back by superseding the capsule and reactivating every source atom', async () => {
  await store.rollbackCapsule(capsuleId)
  expect(await store.capsuleState(capsuleId)).toBe('superseded')
  expect(await store.sourceStates(capsuleId)).toEqual(['active', 'active', 'active', 'active'])
})
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `pnpm exec vitest run tests/consolidation.spec.ts tests/consolidation-faults.spec.ts`

Expected: FAIL because policy, capsule validation, transactional commit, and rollback do not exist.

- [ ] **Step 3: Implement the bounded idle pipeline**

Eligibility requires reviewed active atoms, age at least seven days, four compatible sources, no pin, no sensitive text, one project/scope, and no unresolved conflict. One batch is capped at 24 atoms/12 KiB. Exact duplicates consolidate deterministically. Semantic consolidation uses the configured low-cost Harness route only while idle, validates opaque source IDs and identifier fidelity, then commits capsule plus source archival in one worker transaction.

Each project runs at most once per 24 hours unless the user requests `Consolidate now`. Timeout, malformed output, low battery, active conversation, lock contention, worker exit, or application shutdown records a fixed result category and leaves every source active.

- [ ] **Step 4: Run consolidation and package regression**

Run: `pnpm exec vitest run tests/consolidation.spec.ts tests/consolidation-faults.spec.ts --coverage.enabled && pnpm test && pnpm run verify:package -- dist/dsh-missher-memory-0.2.0.tgz`

Expected: all tests pass, new consolidation code reaches 100% focused coverage, and the package contains no database, state, secret, install script, or unlisted file.

- [ ] **Step 5: Commit and publish memory 0.2.0**

```bash
git add src tests package.json README.md README.zh.md PROJECT_CONTEXT.md
git commit -m "feat(memory): consolidate reviewed memory reversibly"
```

Push a PR to `Missher12/dsh-missher-memory`, require canonical CI on macOS Intel/Apple Silicon and Windows x64, tag `v0.2.0`, upload the canonical `.tgz` and LF/ASCII checksum, then anonymously verify exact bytes and SHA-256.

### Task 7: Build the unified External Brain Settings overview

**Files:**
- Create: `packages/brain/missher-brain/src/contracts.ts`
- Create: `packages/brain/missher-brain/src/index.ts`
- Create: `packages/client/ui-settings-brain/src/client/BrainSettingsSection.tsx`
- Create: `packages/client/ui-settings-brain/src/client/BrainSettingsSection.module.css`
- Create: `packages/client/ui-settings-brain/src/client/index.ts`
- Create: `packages/client/ui-settings-brain/src/client/locales.ts`
- Test: `packages/client/ui-settings-brain/tests/components.client.spec.tsx`
- Test: `packages/client/ui-settings-brain/tests/apply.client.spec.tsx`

- [ ] **Step 1: Write failing UI state and accessibility tests**

```tsx
it('shows stable placeholders before provider counts arrive', () => {
  render(<BrainSection remote={deferredRemote()} />)
  expect(screen.getByRole('heading', { name: '外置大脑' })).toBeVisible()
  expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  expect(screen.queryByText('加载中')).toBeNull()
})

it('replaces placeholders with bounded pathless provider counts', async () => {
  render(<BrainSettingsSection load={resolvedSnapshot()} />)
  expect(await screen.findByText('2 条记忆')).toBeVisible()
  expect(screen.queryByText('/Users/example/project')).toBeNull()
})
```

- [ ] **Step 2: Run Client tests and confirm RED**

Run: `pnpm exec vitest run packages/client/ui-settings-brain/tests/components.client.spec.tsx packages/client/ui-settings-brain/tests/apply.client.spec.tsx`

Expected: FAIL because the page, Remote, and disclosure do not exist.

- [ ] **Step 3: Implement the managed Settings page and provider panels**

The Brain Settings Client registers one `settings.section` entry. Memory and MSE keep their existing provider-owned controls, while the overview reads one bounded Brain Remote snapshot containing pathless status and counts only.

The page follows the shared Settings measure and title/intro/subsection typography. It paints stable placeholders immediately, then refreshes without exposing filesystem paths, database names, local keys, raw session IDs, or provider errors.

- [ ] **Step 4: Run Client tests, snapshots, and visual smoke**

Run: `pnpm exec vitest run packages/brain/missher-brain/tests packages/client/ui-settings-general/tests/settings-root.client.spec.tsx && pnpm run build:client`

Expected: all tests pass; light/dark and 760/640 px browser snapshots have no overflow, duplicate Settings entries, layout shift, or inaccessible controls.

- [ ] **Step 5: Commit the product surface**

```bash
git add packages/brain/missher-brain packages/client apps/web/tests/snapshots
git commit -m "feat(brain): add unified external brain controls"
```

### Task 8: Integrate, validate, and publish Desktop 0.3.8 for Mac and Windows

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/desktop.cordis.patch.yml`
- Modify: `apps/desktop/update-metadata.json`
- Modify: `apps/desktop/tests/manifest.spec.ts`
- Modify: `apps/desktop/tests/packaged-smoke.ts`
- Modify: `scripts/stage-desktop.ts`
- Modify: `scripts/windows-desktop-setup-smoke.ps1`
- Modify: `PROJECT_CONTEXT.md`
- Test: `apps/desktop/tests/packaged-smoke.spec.ts`

- [ ] **Step 1: Write failing immutable-composition and native-smoke assertions**

```typescript
expect(desktop.version).toBe('0.3.8')
expect(desktop.dependencies['@deepseek-ai/dsh-missher-brain']).toBe('workspace:^')
expect(desktop.dependencies['dsh-missher-memory']).toMatch(/0\.2\.0\.tgz$/)
expect(desktop.dependencies['dsh-missher-evolution']).toMatch(/0\.1\.1\.tgz$/)
expect(compositionOrder).toEqual(['missher-brain', 'missher-memory', 'missher-evolution'])
```

The packaged smoke must also assert one combined injection, no duplicate provider sections, reversible capsule consolidation, MSE rule progression, a missing-TencentDB fresh install, an attached fixture database with unchanged SHA-256, clean exit/uninstall, and preserved isolated state.

- [ ] **Step 2: Run manifest and staging tests and confirm RED**

Run: `pnpm exec vitest run apps/desktop/tests/manifest.spec.ts scripts/stage-desktop.spec.ts apps/desktop/tests/packaged-smoke.spec.ts`

Expected: FAIL on version `0.3.7`, absent Brain/MSE dependencies, old memory version, and missing smoke assertions.

- [ ] **Step 3: Pin canonical plugin archives and compose 0.3.8**

Update `package.json` and the lockfile only after each public plugin archive passed anonymous byte verification. Insert Brain before memory and evolution, enable managed UI for both providers, keep TencentDB optional/read-only, set Desktop/update metadata to `0.3.8`, and make staging reject any archive whose package version, integrity, or expected files differ.

- [ ] **Step 4: Run source, package, and native release gates**

Run locally on Intel macOS:

```bash
pnpm test
pnpm run typecheck
pnpm run build:host
pnpm run build:client
pnpm run build:web
pnpm run doc-sync
pnpm desktop:dmg
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts
hdiutil verify apps/desktop/release/DeepSeek-Harness-0.3.8-mac-x64.dmg
```

Run the Windows `workflow_dispatch` from the exact public merge commit. It must build the visible per-user Setup, install shortcuts, launch the packaged app, exercise External Brain/Memory/Consolidation/Learning, verify the read-only fixture hash and fresh-install absence case, close without orphan processes, uninstall, and preserve isolated `DSH_HOME` plus Electron data.

- [ ] **Step 5: Commit, merge, install, and publish 0.3.8**

```bash
git add apps/desktop packages/brain scripts PROJECT_CONTEXT.md pnpm-lock.yaml
git commit -m "feat(desktop): ship local external brain 0.3.8"
```

Push a PR, require all static/coverage/snapshot/native checks, squash merge, and record the merge SHA. Rebuild Mac from the merge-equivalent tree, recoverably replace `/Applications/DeepSeek Harness.app`, and prove live `~/.dsh` preservation before and after installation. Create `desktop-v0.3.8`, upload Mac DMG/checksum and Windows Setup/checksum without clobbering either platform, then re-query asset IDs/state/size/digests and anonymously re-download every asset for SHA-256 and byte equality. Update `PROJECT_CONTEXT.md` with final evidence in a docs-only follow-up commit.

## Plan Completion Gate

- [ ] Brain Hub `0.1.0`, MSE `0.1.1`, and Memory `0.2.0` are immutable public artifacts with checksums and native consumer evidence.
- [ ] TencentDB compatibility code is installed on both platforms while every real/fixture database remains external and byte-identical.
- [ ] Only reviewed local memory is consolidated; sources remain recoverable; MSE receives no recalled or legacy content.
- [ ] Mac Intel and Windows x64 packages come from one public 0.3.8 source commit and pass real installation lifecycle acceptance.
- [ ] Public downloads match the tested artifacts, and replacing/uninstalling the app preserves user data.
