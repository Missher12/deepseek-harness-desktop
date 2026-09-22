# Agent Note: Cover optional client services and pending operations

Status: implemented

English | [中文](2026-09-22-client-lifecycle-cases.zh.md)

## Problem

Client tests omitted native file opening when the optional Sidebar is absent, stale update-command results, repeated failure dismissal, non-Error host refusals, and several local model-preset outcomes. Preset refusal tests edited the row before the lookup settled, so they observed stale-row rejection instead of the named refusal. The Inspector Console test awaited a Client request while its ingest transport was paused, before reaching its unpause operation.

## Decision

Owning component and plugin tests exercise both Sidebar and native opening, including native refusal; preserve pushed update state when an older command completes; reject work after disposal; and verify model-preset admission, refusal, complete existing values, and untouched neighboring rows. The Inspector test retains one acknowledged Client round trip concurrent with unpausing, before producing the Console event.

## Alternatives considered

**Relax coverage or increase timeouts.** Rejected because the missing observations and paused-transport wait are deterministic test gaps.

**Call private implementation callbacks directly.** Rejected because the existing injected plugin APIs and rendered input events exercise the same behavior available to product consumers.

## Consequences

Existing production behavior is tested without new runtime branches or broader coverage exemptions. Deferred operations are released and joined during teardown, and the Inspector test still verifies two isolated Console sessions and remote object ownership.
