# Agent Note: Platform-specific Desktop updates

Status: implemented

English | [中文](2026-09-09-platform-specific-desktop-updates.zh.md)

## Problem

A release can contain several native packages and a newer official Harness core without changing the currently installed application. Treating those packages as interchangeable, or reporting a successful helper handoff as a completed installation, gives users an incorrect version or installation guarantee. A renderer-provided path or command would also turn the update bridge into a privileged launcher.

## Decision

The native [release validator](../../../../apps/desktop/src/update/release.ts) selects one exact platform, architecture and package format. macOS retains its schema-1 manifest name; Windows Setup, Linux `.deb` and Linux AppImage have separate schema-2 manifest names and exact tag URLs. The manifest generator rejects indirect input files and cross-platform output-name collisions. Latest official core metadata is advisory; running Desktop and included Harness versions remain separate truths.

The main process exposes six fixed, no-argument update operations only to its trusted main frame. The flat snapshot contains presentation data, never local paths or executable authority. The [download service](../../../../apps/desktop/src/update/service.ts) counts actual streamed bytes, verifies size, SHA-256, physical file identity and native format, and retains verified packages. Cancellation removes only the owned incomplete stage. Rechecking updates does not discard a verified package; installation holds a transaction across confirmation, verification and helper preparation so a concurrent check cannot change the selected state.

The [installation dispatcher](../../../../apps/desktop/src/update/install.ts) preserves the existing protected macOS helper. Windows confirms saving work and closing the app, prepares a fixed system-PowerShell helper, waits for its readiness acknowledgement, and only then requests app exit. The helper holds the exact parent process, waits for exit, rechecks the physical Setup and launches a visible wizard without silent arguments. Linux only reveals the verified parent directory; it does not execute, elevate, chmod, change AppArmor or quit. The typed result distinguishes handoff, manual-package readiness, observable pre-handoff cancellation and failure; none means installation completed.

The [settings plugin](../../../../packages/client/ui-settings-system-update/README.md) renders platform-specific actions and actual byte progress. Initial status failures have a status-only retry; stale responses and disposed subscriptions cannot overwrite newer state. macOS copy does not promise an extra native confirmation; only Windows asks for one.

The Windows helper uses an attached short bootstrap and a native `Start-Process` worker. The bootstrap retains the worker handle, creation time and system executable identity, validates a bounded physical nonce receipt, and emits exactly one readiness line. Approval is published complete under a private final filename; cancellation is serialized, irreversible and checked while waiting for the retained parent handle. The application accepts readiness only after validating the entire stdout and successful bootstrap exit. Failed preparation cancels and stops a known worker through its exact handle and identity; the application and verified payload remain available.

## Alternatives considered

**One manifest and one install action for every platform.** Rejected because a DMG replacement, visible NSIS wizard and manually installed Linux package have different ownership and completion semantics. Native selection prevents format guessing and cannot overwrite the Mac manifest during generation.

**Renderer-selected paths or shell commands.** Rejected because the installed application, not a web page, owns the exact release asset and verified staging directory. A narrow no-argument bridge keeps untrusted data out of executable selection.

**A direct detached PowerShell or pipe-owned console host.** Native probes show the detached PowerShell can exit without executing its script, whereas the attached bootstrap executes. A long-lived attached child depends on the creator's libuv job lifetime; a pipe-owned console host also couples shutdown to its input pipe. The native worker avoids those dependencies, but requires installed-main creation and post-creator-exit acceptance rather than a test-driver-only launch.

**Silent Windows replacement and automatic Linux privilege changes.** Rejected because users need visible Setup progress and explicit control of Linux package management and exact-path sandbox policy. Windows reports only handoff; Linux remains a manual install.

**Delete verified packages on the next check or on exit.** Rejected because the native helper or repeated Linux reveal still needs those bytes. Only incomplete, owned downloads are automatically removed; a retention policy is outside this implementation.

## Consequences

Installed Windows versions without the bridge require a manual Setup bootstrap. Failed verification keeps the application open and removes install authority without deleting the retained file. Cancelling before Windows handoff keeps the current application open; cancellation or failure inside the external wizard is not observable as an installation result. A helper acknowledgement is not proof of a finished upgrade.

## Testing

Platform-matrix tests exercise native-shaped inert packages, wrong size/hash/format, cancellation, retained files and older asynchronous responses. Controlled-promise tests pause Windows confirmation, revalidation and handoff while a concurrent check runs. UI tests cover all platform actions, initial-status retry, stale/disposed rejection and localized copy. The Windows-only helper tests parse real PowerShell and verify readiness and wrong-hash rejection using an owned temporary parent; they stop the helper before an inert payload could run.

Those tests do not prove a real Setup upgrade. Native acceptance separately requires the final same-SHA installed application, real settings bridge, visible Setup handoff after process exit, installation lifecycle and user-data preservation. Platform-independent passes or a helper readiness acknowledgement do not substitute for that evidence.

The handoff driver creates the production bootstrap inside the installed Electron main, verifies the observed main-to-bootstrap-to-worker identities, closes the creator, and checks the worker-to-Setup identity, visible Welcome and controlled Cancel. Its observer remains attached to the live test driver. This path requires Windows native execution; local signal, cancellation and parser-source checks cannot establish worker survival or wizard visibility.
