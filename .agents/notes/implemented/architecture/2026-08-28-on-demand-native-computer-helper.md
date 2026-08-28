# Agent Note: On-demand native Computer Use helper

Status: implemented

English | [中文](2026-08-28-on-demand-native-computer-helper.zh.md)

## Problem

Desktop needs a native-process boundary for later application observation without loading native authority into Harness, opening a local port, or accidentally shipping an input-injection implementation before its permission and policy layers exist.

## Decision

`native/computer-use-helper` is a three-crate Rust workspace. The protocol crate consumes the same closed manifest and fixtures as TypeScript; the core crate owns monotonic leases, targets, and quotas; the binary owns only bounded length-prefixed stdin/stdout. Electron's `NativeHelperProcess` starts the packaged binary on the first strict helper request, admits at most 32 correlated pending requests, copies every frame, applies the request timeout locally, discards child stderr, and uses EOF followed by a bounded terminate/kill ladder for shutdown. No TCP or HTTP endpoint exists.

This delivery is deliberately observation-shaped but has a null platform backend. Status and list are honest, snapshot dispatch reaches only the injected observation seam and returns `NOT_SUPPORTED` in the packaged backend, and Stop/revocation/input-release update only helper-owned state. Every input action returns `NOT_SUPPORTED`. The Rust source contains no TCC, Accessibility, ScreenCaptureKit, CGEvent, SendInput, AppleScript, or PowerShell integration.

The release build pins Rust 1.95.0 and `Cargo.lock`. A shell-free build script selects only Intel macOS or Windows x64, validates the actual Mach-O/PE header, clears generated `native-bin`, and stages one matching executable. Desktop staging repeats the identity, count, header, and macOS executable-bit checks. Electron Builder places the selected helper outside ASAR, and release lanes run format, Clippy, tests, build, and staging on their native host.

## Alternatives considered

**Run native observation inside Electron.** This would reduce one process but place native parser, lease, and future permission failures in the UI authority process and remove the narrow crash boundary.

**Expose a loopback helper service.** A port would add discovery, authentication, lifecycle, and cross-user attack surface without helping the one owning Electron process.

**Implement input APIs together with the transport.** This would make the feature appear more complete but bypass the later platform permission, approval, foreground-target, recovery, and real-host validation work. Closed `NOT_SUPPORTED` responses preserve the protocol without claiming that authority.

## Consequences

Desktop carries a small pinned Rust supply chain and two native build lanes, recorded in the generated third-party notices. The helper remains dormant for CLI/Web and while Desktop Computer Use is idle. Later platform work can replace the injected observation backend without changing framing or Electron process ownership, but enabling input requires a separate reviewed decision and native acceptance evidence.
