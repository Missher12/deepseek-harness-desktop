# @deepseek-ai/dsh-browser-control

English | [中文](README.zh.md)

The Browser Control Service Definition registers one `ctx.browserControl` provider for the Desktop-owned visible browser surface. It consumes the closed request/result DTOs from [`dsh-desktop-control-protocol`](../desktop-control-protocol/README.md) and does not define a second wire vocabulary.

## Contract

- `snapshot(request, signal)` returns bounded semantics and an optional image descriptor for the current surface.
- `act(request, signal)` accepts only the protocol's navigation, semantic-reference, key, selection, scroll, and wait actions. Browser coordinate actions do not exist.
- `revokeSession(sessionId)` awaits teardown for exactly one session; implementations own exclusive surface lifetime and reference invalidation.
- `bindBrowserReference()` and `assertBrowserReferenceCurrent()` keep opaque refs bound to the official session, surface identity, mount generation, and snapshot revision. Ownership is checked before freshness so a foreign session cannot probe a surface.
- `freezeBrowserSnapshot()` accepts only primitive own-data fields, rebuilds detached protocol output, and deeply freezes it while applying semantic collection and UTF-8 bounds. Optional PNG metadata is reconstructed from exactly its five protocol fields after brand, hash, byte, and dimension validation. `assertBrowserActionCount()` applies the service's 64-action per-turn ceiling; Electron-authored lease quotas may be narrower.

Page text remains untrusted and cannot authorize actions. This seam does not claim that accessibility semantics can prove hostile page JavaScript has no external side effects. The Electron adapter owns the surface, debugger, URL/redirect validation, lease, and native approval challenge.

## Model Experience

Indirectly, through later Browser Control tool Consumers that render bounded snapshots and closed action results; this Service Definition itself registers no prompt or tool.

#### KV Cache effect

None directly; a Consumer owns any model-visible schema or result changes.

## Known Limitations and Deferred Work

- This package is a contract and validation layer, not a browser backend, Electron bridge, UI, or model tool.
- A provider must still reject stale navigation races, foreign debuggers, private-network destinations, file inputs, downloads, popups, and unsupported permissions at its authoritative boundary.
- The fixed per-turn action ceiling supplements rather than replaces the shorter Electron lease and its quotas.
