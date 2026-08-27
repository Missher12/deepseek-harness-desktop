# control/ — Desktop control capabilities

English | [中文](README.zh.md)

This group owns the closed process protocol and the Browser Control and Computer Control capability families that use it. Protocol types stay separate from services, providers, and model-facing tools so every process validates one operation and result vocabulary.

| Package | Role | Form |
|---|---|---|
| [`desktop-control-protocol/`](desktop-control-protocol/README.md) | Strict protocol v1 DTOs, manifest, JSON/PNG codec, and helper stream framing | library |

Later packages in this group reuse the protocol types rather than redeclaring cross-process actions, results, or identifiers.
