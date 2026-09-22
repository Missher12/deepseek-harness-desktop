# Agent Note: Replay Linux cancellation after late scope establishment

Status: implemented

English | [中文](2026-09-22-linux-late-scope-cancellation.zh.md)

## Problem

A Linux transient scope can become visible to the user manager after `systemctl kill` reports that its unit is missing. The direct launcher may already have received the signal while the target later remains in the newly visible scope, so disposal can wait for a descendant that was not terminated.

## Decision

`SystemdScopeOwner` records a cancellation only when the scope signal result identifies a missing unit, and retains the strongest pending signal. It replays that signal when an active scope is observed, keeps it when the replay still reports a missing unit, clears it only after a successful scope kill at least as strong as the pending request, and discards it when the scope is inactive or failed. A non-missing `SIGKILL` failure remains an observable owner failure.

## Alternatives considered

**Wait for scope establishment before sending cancellation.** Rejected because a caller must be able to cancel a launcher during bootstrap and disposal must not depend on machine speed.

**Send the command again through a fallback process group.** Rejected because the native launch may already have started and replaying argv could run the user command twice.

**Treat request-file consumption as proof that the scope is visible.** Rejected because the bootstrap can consume the request before the manager exposes the transient unit.

## Consequences

Linux ordinary and terminal owners preserve cancellation across the manager-establishment race without repeating direct process-group signals. The strongest requested signal is not downgraded by a later weaker request, and pending retries stop once the signal is delivered or the scope is confirmed stopped.
