# Agent Note: Custom model input capability surface

Status: implemented

English | [中文](2026-08-27-custom-model-input-capability-surface.zh.md)

## Problem

The pi-ai adapter already accepted explicit per-model input modalities, but the Models page could not edit them. Every model created through the custom-provider flow therefore omitted `input` unless a user hand-edited `settings.yaml`, so a genuinely multimodal model could appear unable to accept images. Endpoint discovery also discarded modality fields that some OpenAI-compatible gateways explicitly return.

This note supersedes only the earlier decision that no configuration surface edits `input` in [the route-default input-modality note](../architecture/2026-08-12-pi-ai-route-default-input-modalities.md). Its conservative resolution order and rule that unknown capability must not be guessed remain unchanged.

## Decision

Each pi-ai model's advanced details expose one input-capability selector with three states. Automatic omits `input` and preserves the existing entry → catalog → route fallback. Text only stores `input: [text]`. Text and images stores `input: [text, image]`. Existing fields outside the curated form survive unrelated edits, and previously hand-written unknown values remain untouched until the user changes this selector.

Model discovery carries explicit `input_modalities`, `modalities`, or `architecture.input_modalities` declarations from OpenAI-compatible list responses and the installed pi-ai catalog. It accepts only the known `text` and `image` values, deduplicates them in source order, and ignores empty, malformed, or unknown declarations. The Host wire view preserves the runtime's read-only modality contract, and the UI clones an adopted declaration into a newly selected model without overwriting an existing configured row.

No model id or display name is used to infer image support. A model called `vision` remains unknown unless its catalog, route default, endpoint response, or explicit user choice declares the capability.

## Alternatives considered

**Assume every custom model is multimodal.** Rejected because a false positive admits and durably records an image before a text-only endpoint rejects the request.

**Infer from names such as `vision`, `vl`, or `omni`.** Rejected because gateways can rename models freely and naming conventions are neither complete nor authoritative.

**Keep the capability in `settings.yaml` only.** Rejected because the product flow itself creates custom models, so the corrective field must be reachable from that same flow.

**Probe a model with an image.** Rejected because it causes a billable, stateful provider request and still cannot establish a stable catalog contract.

## Consequences

Users can accurately declare a custom vision model without leaving the application, while Automatic remains backward compatible and conservative. Gateways that explicitly publish modalities require less manual work; gateways that do not publish them remain unknown until the user or route configuration answers. The application gains a small curated setting and wire metadata, but it does not claim unverified provider capabilities.

## Testing

Discovery tests cover installed-catalog propagation, all supported explicit response shapes, ordering and deduplication, malformed values, and the no-name-inference boundary. Host schema tests cover the optional non-empty modality list. Models UI tests cover all three selector states, preserving unrelated fields, adopting explicit discovery, and refusing to reinterpret unknown hand-written values.
