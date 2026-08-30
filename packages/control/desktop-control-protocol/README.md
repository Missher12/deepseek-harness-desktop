---
description: "Closed, strictly decoded Desktop-control wire protocol shared by Harness, Electron, and the native helper"
kind: "package-reference"
---

# @deepseek-ai/dsh-desktop-control-protocol

English | [中文](README.zh.md)

## Summary

The sole TypeScript source of cross-process Desktop-control actions, results, errors, and branded identifiers. Harness-to-Electron requests use `BridgeRequest`; Electron-to-helper requests use `HelperRequest`, keeping recovery-only `input.release` and Electron-authored `lease.install` out of the child request union. This package is a pure library with no runtime service or tool registration.

## Table of Contents

- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Protocol v1

[`protocol-v1.json`](protocol-v1.json) is the machine-readable roster, field-matrix, nested lease-field, and limit source for TypeScript and the native implementation. Import-time `assertProtocolManifest()` fails when the TypeScript constants diverge. The three request families are closed: 27 bridge kinds, 14 helper kinds, and four control kinds. Responses echo their exact request kind and pair it with an explicit result type or one of 20 error codes; there is no generic result escape.

The bridge roster includes internal-only `control.lease.acquire` and `control.lease.release` requests. Acquire carries one closed surface kind, a non-empty unique capability subset, and pair-preserving `{ appId, windowIds[] }` targets. Browser targets are empty; a native lease contains one or more unique apps and at least one unique window per app. Its result exposes only the effective lease id/revision, surface, targets, capabilities, and relative idle/hard durations. Release returns only `{ released: true }`. Neither request nor result can carry approval assertions, quotas, action digests, or clock values.

The strict decoder rejects duplicate keys before whole-document JSON parsing could apply last-wins behavior. It also rejects dangerous keys, unknown or missing fields, unknown discriminants, wrong versions, malformed identifiers, non-finite or out-of-range numbers, and values that exceed their UTF-8 limits. Encoding accepts only a descriptor-inspected plain tree: custom prototypes, `toJSON`, accessors, non-enumerable or symbol keys, sparse arrays, and shared or cyclic objects fail before serialization. The exact emitted frame is decoded and validated again, so validation never applies to a different object than the transmitted text. Decoded JSON is detached and deeply frozen.

`controlKeyValues` is the single keyboard vocabulary shared by model tools, Electron, and the Rust helper. Wire values use canonical uppercase ASCII letters plus the declared digit, navigation, editing, and function keys. Model-facing tools may accept a lowercase single-letter alias, but normalize it before encoding; every bridge, helper, and recovery `input.release` frame rejects values outside the manifest roster.

## Framing and images

An unprefixed frame begins with tag `0x01` for at most 65,536 JSON bytes or tag `0x02` for a 16-byte transfer UUID followed by at most 4,194,304 raw PNG bytes. `LengthPrefixedFrameDecoder` accepts split or coalesced helper stream input with a four-byte big-endian length that includes the tag and body; it rejects zero and oversized lengths before allocating a body.

`DesktopControlFrameDecoder` accepts an optional trusted JSON-message validator for the owning transport direction. The validator receives only the detached JSON message, must return no data, and runs before screenshot correlation can become pending. The decoder then requires screenshot metadata and its PNG to be adjacent, verifies transfer ID, byte length, SHA-256, PNG signature, IHDR dimensions, and ordering, and exposes image bytes through `ImmutablePng.read()`, which returns a fresh copy. A validator rejection, returned value, or any malformed or mis-sequenced input permanently closes that decoder instance without defining behavior for Harness or chat lifecycle.

## API ownership

`RequestId`, `ControlLeaseId`, and `PngTransferId` are canonical lower-case UUIDs; `BrowserRef` and `ComputerRef` have distinct fixed prefixes and 32 lower-case hexadecimal digits. The package imports and re-exports the official `SessionId` from `@deepseek-ai/dsh-session/types`; wire validation limits its UTF-8 representation to 128 bytes without changing its owner-defined character set.

Bridge deadlines remain wall-clock values so Electron can shorten and convert them; `assertBridgeDeadline(request, nowUnixMs)` accepts only a deadline strictly after the single caller-supplied current time and no more than 30 seconds ahead. Helper requests instead carry `timeoutMs` from 1 through 30,000. `lease.install` reuses the same pair-preserving target and capability types and adds Electron-authored quotas for total `operations`, snapshots, pointer actions, key actions, and text bytes; `agentId` is display metadata, never identity. Stateful request correlation, duplicate-request tombstones, cancellation, and child generations belong to the Host bridge, not this stateless codec. The raw acquire/release fixtures join the existing status and screenshot fixtures as byte-parity inputs for the later Rust helper. The [closed protocol Agent Note](../../../.agents/notes/implemented/architecture/2026-08-28-closed-desktop-control-protocol.md) records the ownership decision.

<a id="dev-note"></a>
## Dev Note

None.

<a id="model-experience"></a>
## Model Experience

None, as this package validates process messages and registers no prompt, tool schema, or model result.

#### KV Cache effect

None; this package neither assembles nor sends a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Protocol v1 has no negotiation or compatibility adapter** — an unsupported version fails closed under the repository's pre-release compatibility stance.
- **The codec does not authorize an operation** — Electron and the native helper must enforce leases, policy, quotas, deadlines, and revocation when they consume these validated DTOs.
- **PNG parsing is deliberately narrow** — the codec validates the signature and IHDR dimensions plus the declared correlation facts; the attachment service owns full image normalization before model use.
