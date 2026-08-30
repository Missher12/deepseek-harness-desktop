---
description: "Desktop-only Host provider and owned-child IPC client for closed browser and native control services"
kind: "package-reference"
---

# @deepseek-ai/dsh-desktop-control-host

English | [中文](README.zh.md)

## Summary

The Desktop-only Host provider for [`BrowserControl`](../browser-control/README.md) and [`ComputerControl`](../computer-control/README.md). One process-wide client, request ledger, callback-driven send queue, and lease descriptor cache serve both providers over the exact IPC channel created for the Electron-owned Harness child. With no owned Node IPC channel, this plugin registers neither service and ordinary Harness startup continues unchanged.

## Table of Contents

- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Transport and lifecycle

- Harness-to-Electron accepts exactly the protocol's 27 bridge requests plus `request.cancel` and `session.revoke`; Electron-to-Harness accepts only matching responses, their adjacent verified PNG when declared, `lease.revoke`, and `parent.shutdown`. Direction is checked before image correlation can wait for a PNG.
- Each Node IPC message is one copied, unprefixed protocol frame. A single callback-driven queue keeps every JSON-plus-optional-PNG envelope adjacent and never treats `child.send()`'s boolean return as delivery.
- The ledger admits at most 32 live requests and retains exactly 256 insertion-ordered terminal request IDs. It binds the official session, request kind, generation, deadline, cancellation, and any validated lease tuple; only an exact response or revoke tuple can settle it.
- Browser and Computer providers share one `ControlLeaseCache`. Only an Electron-authored acquire result enters that cache, and every exposed snapshot is rebuilt through the service package's immutable result/PNG envelope validator.
- `agent/turn-stopping` synchronously invalidates the cached descriptor and awaits a bounded release on an independent cleanup signal. Fire-and-forget `turn/end` enqueues only a fallback tail; `session/flush` drains it, while `session/disposed` queues session revocation. Plugin disposal drains all tails before removing listeners.
- Desktop shutdown stops admission, awaits the later authority-cleanup seam, sends `parent.shutdown` within a bound, disconnects the exact control channel, and only then lets `HarnessProcess` terminate its owned process tree.

This is privileged first-party transport infrastructure, not a model tool. Future tool Consumers fill the protocol's official session and transport fields internally; their model schemas must never expose lease acquisition, lease/session metadata, approval facts, quotas, clocks, or action digests.

<a id="dev-note"></a>
## Dev Note

None.

<a id="model-experience"></a>
## Model Experience

Indirectly, through later Browser and Computer Control tool Consumers that own their model schemas and result rendering; this Host provider only transports their requests.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No authority or native execution yet** — the injected Electron backend returns `NOT_SUPPORTED` until the later control coordinator owns user approval, lease minting, browser dispatch, and helper execution.
- **One owned child only** — the transport deliberately has no renderer relay, loopback server, bearer token, generic channel, or compatibility negotiation.
- **IPC loss disables control for that generation** — malformed, wrong-direction, disconnected, or failed sends close only the control link and reject its work; they do not restart or terminate Harness and do not impair ordinary chat.
