# @deepseek-ai/dsh-computer-control

English | [中文](README.zh.md)

The Computer Control Service Definition registers one `ctx.computerControl` provider for bounded observation and input across user-authorized native applications. It imports and re-exports the closed request/result DTOs and brands from [`dsh-desktop-control-protocol`](../desktop-control-protocol/README.md); native policy cannot widen that roster.

## Contract

- `status()` reports platform and permission facts. `list(request, signal)` returns only applications/windows eligible for a user grant.
- `snapshot(request, signal)` observes one authorized window. `act(request, signal)` accepts only the protocol's focus, semantic/coordinate pointer, drag, type, key, scroll, and wait actions.
- `stop(sessionId)` awaits release of native resources for exactly one session.
- `bindComputerReference()` and `assertComputerReferenceCurrent()` bind an opaque ref to session, application, PID, process-creation identity, window, snapshot revision, and display scale. A changed field is stale; a foreign session is unauthorized.
- `freezeComputerList()` and `freezeComputerSnapshot()` accept only primitive own-data fields, rebuild detached protocol collections, and deeply freeze them under the protocol limits. Optional PNG metadata is reconstructed from exactly its five protocol fields after brand, hash, byte, and dimension validation. `assertComputerActionCount()` applies the service's 64-action per-turn ceiling; a native lease may be narrower.

## Fail-closed policy

`classifyControlPolicy()` returns only `ALLOW`, `APPROVAL_REQUIRED`, or `DENY`. Its runtime boundary validates plain input objects and the exact protocol request-kind, surface, sensitivity, and effect rosters; invalid, accessor-backed, non-string, or unknown values are denied without throwing. Known secure text, passwords, one-time codes, payments, files, biometrics, password managers, keychains, OS privacy/security targets, installation/removal, destructive deletion, and download-execute targets are always denied. Unknown sensitivity or effect is denied. Targetless status/list requests use the explicit `not-applicable` class instead of inventing a target. Stop is approval-free on the matching surface only after roster validation, while a wrong-surface Stop is denied. Ordinary reads and ordinary local interaction on an authorized ephemeral/native surface are allowed; external side effects and any mutation of a persistent human browser require a separate Electron-native approval.

The classifier accepts only adapter-owned facts. Model output and page text cannot label their own target as ordinary, and accessibility semantics are not treated as proof that hostile JavaScript lacks side effects.

## Model Experience

Indirectly, through later Computer Control tool Consumers that render bounded observations and closed action results; this Service Definition itself registers no prompt or tool.

#### KV Cache effect

None directly; a Consumer owns any model-visible schema or result changes.

## Known Limitations and Deferred Work

- This package is a contract, reference-validation, and policy layer, not a native helper, Electron bridge, UI, or model tool.
- OS permission checks, app grants, leases, quotas, capture throttling, held-input recovery, and emergency Stop remain authoritative in Electron and the native helper.
- Coordinate action eligibility still depends on the later adapter's lack of a usable semantic ref and a vision-capable model; this service does not infer either fact.
