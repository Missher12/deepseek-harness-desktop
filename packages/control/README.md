# control/ — Desktop control capabilities

English | [中文](README.zh.md)

This group owns the closed process protocol and the Browser Control and Computer Control capability families that use it. Protocol types stay separate from services, providers, and model-facing tools so every process validates one operation and result vocabulary.

| Package | Role | Form |
|---|---|---|
| [`desktop-control-protocol/`](desktop-control-protocol/README.md) | Strict protocol v1 DTOs, manifest, JSON/PNG codec, and helper stream framing | library |
| [`browser-control/`](browser-control/README.md) | Semantic browser Service Definition, owner-bound refs, and immutable bounds | service definition |
| [`computer-control/`](computer-control/README.md) | Native control Service Definition, owner-bound refs, and fail-closed policy | service definition |
| [`desktop-control-host/`](desktop-control-host/README.md) | Desktop-only Browser/Computer providers over the owned-child IPC ledger | service provider |

Providers and Consumers in this group reuse the protocol types rather than redeclaring cross-process actions, results, identifiers, lease targets, or capability/surface unions. Both service seams expose internal lease acquisition for trusted Consumers; it is never a model tool. The Desktop Host provider registers nothing without Electron-owned child IPC.
