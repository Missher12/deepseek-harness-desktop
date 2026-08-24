# Agent Note: Local External Brain Provider Hub

Status: proposed

English | [中文](2026-08-24-local-external-brain.zh.md)

## Problem

Desktop already ships a reviewed-memory plugin with an optional read-only TencentDB-compatible source, while the Harness-native Missher Evolution System owns procedural rules. If both plugins inject independently, provider completion order can change prompt order, duplicated facts consume context twice, one stalled provider can delay the conversation, and a provider may mark an item used even when another listener rejects the step. Combining their databases instead would erase the different review, lifecycle, deletion, and learning guarantees each source owns.

The existing [Desktop personalization, billing, and memory decision](../../../implemented/feature/2026-08-24-desktop-personalization-billing-memory.md) remains authoritative for reviewed-memory capture and TencentDB's read-only boundary. This proposal extends composition and injection; it does not supersede that decision.

## Proposal

Desktop 0.3.8 will compose `dsh-missher-brain@0.1.0` before `dsh-missher-memory@0.2.0` and `dsh-missher-evolution@0.1.1`. Brain Hub exposes one versioned provider contract and owns the only external-brain `agent/pre-step` listener. Memory owns factual candidates, FTS recall, reversible capsules, and the bundled compatibility reader. Evolution owns Candidate-to-Trial-to-Active procedural learning. Neither provider reads or writes the other's state.

Providers prepare opaque candidates without side effects. The hub validates live provider identity, version, and budget; ranks pinned and reviewed current memory before capsules, active rules, and legacy recall; suppresses exact normalized duplicates; and selects no more than six records or 4,000 complete rendered UTF-8 bytes. The hub accepts only selected opaque handles and cancels abandoned batches. Provider errors, deadlines, cancellation, acceptance failure, and cleanup failure return the exact downstream decision.

Recall runs only for the first step of a top-level direct-user turn with a project working directory. The provider receives a pathless project hash rather than the raw directory. The injected message labels every item by source, reference, and timestamp inside an untrusted background block. Durable subagent children never receive automatic recall, and MSE never observes recalled, legacy, consolidation, or other plugin-generated context as training input.

## State and maintenance boundaries

Memory schema 2 will retain approved atoms, capsules, capsule-to-source links, and maintenance history in the plugin's isolated state database. Automatic consolidation considers only old reviewed active atoms from one project, scope, and compatible kind. Pinned, recent, pending, sensitive, conflicted, and legacy TencentDB rows are ineligible. A successful capsule archives rather than deletes its source atoms in the same transaction; rollback supersedes the capsule and reactivates every source.

The compatibility reader code ships in both native installers, but `vectors.db` never does. It opens only an explicitly attached external database in read-only mode, rejects symlink or containment escape, does not load extensions, and exposes no mutation protocol. Fresh installs work without TencentDB.

## Alternatives considered

**Let memory and MSE keep separate pre-step listeners.** Rejected because listener order, duplicate budgets, side-effect timing, and failure containment would become provider-specific and could diverge across updates.

**Merge factual memory, legacy vectors, and learned rules into one database.** Rejected because factual review, read-only compatibility, and procedural promotion have different authorities and deletion semantics. A shared database would make isolation and rollback harder to prove.

**Fork the Harness core.** Rejected because the provider registry, waterfall listener, settings section, and immutable Desktop composition are sufficient extension points. A core fork would make upstream updates materially harder without adding a required capability.

**Package a live TencentDB database or migrate it during installation.** Rejected because personal data must not enter a public artifact, and installation must not mutate an independently owned source.

**Connect Obsidian or a remote knowledge service.** Rejected for this version because the user selected a local external brain. Remote synchronization, authentication, and knowledge-base authority would widen the trust boundary.

## Acceptance criteria

- Brain Hub rejects invalid and duplicate providers, removes only the exact registration, uses deterministic complete-byte arbitration, and reaches 100% focused Host coverage.
- Timeout, abort, malformed candidates, acceptance failure, cancellation failure, and absent providers leave the original conversation decision unchanged.
- Memory migrations are additive and recoverable; consolidation is bounded, transactional, source-preserving, and reversible.
- TencentDB fixtures and any explicitly inspected real source remain byte-identical before and after search and maintenance; fresh install needs no source database.
- MSE learns only direct eligible feedback and never recalled or maintenance text.
- Mac Intel and Windows x64 installers come from one public Desktop 0.3.8 commit, pass native installation lifecycle smoke, and preserve isolated user state.

## Risks

The external-brain context can reduce prefix-cache reuse on recalled turns, and automatic consolidation can lose nuance even when it preserves source links. Complete byte limits, explicit source disclosure, strict eligibility, capsule validation, archival instead of deletion, and one-click rollback bound those costs. A 150 ms provider deadline may omit useful context on a slow disk; fail-open conversation continuity is preferred to waiting or injecting late state.
