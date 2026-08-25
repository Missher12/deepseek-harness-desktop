# Agent Note: Custom-model reasoning capabilities and visual effort identity

Status: implemented

English | [中文](2026-08-25-custom-model-reasoning-and-visual-effort.zh.md)

## Problem

A hand-declared pi-ai model created from the Models page carried identity and capacity but no `reasoningEfforts`. The adapter therefore correctly advertised no reasoning capability, leaving the Desktop reasoning control unavailable with no in-product way to declare the missing per-model fact.

The six-stop Desktop control also mapped visual stops above a model's real ceiling to that ceiling, but its collapsed trigger rendered the Host's actual effort name. Selecting Ultra on a High-only model therefore moved the slider to Ultra and submitted High, then immediately relabelled the trigger High. The visible selection contradicted the gesture even though dispatch was safe.

## Decision

Each pi-ai model row exposes a reasoning-capability selector inside its existing details disclosure. Automatic omits `reasoningEfforts` and preserves the installed catalog declaration, Not supported writes `false`, High only writes exactly `{ high: "high" }`, and the Low through Max ceiling choices write an explicit standard map containing every level up to the selected ceiling. The setting is per model rather than per provider, because models sharing a route may have different capabilities. Hand-declared models remain conservative until a user chooses a capability.

The Desktop reasoning control keeps visual identity separate from provider identity. It remembers the accepted six-stop position in a bounded profile-backed map keyed by exact session/provider/model route and uses that position for the slider and collapsed trigger as long as the Host still reports the mapped actual effort. Dispatch, durable model selection, and model-limit copy continue to use only Host-advertised actual effort ids. Ultra on a High-only model therefore remains visibly Ultra across remounts, session switching, random Desktop ports, and application restarts while the Host receives and records High.

## Verification

Client tests distinguish exact High-only capability from a `low`/`medium`/`high` ceiling, preserve Ultra in the collapsed trigger, persist the exact session/model visual route through the authenticated Host preference seam, and restore Ultra after the control remounts. HTTP tests cover strict patch shapes, corrupt reads, and bounded route data. The real Models web composition creates a declared route through the browser, selects its per-model capability, verifies the resulting settings document, and snapshots the reopened control. The packaged Desktop smoke keeps a High-only route, selects Ultra, and requires the live trigger to say Ultra while the stored actual effort remains High.

## Alternatives considered

**Assume every hand-declared model supports every effort.** Rejected because model-list endpoints do not report reasoning protocol support, and silently sending unsupported parameters would turn a configuration convenience into provider failures.

**Add one provider-wide reasoning switch.** Rejected because one provider can serve models with different ceilings; a route-wide value would either overclaim support or hide capability from stronger models.

**Send `ultra` to the provider or change the core effort id.** Rejected because Ultra is a Desktop presentation stop, not a capability every adapter advertises. The core continues to require exact adapter-owned ids as defined by the [adapter-owned capability decision](../architecture/2026-07-24-adapter-owned-reasoning-effort-capabilities.md).

**Relabel Ultra to the mapped actual value.** Rejected because it makes the control appear to undo the user's selection. The separate model-limit line already communicates the real ceiling without changing the chosen visual stop.

## Consequences

Custom models gain an explicit, safe path to the reasoning slider without changing adapter defaults or inventing capabilities. Choosing a standard ceiling assumes the endpoint accepts every standard level through that ceiling; deployments with custom wire spellings still use `settings.yaml`, and untouched hidden mappings survive ordinary model edits.

Visual and actual effort names can intentionally differ. The visual choice is retained for up to 64 exact session/provider/model routes in the plugin's local profile section, while the durable request fact remains the mapped Host effort. The map contains no prompt or response text, uses the plugin's existing exact capability-authenticated loopback endpoint, and evicts the oldest route when full.
