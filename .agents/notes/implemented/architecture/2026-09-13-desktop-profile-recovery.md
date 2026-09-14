# Agent Note: Native Desktop profile recovery

Status: implemented

English | [中文](2026-09-13-desktop-profile-recovery.zh.md)

## Problem

A Bundle loading failure can make the Web graph and its recovery controls unavailable. Recovery needs to preserve canonical configuration, package sources and data while distinguishing compatibility failures from user-disabled choices.

## Decision

Desktop retains canonical `web` as the installation and configuration source. Before launching the unchanged official CLI, the [composer](../../../../apps/desktop/src/compatibility/profile-composition.ts) excludes paused and user-disabled Bundles and publishes an owned `desktop-base` profile. It preserves Bundle order, original patch identities and the canonical reload preference. The effective profile uses `startup` reload; configuration changes require restart. The composer anchors inserted module names at their original file through the official overlay loader and serializes with the official include schema. Explicit canonical Bundle dependencies remain required. Unsupported dynamic, include, preset or excluded-module references enter native recovery instead of silently rewriting their meaning.

The [state store](../../../../apps/desktop/src/compatibility/plugin-state.ts) atomically separates user enablement from observed compatibility, preserves source/data pointers and requires current revisions for mutations. A configurable confirmation count accepts only attributable Bundle failure classes; unrelated provider and core failures never count. Runtime orchestration currently attributes parsed Bundle YAML failure after manifest discovery; an unreadable new manifest remains a configuration recovery case because its dependency identity cannot yet be verified. Restoration discovers the current package identity, validates the candidate Host while the normal Host is stopped, then consumes an opaque process-local receipt. Failed validation preserves the pause and manual choice.

A separate native recovery window exposes safe identities, choices and System Update without mounting the Web graph. IPC accepts only an identity, revision and closed action; paths, raw configuration, callbacks and validation receipts stay native. Mutation requires a native restart confirmation. The [application lifecycle](../../../../apps/desktop/src/application.ts) serializes the stopped-runtime operation with retry and quit, waits for accepted mutations during shutdown and prevents late startup after quit. The [ownership query](../../../../apps/desktop/src/harness/ownership.ts) recognizes both historical `dsh web` and current profile CLIs. Process observation is not a lock against later uncooperative CLI writers and cannot alone authorize archive storage maintenance.

## Alternatives considered

Editing canonical web to remove failing Bundles would change the CLI installation source. Deleting package sources or data would prevent explicit restoration. Recovery controls confined to the Web graph would be unavailable when that graph fails to load.

## Consequences

Canonical configuration, package code, plugin data and committed Session generations are not deleted or overwritten. An unowned effective directory, bad global input, stale state revision or unverified restore produces recovery rather than success. Managed state uses the existing atomic-write utility's rename semantics; it does not add fsync crash durability or protection against a malicious same-user process replacing ancestor directories. Persisted policy conflicts fail explicitly.

## Verification

Focused tests cover actual-file state persistence, cross-process concurrent revisions, failure attribution, restore races, stopped-runtime sequencing, quit during preparation, safe IPC projection and update availability despite plugin discovery failure. Composer tests exercise original-path YAML, exclusion before parsing, required dependencies and canonical-byte preservation with the pinned official APIs. Native assembled chat, legacy Session continuity, plugin disable/restore, candidate Host readiness and each platform's installation lifecycle remain separate required acceptance evidence.
