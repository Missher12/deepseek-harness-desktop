# Agent Note: Desktop control authorization diagnostics

Status: implemented

English | [中文](2026-08-28-desktop-control-authorization-diagnostics.zh.md)

## Problem

Computer Control collapsed operating-system permission denial, disabled product policy, an empty application allowlist, a declined native task challenge, and a protected target into one model-visible message. Application enumeration still succeeded before lease acquisition, so a user with both macOS permissions granted could see every window, receive the same protected-target error for every operation, and never reach the native task challenge. The settings module did not explain that enumeration, persistent application allowlisting, ordinary Harness tool approval, and the Desktop task lease were separate decisions.

## Decision

The protocol error roster includes `CONTROL_DISABLED`, `TARGET_NOT_AUTHORIZED`, and `APPROVAL_DENIED`. Electron main emits each only at its owned decision point. A disabled native-application surface and a request with no allowlisted application fail before the native challenge; a cancelled native challenge fails afterward. `PERMISSION_DENIED` remains an operating-system result, `TARGET_CLOSED` describes an allowed target that is no longer current, and `POLICY_DENIED` remains the protected-target result. The Computer tool maps each code to bounded corrective text and never forwards provider diagnostics.

The settings application section displays a corrective status when Computer Control is available and enabled but no enumerated application is allowed. It states that listing is not authorization and that each new task uses a separate Electron-native approval which the ordinary Harness `ask` or `never` policy does not replace. Application changes retain the existing main-owned confirmation and persistent allowlist; no renderer or model field can mint a lease or approval.

## Alternatives considered

**Change only the protected-target sentence.** Rejected because one replacement sentence would still merge unrelated decisions and provide the wrong correction for at least four states.

**Automatically allow every enumerated application or remember a task approval forever.** Rejected because enumeration is observation, not consent, and a durable Desktop lease would silently widen control beyond the confirmed task.

**Forward Electron or helper error text to the model.** Rejected because internal diagnostics may contain target facts and are not a stable user contract. Closed error codes preserve actionable distinctions without carrying raw content.

## Consequences

A zero-allowlist installation now fails before native approval with a precise settings instruction, while an allowed application reaches the separate native task challenge. macOS permission failure and protected targets remain fail-closed and visibly distinct. The wire roster grows by three codes and both TypeScript and Rust validate the same manifest. Existing callers that exhaustively switch on `DesktopControlErrorCode` must handle the new values.
