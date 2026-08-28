# Agent Note: Closed Desktop-control protocol ownership

Status: implemented

English | [中文](2026-08-28-closed-desktop-control-protocol.zh.md)

## Problem

Browser and native application control cross two process boundaries and later gain distinct service and tool consumers. Duplicating action types or accepting extensible process messages would let one peer interpret fields that another peer never reviewed, while ordinary JSON parsing would hide duplicate-key ambiguity.

## Decision

`@deepseek-ai/dsh-desktop-control-protocol` owns every cross-process action, result, error, and branded identifier used by Desktop control. `protocol-v1.json` is the machine-readable roster, field-matrix, and numeric-limit source; TypeScript constants validate themselves against it at import, and the native implementation consumes the same file and raw fixtures.

Harness-facing `BridgeRequest` and Electron-facing `HelperRequest` are separate closed unions. The bridge union has 27 requests, including internal-only `control.lease.acquire` and `control.lease.release`. Acquire carries a closed surface, a non-empty unique capability subset, and pair-preserving app/window targets; browser targets are empty and native targets are non-empty. Its result exposes only the effective descriptor, while release returns only an awaited cleanup acknowledgement. Neither accepts or returns approval assertions, quotas, clocks, or action digests.

Only the helper union includes `lease.install` and `input.release`. Install reuses the protocol-owned pair-preserving targets and capabilities and carries Electron-authored total `operations` plus category quotas; `agentId` is display-only. Recovery-only `input.release` carries no lease fields. Successful responses bind explicit results to their request discriminants, and error responses use one closed code roster.

The binary envelope separates bounded UTF-8 JSON from raw PNG bytes. Screenshot metadata requires the immediately following PNG and binds its UUID, byte length, SHA-256, width, and height. Decoder output is detached and deeply frozen; image bytes have one immutable owner whose reader returns copies. A malformed value or frame sequence closes only the decoder used for Desktop control.

## Alternatives considered

**Copy DTOs into each service and adapter.** This would reduce one package dependency but create independent vocabularies at the exact trust boundary where drift is most dangerous.

**Use a general RPC envelope with arbitrary operation names and untyped values.** This would simplify forwarding but expose an expansion mechanism that bypasses review of individual actions, fields, results, and limits.

**Encode screenshots inside JSON.** Base64 would inflate messages, blur JSON and image limits, and create additional large mutable copies. Adjacent raw frames keep size and ownership checks explicit.

## Consequences

Every new operation or result requires one reviewed manifest and TypeScript update plus fixture changes, and the later native implementation must prove byte parity. Raw acquire/release frames are checked in beside the status and screenshot fixtures. The package defines lease lifecycle messages but deliberately does not mint leases or own authorization, request ledgers, process generations, or image normalization; their runtime owners consume its validated values. Protocol v1 has no compatibility negotiation during the repository's pre-release phase.
