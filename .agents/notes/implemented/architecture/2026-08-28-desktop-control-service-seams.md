# Agent Note: Desktop control service seams

Status: implemented

English | [中文](2026-08-28-desktop-control-service-seams.zh.md)

## Problem

The closed Desktop protocol needs stable Harness services before Host adapters and model tools can use it. Copying wire DTOs into those services would create competing vocabularies, while exposing raw native/browser objects would let stale or foreign references cross an authorization boundary.

## Decision

`@deepseek-ai/dsh-browser-control` registers the single `ctx.browserControl` Service Definition. `@deepseek-ai/dsh-computer-control` registers the single `ctx.computerControl` Service Definition. Cordis rejects a second provider for either stable service key. Both seams add internal `acquireLease(request, signal)` with the protocol-owned acquire request/result; this operation is for trusted Consumers and providers, never a model tool.

Both packages import and re-export cross-process requests, results, lease targets/capabilities/surfaces, brands, and `ImmutablePng` from `@deepseek-ai/dsh-desktop-control-protocol`. The policy surface type aliases that protocol type instead of copying its union. Their local types cover only same-process ownership facts and validation: browser refs bind session, surface, mount generation, and snapshot revision; computer refs bind session, app, PID, process-creation identity, window, snapshot revision, and display scale. Factory functions reject boxed or coercible fields, reconstruct branded primitive values and the exact five-field PNG metadata object, detach and deeply freeze provider output under protocol bounds, and apply a service-level per-turn action ceiling of 64 before any narrower Electron-authored lease quota. Each `snapshot()` returns a service-only immutable envelope containing the protocol result and, exactly when image metadata is present, a detached protocol `ImmutablePng`; the factory rejects presence mismatches, strips extra fields, and never exposes a raw byte-array field.

Future tool Consumers derive the official session and fill request IDs, deadlines, lease IDs/revisions, and all transport fields. Model schemas cannot see lease acquisition, session or lease authority, approval, quotas, clocks, or action digests.

The Desktop-only `@deepseek-ai/dsh-desktop-control-host` is now the concrete first provider for both seams. Its one process-wide IPC client and immutable lease descriptor cache are shared by both services; absent an Electron-owned child channel it registers neither service. Snapshot adapters preserve the service-level metadata/PNG co-presence type. Turn stopping awaits bounded release on an independent cleanup signal, while post-commit turn end only queues a fallback drained by session flush; session disposal queues revocation and plugin disposal drains every cleanup tail.

These two services are privileged internal authorities, not extension points for model-authored dynamic packages. The documentation catalog retains their contracts for trusted first-party providers and Consumers, while the runtime model catalog excludes both services and every type reachable only through them. The dynamic Cordis façade denies declared property access and `ctx.get()` for both keys and does not advertise them through `has`; ordinary static first-party plugins using the real Cordis Context remain unaffected.

The shared pure classifier lives with the native service policy and returns only `ALLOW`, `APPROVAL_REQUIRED`, or `DENY`. Its runtime boundary accepts only plain objects and exact request-kind, surface, sensitivity, and effect roster values; hostile or unknown values deny without throwing. Known secure targets and every uncertain sensitivity/effect are denied. Targetless status/list requests carry `not-applicable`; Stop stays approval-free on its matching surface only after the closed roster is validated. Ordinary reads are allowed. External side effects and persistent human-browser mutation require a later Electron-native approval; model output and page text cannot provide the classifier's authoritative facts.

## Alternatives considered

**Copy each action and result into both Service Definition packages.** This would make the packages superficially independent but permit protocol drift at the process boundary, so the protocol package remains the sole DTO owner.

**Expose provider-native element objects directly.** This would leak mutable process and surface internals and make stale-ref checks caller-dependent, so callers receive only opaque branded refs while providers retain immutable owner bindings.

**Treat unknown targets as ordinary and ask only for named sensitive fields.** Accessibility and DOM semantics cannot prove that hostile page code or an unfamiliar native control lacks side effects, so uncertainty is denied instead of silently widened.

## Consequences

Host adapters can depend on stable, swappable services without importing Electron or native helper code. The first Desktop provider supplies transport correlation, a shared descriptor cache, lifecycle release tails, and immutable snapshot mapping, while the later authority/browser/helper layers remain responsible for actually authorizing, minting, downstream cleanup, permissions, quotas, and native execution. Conservative classification may refuse some safe-looking controls until an adapter can identify them authoritatively; that is the deliberate cost of failing closed.
