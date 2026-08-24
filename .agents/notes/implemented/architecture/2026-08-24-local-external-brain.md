# Agent Note: Local External Brain Provider Hub

Status: implemented

English | [中文](2026-08-24-local-external-brain.zh.md)

## Problem

Long-running projects need reviewed factual memory and reusable working rules, but independent plugins that inject both sources directly can duplicate text, exceed a predictable context budget, and accidentally treat recalled material as new learning evidence. A compatibility reader for an older TencentDB database also needs to remain optional and read-only instead of making fresh Desktop installations depend on user data outside the application.

## Decision

Desktop loads `@deepseek-ai/dsh-missher-brain` before `dsh-missher-memory` and `dsh-missher-evolution`. Brain owns the only automatic external-context injection listener and a provider registry; Memory and Evolution require that service and never create a fallback injection listener. Eligible recall runs only on the first step of a top-level direct-user turn with a working directory, derives a pathless SHA-256 project key, and selects at most six contributions and 4,000 UTF-8 bytes under one 150 ms deadline. Provider timeout, malformed output, acceptance failure, or cleanup failure preserves the original downstream decision.

Memory owns reviewed project facts, schema-2 FTS5 search, and deterministic consolidation of at least four old unpinned exact duplicates. Consolidation commits one extractive capsule, archives rather than deletes its source atoms, records source identifiers and a checksum, and supports transactional rollback that restores the sources and their FTS rows. The package includes a fixed-query `node:sqlite` TencentDB compatibility reader, but Desktop packages no database; the reader opens only an explicitly selected contained `vectors.db` read-only, rejects symlink and extension-loading paths, and never supplies MSE evidence.

Evolution owns procedural Candidate, Trial, and Active rules and records use only after Brain accepts the selected single-use handles. It observes direct top-level outcomes rather than recalled Memory text, Brain context, maintenance work, subagents, or raw tool output. The Harness package excludes Hermes, Python, Feishu, Cron, and Gateway runtimes.

The Settings summary reads one pathless Brain snapshot. It shows stable placeholder rows before the Remote response and exposes provider availability, bounded counts, and the fixed recall limits without database paths, project paths, rule text, memory text, or provider errors.

## Alternatives considered

- **Let Memory and MSE inject independently** — rejected because separate listeners cannot enforce one total byte budget or transactional attribution, and recalled material can become self-reinforcing learning evidence.
- **Merge facts, rules, and compatibility data into one database and plugin** — rejected because factual recall and procedural learning have different evidence and lifecycle rules, while the legacy database must remain user-owned and read-only.
- **Package a TencentDB database or service with Desktop** — rejected because a fresh installation needs no legacy data, packaging user state would violate ownership and privacy, and the fixed local SQLite reader is sufficient for compatibility.
- **Use model-generated semantic compression in the default maintenance path** — rejected for this release because deterministic exact-duplicate extraction is reversible, cannot invent facts, and remains available without credentials or network access.

## Consequences

Desktop gains one bounded and inspectable context path, independently owned Memory and Evolution state, reversible local compression, and optional legacy recall without coupling normal chat to background work. Memory and Evolution 0.2.0 and 0.1.1 require Desktop's Brain service and are not standalone injectors. Exact-duplicate consolidation does not merge paraphrases, and project identity intentionally treats different absolute or symlink spellings as different projects. All three managed components appear in Plugin Market, while their data remains outside the application bundle and survives application replacement or uninstall.
