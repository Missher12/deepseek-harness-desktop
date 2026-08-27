# Agent Note: Desktop control service seams

Status: implemented

English | [中文](2026-08-28-desktop-control-service-seams.zh.md)

## Problem

The closed Desktop protocol needs stable Harness services before Host adapters and model tools can use it. Copying wire DTOs into those services would create competing vocabularies, while exposing raw native/browser objects would let stale or foreign references cross an authorization boundary.

## Decision

`@deepseek-ai/dsh-browser-control` registers the single `ctx.browserControl` Service Definition. `@deepseek-ai/dsh-computer-control` registers the single `ctx.computerControl` Service Definition. Cordis rejects a second provider for either stable service key.

Both packages import and re-export cross-process requests, results, and brands from `@deepseek-ai/dsh-desktop-control-protocol`. Their local types cover only same-process ownership facts and validation: browser refs bind session, surface, mount generation, and snapshot revision; computer refs bind session, app, PID, process-creation identity, window, snapshot revision, and display scale. Factory functions detach and freeze provider output under protocol bounds, and the service-level per-turn action ceiling is 64 before any narrower Electron-authored lease quota applies.

The shared pure classifier lives with the native service policy and returns only `ALLOW`, `APPROVAL_REQUIRED`, or `DENY`. Known secure targets and every uncertain sensitivity/effect are denied. Targetless status/list requests carry `not-applicable`; Stop stays approval-free on its matching surface without a target classification. Ordinary reads are allowed. External side effects and persistent human-browser mutation require a later Electron-native approval; model output and page text cannot provide the classifier's authoritative facts.

## Alternatives considered

**Copy each action and result into both Service Definition packages.** This would make the packages superficially independent but permit protocol drift at the process boundary, so the protocol package remains the sole DTO owner.

**Expose provider-native element objects directly.** This would leak mutable process and surface internals and make stale-ref checks caller-dependent, so callers receive only opaque branded refs while providers retain immutable owner bindings.

**Treat unknown targets as ordinary and ask only for named sensitive fields.** Accessibility and DOM semantics cannot prove that hostile page code or an unfamiliar native control lacks side effects, so uncertainty is denied instead of silently widened.

## Consequences

Host adapters can depend on stable, swappable services without importing Electron or native helper code. Provider implementations have reusable owner/freshness and immutable-result checks, while later bridge/helper layers remain responsible for leases, permissions, quotas, teardown, and native execution. Conservative classification may refuse some safe-looking controls until an adapter can identify them authoritatively; that is the deliberate cost of failing closed.
