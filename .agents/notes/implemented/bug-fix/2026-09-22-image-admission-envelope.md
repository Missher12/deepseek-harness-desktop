# Agent Note: The image admission envelope and the prompt carrier budget

Status: implemented

English | [中文](2026-09-22-image-admission-envelope.zh.md)

## Problem

Admission limits and the transport that carries a submission were maintained as if they were the same budget, and they are not. `maxMessageImageBytes` names decoded source bytes; the prompt carrier counts base64 code units, which is a third more. The two were also an order of magnitude apart: 20 images at 50 MiB each is 1.3 GiB encoded against a 296 MiB ceiling, so a submission the composer accepted could not be sent at all. Two further consequences followed. The per-side pixel cap refused ordinary phone and screenshot sources at 8192px, and the per-message aggregate was expressed in a unit no caller could compare against the carrier's.

## Decision

The product limits are single-image 50 MiB, 20 images per message, 200 MiB aggregate source bytes per message, 64,000,000 pixels, and 16384px per side, with MiB computed as 1024 × 1024 and equality at a limit accepted. They resolve once in `LocalAttachmentStore.Config`, reach the Host validator through `imageLimits`, and reach the composer through the `imageLimits` projection, so the client prompt and the Host refusal name the same numbers. `DEFAULT_MAX_IMAGE_BYTES` is 50 MiB and `DEFAULT_MAX_IMAGE_DIMENSION` is 16384; the aggregate, count, and pixel defaults are unchanged.

The envelope is documented as a set of distinct budgets rather than one. Source admission bounds what the reader may attach. The carrier bounds one HTTP body: `MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS` is 296 MiB of combined image and document base64, and the bridge's `DEFAULT_MAX_REQUEST_BODY_BYTES` is 300 MiB, which is that ceiling plus 4 MiB for prompt text, names, and RPC JSON. Stored attachments are normalized below admission (`normalizedImageMaxBytes` 4 MiB, 2048² pixels, 8192px), and the provider budget is the route's own (`maxRequestImageBytes`, `requestImagePixelBudget`, `requestImageMaxBytes` in `llm-pi-ai`). A per-category limit is not a promise that every category can be filled at once: the encoded image and document budgets together exceed the carrier ceiling, and the composer refuses a submission that would exceed it before the request is built.

Encoding stays sequential. `serializeAttachments` reads one `File`, encodes it, and releases the raw buffer before starting the next, so the only retained growth is the encoded strings the request itself carries; the carrier budget already admits more raw bytes than the process can hold alongside its encoded form. Decode-side concurrency is unchanged: `imageCompressionConcurrency` defaults to 2 and caps native transformations per store.

## Layer budgets

| Layer | Owner | Limit | Over-limit behaviour |
|---|---|---|---|
| Source admission | `attachment-local` `imageLimits` | 50 MiB, 20 images, 200 MiB aggregate, 64M pixels, 16384px | Named `AttachmentError` code, surfaced as limit copy |
| Transport | `client-connection` body cap | 300 MiB per HTTP body | 413 with `connection: close` before the handler runs |
| Composer backstop | `ui-conversation` / `InputBar` | 296 MiB of combined encoded base64 | Refused at intake with `attachment.totalTooLarge` |
| Stored projection | `attachment-local` normalization policy | 4 MiB, 2048² pixels, 8192px | Downscaled on admission; stored bytes are what later requests reuse |
| Provider request | `llm-pi-ai` route profile | 20 MiB base64, 2048² pixels, 1 MiB per image | Oldest images replaced by a text placeholder |

## Alternatives considered

**Raise the HTTP body cap to fit the sum of the category limits.** That makes the carrier the largest number in the system and moves the failure to the point where a 300 MiB buffer already exists. The categories were never meant to be simultaneously satisfiable; expressing them as one budget is what hid the gap.

**Lower the per-message aggregate to what the carrier admits.** That would refuse a legitimate 200 MiB submission that fits — the aggregate budget fits the carrier on its own, because base64 of 200 MiB is 267 MiB against a 296 MiB ceiling. Only the image-plus-document combination does not, and that is the combination the composer refuses.

**Keep the per-side cap at 8192px and downscale instead.** The pixel budget already bounds what is stored, so the per-side cap only decides which sources are refused outright. 8192px rejects a 12000px panorama and an ordinary modern phone photo before any of that matters.

**Encode images concurrently to cut latency.** The client already bounds work to one raw buffer at a time. Concurrency here would trade peak memory for wall-clock on a path whose cost is dominated by the model request, and the budget permits an aggregate the process cannot hold in raw form.

**Trust the client to enforce the envelope.** The composer check is a backstop for a good error message; the Host re-admits every part through `admitPromptContent`, so a caller that bypasses the composer is still refused by the same limits.

## Consequences

A 25.8 MiB source that the previous byte limit refused is now admitted and normalized; a 16384px long edge passes where 8192px was the ceiling. The observed transport-boundary behaviour is unchanged and now pinned: a body declaring one byte past the carrier ceiling is refused with 413 before the handler runs, and a body at the ceiling fits because the attachment ceiling it is derived from leaves the framing headroom. `MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS` gained the statement that the per-category budgets cannot both be filled. Verification is [the large-source suite](../../../../packages/attachment/attachment-local/tests/index.spec.ts), which generates real encoded bytes at each boundary (including a 3000×3000 noise image past the old byte limit and a 16384×200 gradient past the old edge cap), and [the carrier budget suite](../../../../packages/client/connection/tests/http-bridge.host.spec.ts). No upstream 413 was reproduced: the transport ceiling is the reproducible layer, and the provider budget was not exercised against a live route. Windows and Ubuntu were not validated natively.

## Related

- [Reasoning at full length in the reading flow](2026-09-22-reasoning-full-length-reading.md)
