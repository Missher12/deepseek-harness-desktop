# Agent Note: First-step statistics and local model presets

Status: implemented

English | [中文](2026-09-09-first-step-statistics-and-model-presets.zh.md)

## Problem

The statistics presentation gates timing behind closed-step counts. An assistant response can already contribute LLM duration and first-token timing while its tool step remains open, so the first response appears to have no statistics. Model listings often expose only IDs, leaving manual context configuration even when the installed catalog knows the model.

## Decision

Every statistics metric keeps its position from the first step, with unknown values shown as localized placeholders. Timing and billing render independently of closed-step counts. Durable projection semantics stay unchanged, and another session's values never fill a loading gap.

The existing model-discovery operation accepts an exact local model ID. The pi-ai adapter looks up an ID index without credentials or network access. A configured route or exact endpoint selects its own catalog limits. Otherwise compatible exact-ID matches use their smallest known capacities, and reasoning/protocol settings are returned only when the declarations agree. Unknown IDs return no candidate; endpoint metadata overrides catalog defaults.

The Models editor fills missing fields on ID blur. Automatic fields retain local provenance so changing the ID can clear them, while explicit edits survive. Results are accepted only for the same mounted, unchanged row and provider target. The existing Apply operation remains the persistence boundary. Profile or conversation reasoning choices win; otherwise reasoning-capable models start at their highest supported effort, including DeepSeek Max.

## Alternatives considered

**Reuse old statistics or fabricate zero usage.** Both give a false answer during loading or failed billing. Named placeholders retain useful structure without assigning unsupported values.

**Infer every capability from a model-name prefix.** Identical IDs can use different token limits and reasoning wire formats across providers. Exact matching and conservative defaults preserve manual control without claiming a live capability probe.

## Consequences

The change adds no model request during startup or preset lookup. Catalog indexing is lazy and avoids scanning the complete catalog for every row in a large listing. Presets describe installed knowledge, not a verified gateway quota; users can adjust them. Higher default reasoning may increase response time and token usage compared with lower effort, while existing explicit selections remain unchanged.

## Testing

Component tests cover first-response timing before step closure, persistent placeholders, session switching, late results, manual overrides, ID changes and credential-free preset lookup. Adapter tests cover exact route/endpoint matching, protocol mismatch, unknown IDs, conflicting gateway metadata, detached configuration, highest-supported defaults and explicit lower/off selections. Tests use local fixtures and HTTP stand-ins; they do not establish native startup improvement or live provider compatibility.
