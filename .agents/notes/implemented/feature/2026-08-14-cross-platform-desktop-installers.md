# Agent Note: Cross-platform desktop installers

Status: implemented

English | [中文](2026-08-14-cross-platform-desktop-installers.zh.md)

## Problem

The official Harness ships a Web application and CLI, so desktop users must provision Node.js, start a terminal command, manage a browser tab, and avoid runtime ownership conflicts. The Intel desktop shell removes those steps on macOS, but its close behavior, process-group shutdown, open-file ownership check, ICNS packaging, and DMG cannot provide an installable Windows application.

## Decision

One Electron desktop source supports Intel macOS and Windows x64. The shared shell owns a loopback-only `dsh web` child, hardened renderer, restore state, commands, and rounded whale identity; explicit platform decisions own only behavior that differs by operating system.

- macOS retains the hidden-inset window, application menu, close-to-Dock behavior, POSIX process groups, exact data-root open-file ownership check, `.app`, and DMG.
- Windows uses a standard native frame, File/Edit/View/Window/Help menus, close-to-quit behavior, fail-closed PowerShell process discovery, and exact-PID `taskkill /T /F` cleanup.
- Workbench terminals select complete native commands: built-in PowerShell on Windows and the first available zsh or bash login shell on POSIX. Platform arguments are resolved together so Windows never receives the POSIX `-l` flag.
- Electron Builder emits one unsigned Windows x64 NSIS Setup in one-click, current-user, non-elevating mode. Interactive install creates desktop and Start menu shortcuts and launches the application; uninstall preserves Harness and Electron data.
- The rounded RGBA master generates both [`icon.icns` and `icon.ico`](../../../../apps/desktop/README.md#icon-provenance), so Finder, Dock, Windows Explorer, shortcuts, Setup, and uninstall share one application identity.
- The [Windows Setup design](../../../../docs/superpowers/specs/2026-08-14-deepseek-harness-windows-setup-design.md) owns the complete packaging, lifecycle, and failure behavior.

## Native verification

Platform-independent tests exercise Windows menu and window decisions, command parsing, fail-closed ownership discovery, process-tree termination, NSIS settings, workflow wiring, and packaged-smoke process parsing on macOS. Production staging validates the built desktop entrypoints, Web client, runtime CLI, icon containers, and native-module presence.

The dedicated `Windows Desktop Setup` workflow and the repository's native Windows pull-request job run on GitHub's standard public `windows-2025` runner. The dedicated workflow derives the exact Setup and checksum names from `apps/desktop/package.json` and is the bounded release path: immutable install, complete product build, Setup packaging, visible installer pages, isolated install, both-shortcut verification, packaged launch with temporary Harness and Electron data, shared Add-menu, workbench and reasoning controls, exact clipboard values and denial feedback, native close, listener and process-tree cleanup, uninstall, data-marker preservation, SHA-256, and artifact upload. It has no release-write permission; an operator appends only the verified Windows assets after acceptance. The broader native job retains the complete Windows inventory as additional evidence; the self-hosted master standby runs the same packaging lifecycle when such a runner is configured.

## Alternatives considered

**Ship a shortcut to the Web application plus a setup script.** Rejected because users would still depend on Node.js, a terminal, browser ownership, and visible port management; it does not satisfy one-click desktop installation.

**Cross-build the Windows installer on macOS by disabling Electron native rebuilding.** Rejected because `node-pty` explicitly refuses cross-platform `node-gyp`, while package-manager optional dependency selection also follows the host. A generated file could look complete while carrying the wrong native closure.

**Use one close and process-cleanup implementation on both platforms.** Rejected because close-to-Dock is conventional on macOS but surprising on Windows, and Windows has neither POSIX process groups nor the same non-elevated data-root open-file proof.

**Keep versioned Windows artifact names fixed in the workflow.** Rejected because a Desktop version bump could silently build the current product while smoke, checksum, or upload still targets an older filename.

## Consequences

- Windows users double-click one Setup and receive a ready desktop application without administrator elevation or a separately installed runtime.
- Windows treats every observable external `dsh web` process as a conflict because it cannot prove a different `DSH_HOME` through a built-in non-elevated inspection. This prefers data safety over concurrent independent Harness instances.
- Windows release evidence requires a native Windows x64 run; a macOS cross-build failure is expected and never counts as a release result.
- Appending Windows assets to an existing cross-platform Release never rebuilds or replaces its Mac assets; exact asset names and before/after asset metadata are part of release acceptance.
- Local artifacts remain unsigned. Windows SmartScreen and macOS Gatekeeper may require user confirmation until trusted platform signing credentials are configured.
