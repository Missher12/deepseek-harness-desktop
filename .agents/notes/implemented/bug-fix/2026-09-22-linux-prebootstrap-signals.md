# Agent Note: Preserve signalled Linux exits before bootstrap consumption

Status: implemented

English | [中文](2026-09-22-linux-prebootstrap-signals.zh.md)

## Problem

An ordinary or terminal Linux launcher may receive a cancellation or timeout signal before its bootstrap reads the private launch request. The outcome adapter treated every unread request as a startup error, replacing the OS-reported termination signal and breaking caller cancellation and timeout classification.

## Decision

An unread launch request is a startup error only when the launcher exited without an observed signal. Ordinary and terminal outcomes preserve the actual exit signal; no signal is inferred from intent or an exit code. A recorded bootstrap error remains authoritative even if termination follows it. Managed-range signalling, quiescence checks, and artifact cleanup retain their existing ownership.

## Alternatives considered

**Ignore every unread request after termination was requested.** Rejected because termination intent does not prove why a launcher exited.

**Increase timeout values or wait for bootstrap before accepting cancellation.** Rejected because cancellation remains valid during startup and must not depend on machine speed.

## Consequences

Early signalled termination reaches the normal killed or timed-out caller path. Unsignalled startup failures still reject, and persisted bootstrap failures keep their original details. Unit tests cover ordinary and terminal SIGTERM/SIGKILL outcomes alongside both failure controls; Linux CI exercises the real process lifecycle.
