# Local External Brain Design

English | [中文](2026-08-24-local-external-brain-design.zh.md)

**Date:** 2026-08-24

**Status:** Approved for implementation

**Target:** DeepSeek Harness Desktop 0.3.8, Intel macOS and Windows x64

## Goal

Build a durable, entirely local external brain for very long projects. The system must remember project facts across sessions, consolidate repeated reviewed memories into compact and reversible knowledge capsules, and learn reusable working behavior through Missher Evolution System (MSE). It must remain useful after tens of thousands of memories without turning recalled text into self-reinforcing instructions or making the normal Harness request path depend on background maintenance.

This delivery does not connect Obsidian or any remote knowledge base. It packages the TencentDB compatibility reader as an optional local legacy source, but never packages a user's `vectors.db` or other live data. It preserves independently upgradeable Harness bundles rather than merging memory, learning, and Desktop into one fork.

## Product Decisions

- `dsh-missher-memory` owns factual and episodic project memory.
- `dsh-missher-evolution` owns procedural rules: preferences, successful methods, failure avoidance, and Candidate -> Trial -> Active progression.
- A new `@deepseek-ai/dsh-missher-brain` bundle coordinates retrieval, injection budgets, source presentation, and the unified Settings surface. It owns no project facts or MSE rules.
- Only reviewed memories are eligible for semantic consolidation. Pending candidates may be deterministically de-duplicated, but are never automatically approved.
- Automatic consolidation is enabled for newly bound projects. It runs only while idle, is bounded, and fails open.
- Consolidation is cognitive compression, not destructive disk compression: original reviewed atoms remain archived and traceable until the user explicitly removes them.
- Pinned memories are immutable to automatic maintenance.
- MSE never learns from recalled memory, injected rules, subagents, maintenance sessions, or raw tool output.
- The Desktop package includes the TencentDB read-only compatibility code. Existing TencentDB data remains outside the application bundle, is never required on a fresh install, and is never written, migrated, consolidated, or learned from.
- No component persists full raw conversations. Existing bounded capture and privacy rejection remain authoritative.

## Architecture

The Desktop composition bundles three independently releasable packages:

1. **Brain Hub (`@deepseek-ai/dsh-missher-brain`)**
   - Registers the single top-level `agent/pre-step` injector in managed Desktop composition.
   - Provides a small provider registry and requests bounded contributions in parallel.
   - Enforces one total byte/item budget, provider timeouts, trust labels, ordering, and source metadata.
   - Exposes the unified `External Brain` Settings page and per-turn recall disclosure.
   - Persists only user-modified coordination settings under `$DSH_HOME/missher-brain`; defaults remain zero-write.

2. **Memory Provider (`dsh-missher-memory`)**
   - Keeps project binding, capture, candidate review, approved memories, privacy filtering, export, forget, and recall.
   - Adds schema-2 indexed search, memory capsules, maintenance runs, reversible archive state, and migration history.
   - Ships its existing isolated `node:sqlite` TencentDB reader and worker in the same immutable package, so Desktop requires no separate compatibility installation.
   - Registers with Brain Hub when available. When installed without Brain Hub, it retains its current standalone recall hook and Settings page.

3. **Evolution Provider (`dsh-missher-evolution`)**
   - Keeps its independent `$DSH_HOME/missher-evolution` state, audit, locks, maintenance, and Candidate -> Trial -> Active lifecycle.
   - Contributes only prepared procedural rules to Brain Hub. Brain Hub confirms exactly which rules were injected before MSE records accepted injection evidence.
   - Retains its current standalone injection and Settings page when Brain Hub is absent.

Desktop starts Brain Hub before the two providers. A provider negotiates managed or standalone mode exactly once during startup, which prevents duplicate injection. A missing or failed provider reduces available context but cannot reject or delay the original model decision beyond the configured timeout.

## Provider Contract and Turn Flow

Each provider implements a versioned contract with four bounded operations:

- `status()` returns pathless health and counts suitable for Settings.
- `prepare(query, project, signal, budget)` returns immutable contribution handles, display-safe source metadata, and text.
- `accept(handles)` records only the contributions actually selected by Brain Hub.
- `cancel(handles)` releases prepared state without recording use.

On a top-level direct-user turn, Brain Hub derives the already-bound project identity and requests memory and MSE contributions concurrently. It rejects cross-project material, expired prepared handles, sensitive output, over-budget content, and any contribution marked as a command from an untrusted source. Ranking then prefers pinned reviewed facts, relevant active capsules, verified Active MSE rules, Trial rules, and individual reviewed atoms in that order, while still applying relevance and freshness.

The default combined injection limit is six contributions and 4,000 UTF-8 bytes: up to 3,000 bytes of factual memory and 1,000 bytes of procedural rules. The hard limit is eight contributions and 6,000 bytes. Provider work shares one cancellation deadline; timeout or failure returns the original downstream decision unchanged.

Injected context is separated into `Reviewed project memory` and `Learned working rules`. Every visible item carries its stable local reference and recorded time. These blocks are background context, not user or system commands. Subagents, delegated sessions, internal maintenance, and non-first steps receive no automatic external-brain injection.

## Durable Memory Model

The existing candidates remain the review inbox. Existing approved memories become immutable source atoms with project, scope, kind, content, source candidate IDs, pin state, timestamps, and lifecycle state (`active`, `archived`, or `forgotten`). Schema 2 adds:

- `memory_capsules`: versioned summaries with project, scope, topic key, kind, source atom IDs, status, checksum, timestamps, and consolidation policy version.
- `memory_fts`: an FTS5 index over active atoms and capsules; the shipped macOS and Windows runtimes must prove FTS5 support. Chinese and mixed-language lookup use a tokenizer configuration validated by native fixtures.
- `maintenance_runs`: start/end time, trigger, bounded counts, result category, and rollback reference without memory text.
- `schema_migrations`: applied migration version and timestamp.

The v1 -> v2 migration first creates a user-private backup, validates the local key, then applies one transaction. A failure leaves v1 state authoritative and disables only new external-brain capabilities. Neither migration nor installation deletes candidates, approved memories, project bindings, or legacy optional-source bindings.

## Bundled TencentDB Compatibility

The memory package contains all code needed to inspect and query a compatible existing TencentDB `vectors.db`; macOS and Windows installers therefore need no external runtime, service, script, or post-install command. The database itself is user data and never enters the signed application, Setup payload, Git repository, logs, tests, or release artifact.

On a fresh machine, the compatibility source reports `not connected (optional)` and the built-in project memory remains fully functional. An existing source is attached only through the current explicit override or a future native directory selection that resolves an absolute real directory. The reader rejects root/database symlinks, path escape, extension loading, arbitrary SQL, writes, schema mismatch, and unsafe permissions. It opens the exact database read-only in a terminating worker with a bounded timeout.

TencentDB results participate only in recall as a separately labeled `legacy memory` source. Brain Hub may suppress an exact or near-duplicate result for the current turn, but it does not merge, copy, update, or delete either store. Current-project reviewed memory ranks above a legacy match; a contradiction remains visible with both source labels and times. TencentDB rows never enter candidate capture, schema-2 FTS, automatic consolidation, MSE evidence, export, project deletion, or reset.

## Automatic Consolidation

Consolidation runs per project after seven idle days for eligible atoms, or when active reviewed memory exceeds 64 items or 96 KiB. A project runs at most once per 24 hours unless the user selects `Consolidate now`. One batch contains at most 24 same-project, same-scope, compatible-kind atoms and 12 KiB of input.

The pipeline is:

1. Normalize and collapse exact duplicates deterministically.
2. Build bounded lexical similarity groups; never mix projects, personal/project scope, or incompatible kinds.
3. Exclude pinned, recently edited, sensitive, already superseded, and unresolved-conflict atoms.
4. Ask the configured low-cost Harness model for a concise capsule only when at least four compatible atoms remain. If no model is available, exact de-duplication still completes and semantic consolidation is deferred.
5. Validate output length, UTF-8, privacy, source IDs, project/scope equality, and identifier fidelity. New numbers, paths, hashes, URLs, and code identifiers absent from every source reject the capsule.
6. Commit the capsule and archive its source atoms in one transaction. Source atoms are retained and can be expanded, exported, or restored.

The model never receives credentials, absolute project paths, raw tool output, pending candidates, or full sessions. It receives only bounded reviewed atom text and opaque source IDs. A rejected, timed-out, or malformed result records a fixed failure category and leaves all source atoms active.

Rollback supersedes the capsule and reactivates its source atoms atomically. Deleting a capsule never deletes its source atoms. Physical purging of archived sources is not automatic and remains a separate explicit destructive operation outside this delivery.

## MSE Integration and Feedback Isolation

Desktop bundles the reviewed MSE Harness package as an app-owned fallback while still allowing a newer profile installation to shadow it. Removing a marketplace-installed update falls back to the Desktop copy and does not remove MSE state.

This is the Harness-native MSE edition: a TypeScript/Cordis adapter using Harness lifecycle events and Harness-local state. It does not load the Hermes Python plugin, Feishu notifications, Cron, Gateway, or Hermes runtime state.

MSE observes direct top-level user prompts, committed assistant outcomes, top-level tool result categories, and explicit user corrections. It does not receive Brain Hub context as user text. Prepared rules are single-use and accepted only after Brain Hub includes them in the final budget. Maintenance, health checks, MSE diagnostics, background consolidation, recalled memory, and nested agents are permanently excluded from learning.

Factual memory and procedural rules never copy records into each other's stores. A project decision remains memory; a repeated working method may become an MSE rule only from independent direct-turn evidence. This boundary prevents a recalled statement from being re-learned as a stronger rule.

## User Experience

Settings replaces the managed Desktop `Project Memory` and `Evolution` entries with one `External Brain` page while standalone plugin installs keep their original pages. The unified page uses the existing Settings geometry and contains:

- **Overview:** current project, Brain Hub health, memory/MSE health, optional legacy-source status, active counts, last successful consolidation, and storage size.
- **Memory:** capture and recall controls, pending review inbox, approved atoms, capsules, pin/forget actions, and source expansion.
- **Consolidation:** enablement, thresholds, last run, fixed failure category, `Consolidate now`, run history, and capsule rollback.
- **Learning:** MSE enablement and Candidate/Trial/Active counts, transitions, pause/retire actions, and last maintenance status.
- **Data:** project export, backup status, project deletion, and explicit state reset boundaries.

Each assistant turn that used the external brain shows a compact disclosure such as `2 memories · 1 learned rule`. Expanding it reveals the injected text, source type, local reference, and recorded time. It never reveals filesystem paths, state-database paths, local keys, or raw session identifiers.

## Performance and Resource Limits

- Cached preparation should add no more than 50 ms at p95 on the release reference machine.
- Cold provider work is bounded by the existing 1.5-second fail-open deadline and never starts consolidation.
- SQLite mutation and consolidation execute through a serialized worker boundary, not the renderer or the main model event loop.
- Maintenance pauses on active conversation work, low battery when detectable, application shutdown, database contention, or an existing provider lock.
- A 50,000-atom fixture must keep indexed search under 150 ms at p95 and bounded memory use on Intel macOS and Windows x64 CI/reference runners.
- Startup reads only schema metadata and small counts. Full history and FTS pages load on demand with stable placeholders before data arrives.

## Failure, Privacy, and Recovery

All three bundles fail open for chat. Corrupt, incompatible, locked, or unsafe state is shown as a pathless diagnostic and does not trigger automatic reset. Symlinked state roots/databases, path escape, extension loading, arbitrary SQL, cross-project queries, and renderer credential access remain forbidden.

The privacy filter runs before candidate persistence, before consolidation input, after consolidation output, and before recall injection. Audit records contain fixed action classes, opaque references, counts, durations, and result categories, never prompts, memory text, rules, credentials, or absolute paths.

Uninstall preserves `$DSH_HOME/missher-brain`, `$DSH_HOME/missher-memory`, `$DSH_HOME/missher-evolution`, sessions, credentials, and unrelated plugin state. Reset and project deletion remain explicit stopped-writer operations with backup and confirmation requirements.

## Delivery Stages

1. **Foundation:** publish and bundle the reviewed MSE package; add the versioned Brain Hub provider contract, managed/standalone negotiation, unified budget, and no-double-injection tests without changing memory schema.
2. **Durable consolidation:** migrate memory state to schema 2, add FTS5, capsules, the idle worker, validation, backup, rollback, and long-history tests.
3. **Product integration:** ship the unified Settings page, per-turn disclosure, marketplace fallback behavior, upgrade/migration UX, and native Desktop packages from one source commit.

Each stage must remain independently releasable and preserve current 0.3.7 behavior when its new capability is disabled.

## Verification

Focused tests cover provider negotiation, duplicate-injection prevention, shared cancellation, budget arbitration, cross-project rejection, subagent exclusion, MSE single-use acceptance, recall-not-learning isolation, schema migration and rollback, exact de-duplication, capsule validation, pinned exclusions, conflict handling, audit redaction, and failure-open behavior.

Property and fault tests cover interrupted migration, worker termination, lock contention, malformed model output, sensitive strings, FTS query abuse, large projects, repeated consolidation, and rollback idempotency. Package verification rejects install scripts, bundled state, databases, secrets, source maps containing state samples, and undeclared files.

Native Intel macOS and Windows x64 acceptance installs the same immutable plugin artifacts into isolated `DSH_HOME` roots, binds a project, captures and approves fixtures, consolidates and rolls back a capsule, advances an MSE rule, proves one combined injection with visible sources, restarts, upgrades, uninstalls, and verifies state preservation. Public release assets require exact size, SHA-256, uploaded state, and anonymous re-download equality without replacing unrelated platform assets.

Compatibility acceptance additionally uses a fixture `vectors.db` to prove read-only opening, bounded search, source labels, duplicate suppression, contradiction presentation, timeout termination, and byte-identical database content before and after install, recall, consolidation, reset, upgrade, and uninstall. A second fresh-install fixture contains no TencentDB directory and must show a healthy built-in brain without creating one.

## Out of Scope

Obsidian, remote knowledge bases, cloud synchronization, writing or migrating TencentDB, packaging any live database, new embeddings or hosted vector databases, automatic candidate approval, automatic deletion of source atoms, cross-project recall without explicit binding, model fine-tuning, automatic source-code modification, sharing live state with Hermes MSE, and changing official Harness session formats are outside this delivery.
