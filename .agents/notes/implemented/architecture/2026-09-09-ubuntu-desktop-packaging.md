# Agent Note: Ubuntu Desktop packaging and native acceptance

Status: implemented

English | [中文](2026-09-09-ubuntu-desktop-packaging.zh.md)

## Problem

Desktop release staging covered macOS and Windows, while Linux requires its own native modules, package dependencies, desktop integration and Chromium user-namespace policy. An installer created on another operating system does not establish that those pieces work together.

## Decision

Build x64 `.deb` and AppImage packages natively on Ubuntu 22.04 using Clang 15 and a probed Landlock launcher. Extend the shared staging inventory with the Linux builder configuration and use the existing PNG master for the native window. The Ubuntu owner supplies the platform configuration, launch wrapper, AppArmor helpers and lifecycle tests; shared runtime source retains one implementation owner.

Both Ubuntu 22.04 and 24.04 consume the exact same artifacts and verify their SHA-256 digests. Native checks exercise installation, renderer isolation, a controlled loopback model, shutdown and data-preserving removal. They record package identity and kernel observations independently of UI readiness. X11/Xvfb evidence does not establish Wayland acceptance.

Startup conflict detection inspects another Harness Web process with the operating system's installed `lsof`: `/usr/bin/lsof` on Linux and `/usr/sbin/lsof` on macOS. Only files below the same Harness home establish a conflict. Missing executables and denied inspection remain failures; they cannot establish that another writer is absent.

## Alternatives considered

**Use the builder's legacy AppImage sandbox fallback.** It can add `--no-sandbox`. The packaged launcher rejects sandbox-disabling flags, and the renderer must retain Seccomp, NoNewPrivs and a separate user namespace.

**Disable Ubuntu 24.04's system-wide user-namespace restriction.** A per-application policy grants the needed permission to the installed Debian executable or one explicit AppImage path. Native tests keep the system restriction enabled.

## Consequences

Debian installation manages its desktop entry, icons, dependencies and AppArmor policy. AppImage users on Ubuntu 24.04 run the matching exact-path helper before launching; changing the path requires updating that policy. Linux self-update, ARM64 and Wayland acceptance are not included. Package build success alone is insufficient release evidence; a release requires the complete native lifecycle checks at the final shared source revision.

## Testing

Local tests cover staging, native window options, host-specific open-file commands, distinct Harness homes, inspection failures, the Linux launch wrapper and accepted or rejected kernel observations, including Chromium's space-joined process title. The native matrix retains installed-byte hashes and failure evidence. Platform acceptance status belongs in the release handover, rather than this implementation note.
