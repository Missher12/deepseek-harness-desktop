# Agent Note: Test observation ownership during persistence reads

Status: implemented

English | [中文](2026-09-22-observation-read-ownership.zh.md)

## Problem

Three cold-observation tests expected an additional event-clone loop to yield after 800 events. Persistence reads now declare detached or shared-frozen event ownership, and restoration adopts those values without a second clone, as specified by [read-only migration preparation](../architecture/2026-09-05-read-only-session-migration-preparation.md). The tests and query README retained the earlier clone-loop assumption.

## Decision

The observation tests verify a complete caller-owned outer array whose event values retain the persistence result identities. Cancellation and live-owner takeover run while an explicitly suspended persistence read is pending; each test releases and joins that read before disposing its Context. The query README describes the current ownership and cancellation behavior.

## Alternatives considered

**Restore redundant cloning to satisfy the old tests.** Rejected because the persistence result already supplies the ownership needed for adoption and the extra traversal adds work to every cold read.

**Remove cancellation and takeover coverage.** Rejected because both remain required before a stored Session is prepared or cached.

## Consequences

The tests exercise complete reads, cancellation, and live-owner preference without assuming a fixed event count forces an event-loop yield. Product runtime behavior is unchanged.
