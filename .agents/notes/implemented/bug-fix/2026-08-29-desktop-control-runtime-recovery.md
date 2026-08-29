# Agent Note: Desktop control runtime recovery

Status: implemented

English | [中文](2026-08-29-desktop-control-runtime-recovery.zh.md)

## Problem

Keyboard names crossed three independently maintained contracts. Model tools accepted any string, TypeScript forwarded it, and the native helper accepted only a closed uppercase vocabulary. A lowercase shortcut letter therefore closed the helper protocol. Electron conservatively journaled that same unvalidated key before dispatch, so the recovery helper rejected the release request too. The exact session then retained failed cleanup, reported `NOT_SUPPORTED`, and could not recover through ordinary read-only status.

Browser address fields exposed a separate macOS interoperability gap: some applications identify the focused child through the application-level `AXFocusedUIElement` while omitting the child's `AXFocused` boolean. Requiring only the child boolean rejected text entry after a successful semantic click.

The authenticated Agent Browser proxy also applied a one-second socket timeout to both incomplete CONNECT handshakes and established page tunnels. A valid Windows DNS resolution or upstream connection taking slightly longer was cut off locally, while the caller observed only a later navigation timeout.

## Decision

Protocol v1 publishes one exact `controlKeyValues` roster. TypeScript bridge/helper codecs, Rust decoding, and recovery release frames validate that roster. Model tools expose only the roster plus lowercase single-letter aliases and canonicalize those aliases before the request reaches a provider. The conservative held-input journal therefore cannot retain a value that a recovery helper rejects.

macOS projection marks an editable or sensitive element focused when either its own `AXFocused` fact is true or its AX identity equals the application's `AXFocusedUIElement`. Input still requires a fresh exact ref, an editable non-sensitive classification, current process/window identity, permissions, lease, capability, quota, deadline, and cancellation checks before every native event.

Failed native input cleanup remains frozen to its exact official session. `computer.stop` retries it when no lease is active, and read-only `computer.status` or `computer.list` performs the same retry before reporting availability. A foreign session cannot consume or clear the journal, and a failed retry keeps admission closed.

The generation-owned loopback proxy uses a ten-second bound while proxy headers, request-time DNS validation, and upstream CONNECT are incomplete. An established authenticated tunnel uses a separate sixty-second idle bound and remains tracked for immediate generation disposal. Outer Desktop-control deadlines remain unchanged.

## Alternatives considered

**Coerce arbitrary key strings inside the native helper.** Rejected because it would make recovery accept a broader input surface than the normal protocol and preserve drift between model, Electron, and native code.

**Remove the focused-field requirement for text entry.** Rejected because a click handler or hostile application can retarget input between pointer delivery and text insertion. Application-level AX focus supplies the missing authoritative fact without weakening the revalidation gate.

**Increase only the outer bridge deadline.** Rejected because the local proxy was actively destroying valid slow CONNECT requests after one second. Waiting longer above a severed connection cannot restore navigation and makes failure slower.

## Consequences

Lowercase shortcut calls are encoded as canonical keys on macOS and Windows instead of terminating the helper. A transient failed recovery can be retried by the owning session without restarting Desktop, while ownership remains fail-closed until release succeeds.

Browser text entry works with accessibility implementations that publish focus only at the application level, but secure, ambiguous, stale, or unfocused fields remain protected. Agent Browser navigation tolerates ordinary Windows resolver latency without turning its authenticated proxy into an unbounded or unauthenticated service.
