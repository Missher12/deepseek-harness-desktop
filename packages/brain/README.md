---
description: "The external-brain package map: bounded provider registration, arbitration, and model-context injection."
kind: "package-group"
---

# brain/ — External-brain integration

English | [中文](README.zh.md)

## Summary

The brain group owns the bounded local provider hub that can add source-attributed, explicitly untrusted factual or procedural context to an eligible top-level turn. Providers retain their own storage and side effects; the hub owns registration, arbitration, deadlines, and model-context limits.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`missher-brain/`](missher-brain/README.md) | Registers bounded external-brain providers and selects one context batch for eligible turns | `ctx.brain` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Core subsystem](../../docs/subsystems/core.md) — Agent request assembly and top-level turn ownership.
- [Generated configuration catalog](../../docs/config-catalog.md) — configuration accepted by the external-brain hub.

-----

<a id="dev-note"></a>
## Dev Note

None.
