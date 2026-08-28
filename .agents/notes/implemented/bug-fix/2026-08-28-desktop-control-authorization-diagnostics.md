# Agent Note: Desktop control authorization diagnostics

Status: implemented

English | [中文](2026-08-28-desktop-control-authorization-diagnostics.zh.md)

## Problem

Computer Control collapsed operating-system permission denial, disabled product policy, an empty application allowlist, a declined native task challenge, and a protected target into one model-visible message. Application enumeration still succeeded before lease acquisition, so a user with both macOS permissions granted could see every window, receive the same protected-target error for every operation, and never reach the native task challenge. The settings module did not explain that enumeration, persistent application allowlisting, ordinary Harness tool approval, and the Desktop task lease were separate decisions.

Local macOS packages also ad-hoc signed the nested native helper without a fixed identifier or an explicit shared signing pass. The helper therefore acquired a hash-derived identity, while System Settings displayed the outer application. Replacing a build could leave both visible switches enabled even though TCC treated the helper that performed the preflight as different code.

Chrome exposed a second live interoperability failure after both permissions and its application allowlist were valid: ScreenCaptureKit named an ordinary window `about:blank`, while Accessibility named the same PID and geometry `about:blank - Google Chrome - <profile>`. Requiring those framework-specific titles to be byte-identical rejected the current window as closed before either semantics or pixels were captured.

A timed-out native challenge also left the first official Harness session claimed without an active lease. The global Stop path checked only the active lease, so a later session received `UNAUTHORIZED` until the Desktop process restarted even though the UI showed no active controller.

## Decision

The protocol error roster includes `CONTROL_DISABLED`, `TARGET_NOT_AUTHORIZED`, and `APPROVAL_DENIED`. Electron main emits each only at its owned decision point. A disabled native-application surface and a request with no allowlisted application fail before the native challenge; a cancelled native challenge fails afterward. `PERMISSION_DENIED` remains an operating-system result, `TARGET_CLOSED` describes an allowed target that is no longer current, and `POLICY_DENIED` remains the protected-target result. The Computer tool maps each code to bounded corrective text and never forwards provider diagnostics.

The settings application section displays a corrective status when Computer Control is available and enabled but no enumerated application is allowed. It states that listing is not authorization and that each new task uses a separate Electron-native approval which the ordinary Harness `ask` or `never` policy does not replace. Application changes retain the existing main-owned confirmation and persistent allowlist; no renderer or model field can mint a lease or approval.

The helper build assigns `computer-use-helper`, matching the final bare executable name, as the nested code identifier, and the macOS package lists that executable in Electron Builder's explicit binary signing roster. A certificate-backed package therefore signs the app and helper with one stable identity. The default local ad-hoc mode remains CDHash-bound and is not described as durable; official distribution requires Developer ID signing and notarization.

The macOS Accessibility binding now selects the only visible AX window in the already verified process whose finite geometry exactly matches the selected ScreenCaptureKit window. Framework titles are presentation data rather than identity. Zero matches and duplicate matching bounds still fail closed; the ScreenCaptureKit window number, process start identity, bundle identity, and fresh post-observation ScreenCaptureKit enumeration remain unchanged.

The main-owned global Stop path now revokes the active lease session when present, or the claimed official session when no lease became active. Revocation still awaits pending cleanup and keeps failed browser cleanup fail-closed; only a successful exact-session cleanup releases ownership for a later Harness session.

## Alternatives considered

**Change only the protected-target sentence.** Rejected because one replacement sentence would still merge unrelated decisions and provide the wrong correction for at least four states.

**Automatically allow every enumerated application or remember a task approval forever.** Rejected because enumeration is observation, not consent, and a durable Desktop lease would silently widen control beyond the confirmed task.

**Forward Electron or helper error text to the model.** Rejected because internal diagnostics may contain target facts and are not a stable user contract. Closed error codes preserve actionable distinctions without carrying raw content.

## Consequences

A zero-allowlist installation now fails before native approval with a precise settings instruction, while an allowed application reaches the separate native task challenge. macOS permission failure and protected targets remain fail-closed and visibly distinct. The wire roster grows by three codes and both TypeScript and Rust validate the same manifest. Existing callers that exhaustively switch on `DesktopControlErrorCode` must handle the new values.

The staged and packaged macOS helper now keeps a stable nested identifier and participates in the app's signing pass. Replacing an older hash-identified local helper can still require one final manual permission refresh. Future local rebuilds need the same certificate to preserve TCC identity; an ad-hoc rebuild alone does not provide that guarantee.

Ordinary Chrome windows no longer fail solely because ScreenCaptureKit and Accessibility format their titles differently. Live acceptance verifies bounded semantics and PNG capture against one `about:blank` Chrome window; ambiguity in PID or bounds remains a hard `TARGET_CLOSED` result.

After a cancelled or timed-out native challenge, the visible Stop action also clears the orphaned session claim. A new task can then acquire control without restarting DeepSeek Harness, while a cleanup failure continues to block ownership transfer.
