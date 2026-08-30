---
description: "The Desktop control package map: closed protocol, Browser Control, Computer Control, and the trusted Host provider."
kind: "package-group"
---

# control/ — Desktop control capabilities

English | [中文](README.zh.md)

## Summary

This group owns the closed process protocol and the Browser Control and Computer Control capability families that use it. Protocol types stay separate from services, providers, and model-facing tools so every process validates one operation and result vocabulary.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | Form |
|---|---|---|
| [`desktop-control-protocol/`](desktop-control-protocol/README.md) | Strict protocol v1 DTOs, manifest, JSON/PNG codec, and helper stream framing | library |
| [`browser-control/`](browser-control/README.md) | Semantic browser Service Definition, owner-bound refs, and immutable bounds | service definition |
| [`computer-control/`](computer-control/README.md) | Native control Service Definition, owner-bound refs, and fail-closed policy | service definition |
| [`desktop-control-host/`](desktop-control-host/README.md) | Desktop-only Browser/Computer providers over the owned-child IPC ledger | service provider |

Providers and Consumers in this group reuse the protocol types rather than redeclaring cross-process actions, results, identifiers, lease targets, or capability/surface unions. Both service seams expose internal lease acquisition for trusted Consumers; it is never a model tool. The Desktop Host provider registers nothing without Electron-owned child IPC.

-----

<a id="related-documentation"></a>
## Related documentation

- [Desktop-control subsystem](../../docs/subsystems/desktop-control.md) — authority, leases, surface ownership, protocol limits, and cleanup guarantees.
- [Generated tool catalog](../../docs/tool-catalog.md) — the closed Browser Control and Computer Control model tools.

-----

<a id="dev-note"></a>
## Dev Note

None.
