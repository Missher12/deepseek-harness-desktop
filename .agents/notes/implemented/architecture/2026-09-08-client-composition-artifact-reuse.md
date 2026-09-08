# Agent Note: Reuse immutable client composition artifacts

Status: implemented

English | [中文](2026-09-08-client-composition-artifact-reuse.zh.md)

## Problem

Each changed Loader flush recomposed every batch and single-module response. Unchanged bundles were repeatedly decoded, counted, mapped and serialized during cold startup.

## Decision

Keep prepared source and map sections on each record, keyed by its artifact revision because `rebuilt()` mutates records in place. Reuse complete combo artifacts by their ordered module ids and revisions plus the explicit single-module revision. Replace the combo cache with the current composition, leaving the existing previous-response generation responsible for racing requests. The package README owns the wire and retention contract.

## Alternatives considered

**Delay maps or omit them in production.** Maps contribute to combo revisions and preserve debugger locations. Removing them changes the existing artifact contract.

**Cache by record identity or retain every revision.** Identity misses in-place rebuilds; unbounded revision retention leaks obsolete bundles. Revision keys and current-composition retention avoid both problems.

## Consequences

Startup and HMR reuse unchanged bytes without deferring graph readiness. Code and map changes still invalidate responses, ordered sections and map-inclusive digests stay unchanged, and unavailable revisions retain the existing 404 behavior. Regression tests bound unchanged bundle decoding and exercise served code, map relocation, map-only rebuilds and prior-generation expiry.
