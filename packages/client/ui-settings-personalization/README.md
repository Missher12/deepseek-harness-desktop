---
description: "Edit global instructions in the Personalization settings page."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-personalization

English | [中文](README.zh.md)

## Summary

Edit global instructions and choose a reply style from Personalization in Settings. Saving updates only the Desktop-owned block in the canonical Harness instructions file and preserves surrounding manual content. Stale revisions, unsafe targets and oversized input fail visibly; more specific project instructions remain authoritative.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Invariant ownership](#invariant-ownership)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Global **Personalization** section for Web and Desktop Settings. The browser plugin registers the localized `personalization` section at order 5 and calls the typed Host Settings API; it never receives a file path and keeps no browser-local copy.

The page edits only the Desktop-owned marked block in the canonical `$DSH_HOME/AGENTS.md`. The Host preserves every byte outside that block, rejects stale revisions and invalid or oversized input, refuses writable symlink targets, and replaces the document atomically. A manually maintained document stays visible but read-only when Desktop cannot update it safely.

The section paints stable disabled controls before the first response, then provides a bounded custom-instructions editor, UTF-8 byte count, explicit Save action, reply-style selector, and accessible status messages. Existing manual global instructions and more specific project `AGENTS.md` rules remain authoritative outside the managed block.

## Invariant ownership

No invariant companion is published because each component validates every Remote state before rendering.


## Model Experience

Indirectly, through the existing agent-instructions loader, which makes saved text visible from the next request while this browser package adds no second instruction source.

#### KV Cache effect

Changing global instructions changes the prompt prefix for later requests and can invalidate provider prompt-cache reuse for that prefix. Merely opening this Settings page has no model or cache effect.

## Known Limitations and Deferred Work

- **One device-local document** — personalization is stored in the active Harness home and is not cloud-synchronized.
- **No destructive ownership takeover** — malformed or externally managed targets remain read-only instead of being rewritten.
- **No live session rewrite** — changes apply to the next request; already materialized conversation events are not modified.

### Dev Note

None.
