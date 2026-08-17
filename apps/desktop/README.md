# DeepSeek Harness Desktop

English | [中文](README.zh.md)

Native desktop shell for the official DeepSeek Harness runtime. The app owns one loopback-only Harness child process on an operating-system-assigned port and renders the existing Harness Web client inside a hardened Electron window.

The sidebar includes a Codex-style archived-session manager. Archiving keeps
the session log and its Workspace position; the manager can restore it in
place. Permanent deletion is available only from the archive, requires an
explicit confirmation, and is rejected while the session is running.
Every non-blank session row exposes **Copy session ID** in its action menu,
and archived-session cards expose the same action without restoring or
deleting the session. The app copies the exact stable id and reports whether
the host clipboard accepted the write.

The composer model control includes a Claude Code-inspired reasoning-effort
landscape inside the existing model menu. Its wide DeepSeek-blue WebGL energy
field, Faster/Smarter direction labels, thin track, and luminous selected stop
remain part of the native Harness surface instead of appearing as a separate
skin. It renders only stops advertised by the selected model, preserves the
underlying effort id, and presents the exact `max` id as **ULTRACODE**. Pointer,
arrow-key, Home, and End interaction share the same validated selection path;
reduced-motion and WebGL-unavailable environments retain a static fallback.

The Desktop composition also pins `dshmarket@1.10.1` as an in-app **Plugin
Market** settings section. Search, install, update, uninstall, grouping, and
backup operations target only the active `web` profile and run through the
packaged `pnpm@11.7.0`; they do not depend on a system pnpm or PATH. Desktop
self-restart is disabled, mutating HTTP routes require the same loopback
origin, and installs must match the curated registry. The ordinary browser
profile remains unchanged when the Desktop-only patch is absent. Plugins are
third-party code: inspect their source and requested build-script approvals
before installing them.

## Icon provenance

`assets/icon-source.png` is the exact 1254×1254 RGBA master accepted for the
macOS and Windows applications on 2026-08-14. It retains the transparent
corners, cream rounded plate, blue inset, and white DeepSeek whale without
replacement or visual modification.

Source SHA-256:
`1fe0c2a3b6475c451f86dc999e97de33e4aabace244e35a284d1c5e162b0672a`

`assets/icon.icns` is a local format conversion of that source into the
standard macOS 16–1024 px iconset, and `assets/icon.ico` is the Windows
container generated from the same master. Their SHA-256 values are
`d453a58a11cb5247f83f3b220bca2c6f0f216f07a6c7dfbb4998bb9f9f72c54e`
and `2331df774341ce7796c1c0d06e708ae37bbde84a53e4edd2741659bbe8d4e4ae`.

## Build

Build each release on its native operating system. Platform-independent unit tests and staging checks can run elsewhere, but native modules make a cross-built installer insufficient release evidence.

### Intel macOS

```bash
pnpm run desktop:pack
pnpm run desktop:dmg
```

Both commands target Intel (`x86_64`) macOS. `desktop:pack` produces a directly launchable `.app`; `desktop:dmg` produces the install image.

### Windows x64

```bash
pnpm run desktop:setup
```

Run this command on native Windows x64. It produces `apps/desktop/release/DeepSeek-Harness-Setup-0.1.3-win-x64.exe`. Production staging uses a dedicated short directory on Windows CI to keep native MSVC rebuilds below legacy path limits; all release output is written to `apps/desktop/release`.

The Windows Setup is a one-click, per-user NSIS installer. It needs no administrator elevation, Node.js, pnpm, terminal, browser, or fixed port; it creates desktop and Start menu shortcuts and launches DeepSeek Harness after an interactive install. Uninstall removes the application and shortcuts while preserving Harness and Electron user data.

The application uses an operating-system-assigned loopback port and does not reserve port 65000.

The current locally verified Intel artifact is
`DeepSeek-Harness-0.1.3-mac-x64.dmg`, 160,717,590 bytes, SHA-256
`21127170a7f28fef0646706507cb0f7cc5bddd23f2170de0d32df8f14ff57760`.

## Packaged verification

For Intel macOS, build the directory app and run:

```bash
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts --config vitest.config.ts
```

For Windows, build the Setup on native Windows and run:

```powershell
./scripts/windows-desktop-setup-smoke.ps1 `
  -SetupPath apps/desktop/release/DeepSeek-Harness-Setup-0.1.3-win-x64.exe
```

The packaged smokes use an external temporary working directory, temporary Electron data, and temporary `DSH_HOME`. They verify the preload bridge, three-column workspace, archived-session manager, settings dialog, random listener, and complete process cleanup after macOS native Quit or Windows window close. Desktop staging additionally requires the immutable market patch, Desktop plugin-runtime provider, `dshmarket` Host and Client artifacts, and packaged pnpm bin. The Windows smoke additionally proves silent install, shortcut creation, real clipboard copy, uninstall cleanup, and data preservation. Native Windows CI builds the Setup, runs this smoke, records SHA-256, and uploads both files.

Local artifacts are unsigned. macOS may require **Open** from Finder's context menu; Windows SmartScreen may require confirmation of the unknown publisher. Removing those prompts requires trusted platform signing credentials.
