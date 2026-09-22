# Agent Note: Select fallback containment in fallback lifecycle tests

Status: implemented

English | [中文](2026-09-22-subprocess-fallback-test-ownership.zh.md)

## Problem

Two terminal lifecycle tests supplied a fake PTY and process-tree inspector but inherited the runner's containment selection. On Linux, the native scope created a launch request that the fake PTY never consumed, so a successful fake exit correctly failed bootstrap validation. A teardown test also assumed invalid-cwd rejection always won a race against cancelling the Linux launcher before bootstrap.

## Decision

These three tests select fallback containment through the existing runtime platform hook or a negative Linux capability probe and name that scope explicitly. Terminal tests continue to assert release after quiescence and retention after cleanup failure. The spawn-failure test retains its rejection assertion on the direct fallback launch path. Existing Linux scope tests separately verify native wrapping, startup refusal, cancellation signals, and owner cleanup.

## Alternatives considered

**Accept the fake terminal's unconsumed launch request.** Rejected because it would weaken production startup validation for a test double that never launches a bootstrap.

**Allow either rejection or cancellation in the teardown assertion.** Rejected because the test specifically owns rejection containment; native cancellation already has separate assertions.

## Consequences

The common lifecycle tests exercise the same selected path on every host. Native Linux startup behavior and production containment selection remain unchanged.
