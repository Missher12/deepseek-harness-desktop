# Agent Note: Desktop personalization, live billing facts, and reviewed memory

Status: implemented

English | [中文](2026-08-24-desktop-personalization-billing-memory.zh.md)

## Problem

Desktop users had no application-owned place to define guidance for every chat. The conversation footer estimated costs from a stale provider snapshot and could not show the official account balance or change the displayed DeepSeek price tier when Beijing time crossed a tariff boundary. Long projects also needed bounded continuity, but a bundled memory dependency would be invisible in the market because the market normally derives its installed list only from the mutable profile manifest.

These gaps could not be closed by writing arbitrary user files or silently installing a profile plugin: both approaches would blur ownership, make updates fragile, and risk treating collected text as approved memory.

## Decision

The first-class `personalization` Settings section reads and writes only a marked Desktop-owned block in the fixed `$DSH_HOME/AGENTS.md` file. The browser supplies instructions, reply style, and an expected revision, never a path. Host storage rejects malformed or symbolic-link targets, reserved markers, NUL, stale revisions, and content above 48 KiB; it preserves every byte outside the managed block and replaces the file atomically with owner-only permissions. The existing agent-instructions loader applies the result from the next request. Project-local `AGENTS.md` remains the narrower authority.

DeepSeek pricing remains a local estimate over settled token usage, but its tariff decision is recalculated from current Beijing time and the footer refreshes at minute boundaries. The direct DeepSeek adapter exposes the official balance endpoint through the same credential and base-URL boundary as model requests. Exact balance is independent of the tier-estimate preference: disabling estimates hides estimated cost and tariff text while keeping the provider-reported balance. Failure to fetch balance is explicit and never rendered as zero.

Desktop pins the reviewed `dsh-missher-memory@0.1.1` release archive as an application dependency and inserts it through the immutable Desktop composition. Newly approved project bindings default candidate capture and bounded recall on. Unbound projects remain inert, capture creates pending review candidates rather than searchable memories, and the external TencentDB-compatible source is read-only.

`dshmarket@1.10.1` gains a Desktop-scoped `builtins` configuration. Built-ins are merged into registry and installed responses for presentation only; the mutable profile manifest is not changed. They are returned in a protected-name set, excluded from groups and bulk updates, and rejected before toggle, update, repair, or uninstall package operations. A profile-local dependency with the same name still wins in the runtime loader, preserving an independent future upgrade path.

## Security and ownership

Personalization owns one delimited block, not the entire global instructions document. Balance transport stays Host-side and never exposes credentials. Memory does not create `state.db` merely because Settings is opened, does not search across an unbound project, and does not approve captured content automatically. The marketplace is a view and control plane for the built-in; it does not become the owner of the application dependency.

## Alternatives considered

**Write the whole global `AGENTS.md` from the browser.** Rejected because it could overwrite hand-maintained instructions and would let browser input choose or redirect a sensitive filesystem path.

**Show a cached tariff label until the next model request.** Rejected because the footer would become false at weekday tariff boundaries even though no usage fact had changed.

**Display a derived or user-entered balance.** Rejected because only the official provider endpoint is account truth; a failed request must remain unavailable rather than become an invented number.

**Silently add the memory package to the user's profile.** Rejected because application ownership would mutate user configuration, uninstall would become ambiguous, and a broken profile operation could prevent boot.

**Hard-code the memory plugin into the public community snapshot.** Rejected because the curated registry has its own age and history requirements. Desktop therefore exposes an explicitly attributed built-in without pretending that it has already passed the community catalog's independent admission process.

**Auto-approve captured memory.** Rejected because tool output, transient mistakes, and injected text must not become durable trusted context without review.

## Consequences

Desktop 0.3.6 gains global guidance, truthful live billing facts, and a default-on but review-gated long-project memory path on both supported platforms. The built-in memory card is visible and protected in Plugin Market without polluting the profile, and a later profile-local package can shadow the fallback.

The application now owns the compatibility of one external release archive and a bounded marketplace patch until the community registry can list the plugin normally. Balance availability still depends on the configured official DeepSeek credential and endpoint. Estimated cost remains an estimate, while the separately labeled balance is provider truth.

## Verification

Host tests cover personalization parsing, byte preservation, revisions, path safety, permissions, and atomic writes. Client tests cover stable loading geometry, editing, style selection, byte limits, and save failures. Billing tests cover official prices, current Beijing tariff boundaries, minute refresh, balance transport, and failure labels. The memory release runs its package verifier and native lifecycle smoke on macOS Intel, macOS Apple Silicon, Windows x64, and Linux x64. Desktop packaged smoke writes and reloads global personalization, verifies zero-write memory Settings, sees the protected built-in market entry, and proves protected mutations are rejected while an ordinary fixture still uninstalls.
