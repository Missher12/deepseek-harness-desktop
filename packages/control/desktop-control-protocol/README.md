# @deepseek-ai/dsh-desktop-control-protocol

English | [中文](README.zh.md)

The sole TypeScript source of cross-process Desktop-control actions, results, errors, and branded identifiers. Harness-to-Electron requests use `BridgeRequest`; Electron-to-helper requests use `HelperRequest`, keeping recovery-only `input.release` and Electron-authored `lease.install` out of the child request union. This package is a pure library with no runtime service or tool registration.

## Protocol v1

[`protocol-v1.json`](protocol-v1.json) is the machine-readable roster, field-matrix, and limit source for TypeScript and the native implementation. Import-time `assertProtocolManifest()` fails when the TypeScript constants diverge. The three request families are closed: 25 bridge kinds, 14 helper kinds, and four control kinds. Responses echo their exact request kind and pair it with an explicit result type or one of 17 error codes; there is no generic result escape.

The strict decoder rejects duplicate keys before whole-document JSON parsing could apply last-wins behavior. It also rejects dangerous keys, unknown or missing fields, unknown discriminants, wrong versions, malformed identifiers, non-finite or out-of-range numbers, and values that exceed their UTF-8 limits. Decoded JSON is detached and deeply frozen.

## Framing and images

An unprefixed frame begins with tag `0x01` for at most 65,536 JSON bytes or tag `0x02` for a 16-byte transfer UUID followed by at most 4,194,304 raw PNG bytes. `LengthPrefixedFrameDecoder` accepts split or coalesced helper stream input with a four-byte big-endian length that includes the tag and body; it rejects zero and oversized lengths before allocating a body.

`DesktopControlFrameDecoder` requires screenshot metadata and its PNG to be adjacent. It verifies transfer ID, byte length, SHA-256, PNG signature, IHDR dimensions, and ordering, then exposes image bytes through `ImmutablePng.read()`, which returns a fresh copy. Any malformed or mis-sequenced input permanently closes that decoder instance without defining behavior for Harness or chat lifecycle.

## API ownership

`RequestId`, `ControlLeaseId`, and `PngTransferId` are canonical lower-case UUIDs; `BrowserRef` and `ComputerRef` have distinct fixed prefixes and 32 lower-case hexadecimal digits. The package imports and re-exports the official `SessionId` from `@deepseek-ai/dsh-session/types`; wire validation limits its UTF-8 representation to 128 bytes without changing its owner-defined character set.

Bridge deadlines remain wall-clock values so Electron can shorten and convert them; `assertBridgeDeadline(request, nowUnixMs)` enforces the caller-supplied current-time check and the 30-second ceiling. Helper requests instead carry `timeoutMs` from 1 through 30,000. Stateful request correlation, duplicate-request tombstones, cancellation, and child generations belong to the Host bridge, not this stateless codec. The [closed protocol Agent Note](../../../.agents/notes/implemented/architecture/2026-08-28-closed-desktop-control-protocol.md) records the ownership decision.

## Model Experience

None, as this package validates process messages and registers no prompt, tool schema, or model result.

#### KV Cache effect

None; this package neither assembles nor sends a model request.

## Known Limitations and Deferred Work

- **Protocol v1 has no negotiation or compatibility adapter** — an unsupported version fails closed under the repository's pre-release compatibility stance.
- **The codec does not authorize an operation** — Electron and the native helper must enforce leases, policy, quotas, deadlines, and revocation when they consume these validated DTOs.
- **PNG parsing is deliberately narrow** — the codec validates the signature and IHDR dimensions plus the declared correlation facts; the attachment service owns full image normalization before model use.
