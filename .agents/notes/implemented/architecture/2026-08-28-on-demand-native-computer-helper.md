# Agent Note: On-demand native Computer Use helper

Status: implemented

English | [中文](2026-08-28-on-demand-native-computer-helper.zh.md)

## Problem

Desktop needs a native-process boundary for later application observation without loading native authority into Harness, opening a local port, or accidentally shipping an input-injection implementation before its permission and policy layers exist.

## Decision

`native/computer-use-helper` is a three-crate Rust workspace. The protocol crate consumes the same closed manifest and fixtures as TypeScript; the core crate owns monotonic leases, targets, and quotas; the binary owns only bounded length-prefixed stdin/stdout. Electron's `NativeHelperProcess` starts the packaged binary on the first strict helper request, admits at most 32 correlated pending requests, copies every frame, applies the request timeout locally, discards child stderr, and uses EOF followed by a bounded terminate/kill ladder for shutdown. No TCP or HTTP endpoint exists.

The packaged helper selects a target-specific macOS 14+ or Windows x64 backend while unsupported targets keep the null backend. macOS status performs only prompt-free TCC preflights; list binds each on-screen SCK window number to PID, kernel process-start time, and bundle identity; snapshot uniquely rebinds that exact target to one AX window and optionally captures it through ScreenCaptureKit. Windows binds HWND, PID, process-creation identity, bounds, and per-monitor DPI; snapshot projects a bounded, redacted UI Automation tree and optionally captures the exact HWND through Windows Graphics Capture. Both backends revalidate identity, expose only bounded semantic refs, emit adjacent bounded PNG frames, and fail closed for hidden, minimized, off-window, late, reused, or protected targets.

Input is now available only after Electron installs an exact target-bound lease and the helper has produced a fresh semantic snapshot. The macOS backend uses CGEvent and the Windows backend uses SendInput; both revalidate identity, permission, cancellation, deadline, capability, quota, and snapshot revision before native events and keep a release journal for Stop, revoke, EOF, and crash recovery. Neither backend elevates, mutates privacy settings, or falls back to AppleScript or PowerShell. Electron maps denied/unknown permission state to display-only manual system guidance.

The release build pins Rust 1.95.0 and `Cargo.lock`. A shell-free build script selects only Intel macOS or Windows x64, validates the actual Mach-O/PE header, clears generated `native-bin`, and stages one matching executable. Desktop staging repeats the identity, count, header, and macOS executable-bit checks. Electron Builder places the selected helper outside ASAR, and release lanes run format, Clippy, tests, build, and staging on their native host. Windows Setup acceptance then drives that exact installed helper against two isolated harmless windows and one protected fixture, proving UI Automation, bounded Windows Graphics Capture PNG framing, SendInput, protected-target denial, Stop/lease revocation, EOF exit, Harness close, uninstall, process cleanup, and data preservation.

## Alternatives considered

**Run native observation inside Electron.** This would reduce one process but place native parser, lease, and future permission failures in the UI authority process and remove the narrow crash boundary.

**Expose a loopback helper service.** A port would add discovery, authentication, lifecycle, and cross-user attack surface without helping the one owning Electron process.

**Enable input together with the initial transport.** Rejected because it would have bypassed platform permission, approval, foreground-target, recovery, and real-host validation. Input shipped only after those authority layers and native cleanup acceptances existed; the closed protocol preserved `NOT_SUPPORTED` until then.

## Consequences

Desktop carries a small pinned Rust supply chain and two native build lanes, recorded in the generated third-party notices. The helper remains dormant for CLI/Web and while Desktop Computer Use is idle. macOS observation depends on Screen Recording and Accessibility grants, but querying their current state never triggers a prompt. Windows rejects secure-desktop, higher-integrity, UIPI-blocked, reused-identity, and sensitive targets without elevation. Native input is therefore gated by both reviewed authority code and real-host cleanup acceptance rather than by protocol availability alone.
