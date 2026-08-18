# Agent Note: Overlap safe Desktop startup work

Status: implemented

English | [中文](2026-08-18-overlapped-desktop-startup.zh.md)

## Problem

The Desktop lifecycle waited for the local loading page to finish before it began the read-only same-home ownership check. It then waited for that check before starting Harness. These independent waits lengthened the cold-start critical path even though the loading surface does not read or write Harness data.

## Decision

Desktop now starts the loading-surface promise and ownership check together. A detected writer still prevents any runtime start. After the check clears, the owned Harness start runs while the loading surface finishes; navigation to the Harness URL still waits for both operations and for the existing complete Harness readiness probe.

If native window creation fails after the runtime has started, Desktop stops the owned runtime before propagating the window failure. Runtime failures still render the existing closed startup-failure surface.

## Verification

A lifecycle test holds the loading page open and proves that ownership discovery has already begun, that Harness remains blocked until discovery clears, and that Harness can then start before the loading page settles. The complete isolated packaged macOS smoke passed against the rebuilt Intel application, including random-port ownership, extension UI, session messenger, exact Session-ID clipboard actions, protected-file equality, and complete shutdown cleanup.

The installed candidate returned HTTP 200 with a complete boot manifest on its owned random loopback port. Live before/after timing was not treated as comparative evidence because unrelated host processes saturated CPU during the measurement window.

## Alternatives considered

**Announce the loopback URL before the Loader tree settles.** This could show the Web shell sooner, but a sibling plugin may still fail after the URL is published. Desktop keeps the complete readiness signal truthful.

**Disable ordinary Harness plugins in the Desktop profile.** That would reduce work by removing product capabilities and could make Desktop behavior drift from the browser surface. The optimization keeps the same composition.

## Consequences

The change removes avoidable orchestration serialization without weakening writer exclusion or startup truthfulness. Harness plugin-tree activation and the approximately 5.5 MB initial Client script payload remain the larger cold-start costs and require separate architecture work if further reduction is needed.
