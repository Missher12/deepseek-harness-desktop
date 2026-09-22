# Agent Note: Stop an active Linux scope before bootstrap consumption

Status: implemented

English | [中文](2026-09-22-linux-prebootstrap-scope-stop.zh.md)

## Problem

A Linux launcher can receive a cancellation and exit before its bootstrap consumes the private launch request. The user manager can still retain the corresponding transient scope as loaded and active with no running target. A zero-status `systemctl kill` in this state does not prove that the empty scope will become inactive, so `waitForExit()` can wait indefinitely.

## Decision

When the direct launcher has exited, the request file remains, and the manager reports the exact unit as loaded and active, `SystemdScopeOwner` sends `systemctl --user stop --no-block <exact-unit>` once and continues polling. It reports non-missing stop failures and returns only after the manager confirms the unit inactive or absent. A missing-unit stop result remains subject to the existing manager observation. Consumed requests, running launchers, pending signal strength, and normal active descendants keep their existing handling.

## Alternatives considered

**Treat a zero-status scope kill or direct launcher exit as quiescence.** Rejected because both observations can precede the manager stopping an empty active scope.

**Scan the global process table or add a longer timeout.** Rejected because systemd owns the exact scope and a timeout does not establish that it is inactive.

**Send the command through a fallback owner.** Rejected because native launch may already have started and replaying argv could execute the user command twice.

## Consequences

Pre-bootstrap cancellation now explicitly tears down a manager-retained empty scope and waits for an authoritative inactive or absent state. Successfully submitted stop requests are not repeated; a missing-unit result remains eligible for another stop request while the manager still reports the scope active. Stop failures remain visible to the owner, with no global process discovery or timeout-based claim of quiescence.
