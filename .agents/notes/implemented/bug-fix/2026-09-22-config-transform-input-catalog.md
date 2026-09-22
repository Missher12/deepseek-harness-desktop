# Agent Note: Catalog transformed configuration inputs separately

Status: implemented

English | [中文](2026-09-22-config-transform-input-catalog.zh.md)

## Problem

A runtime configuration transform can accept a legacy spelling and return a different field name. Comparing its input schema against the plugin's normalized configuration falsely rejects accepted aliases and leaves them out of the generated reference.

## Decision

The [config catalog generator](../../../../scripts/gen-config-catalog.ts) requires root `z.transform` callbacks to name their input parameter type. It pastes both input and normalized declarations and checks schema paths against the input. Schema aliases resolve through initialized local constants; unresolved, mutable, cyclic, or opaque declarations fail. Composing a transformed schema requires a typed outer transform so the aggregate input remains explicit.

## Alternatives considered

**Compare input keys against normalized output.** Renamed fields are valid inputs but absent from the output by design.

**Skip transformed schemas.** That hides accepted fields and loses the existing missing-field check.

## Consequences

Transform authors supply one explicit input type. Runtime parsing stays unchanged, and the catalog documents accepted aliases without adding them to normalized configuration. Generator tests cover accepted transforms and schema aliases, missing nested input members, unsupported declarations, cycles, and composed transforms.
