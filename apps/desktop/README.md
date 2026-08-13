# DeepSeek Harness Desktop

English | [中文](README.zh.md)

Native Intel macOS shell for the official DeepSeek Harness runtime. The app
owns one loopback-only Harness child process on an operating-system-assigned
port and renders the existing Harness Web client inside a hardened Electron
window.

## Icon provenance

`assets/icon-source.png` is the exact 1254×1254 RGBA master accepted for the
macOS and Windows applications on 2026-08-14. It retains the transparent
corners, cream rounded plate, blue inset, and white DeepSeek whale without
replacement or visual modification.

Source SHA-256:
`1fe0c2a3b6475c451f86dc999e97de33e4aabace244e35a284d1c5e162b0672a`

`assets/icon.icns` is a local format conversion of that source into the
standard macOS 16–1024 px iconset. Its SHA-256 is
`d453a58a11cb5247f83f3b220bca2c6f0f216f07a6c7dfbb4998bb9f9f72c54e`.

## Build

From the repository root:

```bash
pnpm run desktop:pack
pnpm run desktop:dmg
```

Both commands target Intel (`x86_64`) macOS only. Production staging is
isolated under `apps/desktop/.stage`; output is written to
`apps/desktop/release`.

`desktop:pack` produces a directly launchable `.app`; `desktop:dmg` produces
the install image. The app uses an operating-system-assigned loopback port and
does not reserve port 65000.

## Packaged verification

Build the directory app, then run from the repository root:

```bash
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts --config vitest.config.ts
```

The smoke uses an external temporary working directory, temporary Electron
data, and temporary `DSH_HOME`. It verifies the preload bridge, three-column
workspace, settings dialog, random listener, and complete process cleanup after
native Quit.

The local build is not signed or notarized with an Apple Developer identity.
Finder may require **Open** from the context menu on first launch after copying
the artifact to another location.
