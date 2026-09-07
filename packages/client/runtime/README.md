---
description: "Shared browser imports for Desktop extensions using the official client services."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-runtime

English | [中文](README.zh.md)

## Summary

Desktop extensions can import shared store helpers and client contract types through the `/client` entry. This package owns no live services. The Session Controller, Workspace Controller, Conversation, renderer and store packages own their runtime state and behavior.

## Table of Contents

- [Consumer contract](#consumer-contract)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Consumer contract

The browser entry re-exports `createSnapshotStore`, `defineStore` and `shallowEqual` from [client-store](../store/README.md). Its type exports describe Session bindings and list state, Session and Workspace identities, renderer root props and Conversation node definitions. The [Session Controller](../../api/session-controller/README.md) owns Session lifecycle; the [Conversation package](../ui-conversation/README.md) owns the shared conversation contract.

## Implementation

<details>
<summary>Implementation internals — click to expand</summary>

Both Cordis `apply` entries perform no registration. The [browser entry](src/client/index.ts) forwards imports to their owning packages, so mounting this package creates no duplicate Session, Workspace or store service. No configuration or invariant companion is published because this package owns no mutable runtime relationships.

</details>

## Model Experience

### Browser imports

#### What the model sees

Nothing directly: `createSnapshotStore` and the type exports do not construct model requests, tools or prompt content.

#### Token effect

None. Consuming packages own any model-facing content they derive from client state.

#### KV Cache effect

None. These exports do not assemble or modify request prefixes.

## Known Limitations and Deferred Work

- **Owner plugins are required** — importing types or mounting this package does not activate Session, Workspace, Conversation or renderer services.
- **Browser values use `/client`** — the bare package entry is the inactive Host plugin entry.

### Dev Note

None.
