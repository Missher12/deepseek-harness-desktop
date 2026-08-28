# @deepseek-ai/dsh-browser-control

English | [中文](README.zh.md)

The Browser Control Service Definition registers one `ctx.browserControl` provider for the Desktop-owned visible browser surface. It consumes the closed request/result DTOs from [`dsh-desktop-control-protocol`](../desktop-control-protocol/README.md) and does not define a second wire vocabulary.

## Contract

- `acquireLease(request, signal)` is an internal Consumer/provider operation that forwards the protocol-owned desired surface, targets, and capabilities to Electron authority. It is not a model tool and cannot authorize itself.
- `snapshot(request, signal)` returns a `BrowserSnapshotEnvelope` whose bounded protocol result and codec-owned `ImmutablePng` are present together whenever an image exists.
- `act(request, signal)` accepts only the protocol's navigation, semantic-reference, key, selection, scroll, and wait actions. Browser coordinate actions do not exist.
- `revokeSession(sessionId)` awaits teardown for exactly one session; implementations own exclusive surface lifetime and reference invalidation.
- `bindBrowserReference()` and `assertBrowserReferenceCurrent()` keep opaque refs bound to the official session, surface identity, mount generation, and snapshot revision. Ownership is checked before freshness so a foreign session cannot probe a surface.
- `freezeBrowserSnapshot()` accepts only primitive own-data fields, rebuilds detached protocol output, and deeply freezes it while applying semantic collection and UTF-8 bounds. Optional PNG metadata is reconstructed from exactly its five protocol fields after brand, hash, byte, and dimension validation. `freezeBrowserSnapshotEnvelope()` rejects metadata/PNG presence mismatches, copies the protocol `ImmutablePng` into service-owned storage, strips extra fields, and freezes the exact envelope; raw byte arrays are never exposed as fields. `assertBrowserActionCount()` applies the service's 64-action per-turn ceiling; Electron-authored lease quotas may be narrower.

Page text remains untrusted and cannot authorize actions. This seam does not claim that accessibility semantics can prove hostile page JavaScript has no external side effects. The Electron adapter owns the surface, debugger, URL/redirect validation, lease, and native approval challenge.

Later tool Consumers derive the official session and populate every request id, deadline, lease id/revision, and other transport field themselves. Model schemas must not expose lease acquisition, session or lease metadata, approval, quota, clock, or action-digest fields.

This privileged service remains documented for trusted static first-party providers and Consumers, but it is excluded from the runtime model Cordis catalog and withheld from model-authored dynamic packages through both property access and `ctx.get()`.

## Model Experience

Indirectly, through later Browser Control tool Consumers that render bounded snapshots and closed action results; this Service Definition itself registers no prompt or tool.

#### KV Cache effect

None directly; a Consumer owns any model-visible schema or result changes.

## Known Limitations and Deferred Work

- This package is a contract and validation layer, not a browser backend, Electron bridge, UI, or model tool.
- A provider must still reject stale navigation races, foreign debuggers, private-network destinations, file inputs, downloads, popups, and unsupported permissions at its authoritative boundary.
- The fixed per-turn action ceiling supplements rather than replaces the shorter Electron lease and its quotas.
