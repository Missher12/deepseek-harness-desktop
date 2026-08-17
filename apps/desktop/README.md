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

The removable `@deepseek-ai/dsh-session-messenger` plugin adds bounded,
same-profile session communication. Native Function Calling and Code Mode can
send without waking, queue a wake-up follow-up, reply through a single-use
receipt token, or wait for the matching reply. The compact sidebar-footer
panel reports pending and unread receipts, marks notifications read, and
copies the current Session ID. It never creates automatic Agent-to-Agent
loops, and received text remains untrusted content.

The removable `@deepseek-ai/dsh-reasoning-effort` plugin replaces the plain
effort rows with a keyboard-accessible slider that uses only values advertised
by the selected model. Its Harness-styled portal opens below when space allows
and flips above when needed, retains HanaAyane's attributed Canvas particles,
keeps the optional character disabled by default, and persists the accepted
effort through the existing model-selection path.

The Desktop composition also pins `dshmarket@1.10.1` as an in-app **Plugin
Market** settings section. Search, install, update, uninstall, grouping, and
backup operations target only the active `web` profile and run through the
packaged `pnpm@11.7.0`; they do not depend on a system pnpm or PATH. Desktop
self-restart is disabled, mutating HTTP routes require the same loopback
origin, and installs must match the curated registry. The ordinary browser
profile remains unchanged when the Desktop-only patch is absent. Plugins are
third-party code: inspect their source and requested build-script approvals
before installing them.

The market presentation uses a compact, single-column Harness list with
40-pixel icons, two-line descriptions, a sticky search/category toolbar, and
stable **Discover / Installed / Updates / Activity** tabs. Each discovery row
keeps one primary action; details, source, and package-name copy live in its
overflow menu. The active market package cannot disable, uninstall, or update
itself (`dshmarket` and `dsh-market` are both rejected before the package
runner), while ordinary plugin operations retain the upstream route behavior.

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

Run this command on native Windows x64. It produces `apps/desktop/release/DeepSeek-Harness-Setup-0.1.5-win-x64.exe`. Production staging uses a dedicated short directory on Windows CI to keep native MSVC rebuilds below legacy path limits; all release output is written to `apps/desktop/release`.

The Windows Setup is a one-click, per-user NSIS installer. It needs no administrator elevation, Node.js, pnpm, terminal, browser, or fixed port; it creates desktop and Start menu shortcuts and launches DeepSeek Harness after an interactive install. Uninstall removes the application and shortcuts while preserving Harness and Electron user data.

The application uses an operating-system-assigned loopback port and does not reserve port 65000.

The current locally verified Intel artifact is
`DeepSeek-Harness-0.1.5-mac-x64.dmg`, 163,335,534 bytes, SHA-256
`a0097c21c909171e7d7158633f639bb8e61beb46a5a38039918f171ba0b74974`.

## Packaged verification

For Intel macOS, build the directory app and run:

```bash
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts --config vitest.config.ts
```

For Windows, build the Setup on native Windows and run:

```powershell
./scripts/windows-desktop-setup-smoke.ps1 `
  -SetupPath apps/desktop/release/DeepSeek-Harness-Setup-0.1.5-win-x64.exe
```

The packaged smokes use an external temporary working directory, temporary Electron data, and temporary `DSH_HOME`. The Intel macOS smoke verifies the preload bridge, three-column workspace, exact ordinary and archived Session IDs in the real system clipboard without opening, restoring, deleting, sending, or starting an Agent, session-messenger notification/read/copy behavior, the down-first adaptive reasoning slider and persisted effort, visible Canvas output with the optional character off, compact Plugin Market tabs/search/categories/row geometry, protected self-update, a real ordinary isolated-profile uninstall, random listener, and complete process cleanup after native Quit. Desktop staging additionally requires exactly one `dshmarket@1.10.1`, coherent compact markers in its source, Client bundle, and source map, the Host self-protection marker, immutable Desktop patches, plugin-runtime providers, and packaged pnpm bin. The Windows smoke additionally proves silent install, shortcut creation, real clipboard copy, uninstall cleanup, and data preservation. Native Windows CI builds the Setup, runs this smoke, records SHA-256, and uploads both files.

Local artifacts are unsigned. macOS may require **Open** from Finder's context menu; Windows SmartScreen may require confirmation of the unknown publisher. Removing those prompts requires trusted platform signing credentials.
