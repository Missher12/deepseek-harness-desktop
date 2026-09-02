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
same-profile Agent messaging. Copy Session A's exact ID, paste it into Session
B, and ask B's Agent to send: Native Function Calling or Code Mode wakes A's
existing Agent, and A can reply or continue the same collaboration chain through
receipt-bound metadata. Five tools cover direct send, optional send-and-wait,
one-use Host-authorized reply, explicit matching-reply wait, and participant-
authorized stopping of the complete collaboration chain. Stop immediately
settles unresolved deliveries and waits and rejects later replies or
continuations; a fresh user-directed message still starts an independent chain.
Communication stays in ordinary Harness history, with only a compact
**Stop / Stopped** action on the existing source-side conversation row. There is
no header trigger, operator drawer, custom message card, or second archive. The
plugin never creates new sessions, subagents, or autonomous Agent-to-Agent loops,
and received text remains untrusted content.

Desktop General Settings exposes close behavior and tiered price estimates.
macOS defaults to keeping the app running after its window closes, while Windows
defaults to quitting; Windows creates a Show/Quit tray only when keep-running is
selected. Every explicit Quit stops the app-owned Harness process. The
conversation footer keeps the existing performance data and adds settled
latest-turn cost, session estimate, exact official-endpoint balance, and current
pricing tier on a second line. Disabling tiered estimates hides estimates and the
tier but preserves the exact balance.

The global **Personalization** section edits only a bounded Desktop-owned block
inside `$DSH_HOME/AGENTS.md`. It preserves manually maintained content outside
that block, uses revision checks and atomic replacement, and offers a default,
concise, friendly, or professional reply style. The saved instructions apply
from the next request; project-local `AGENTS.md` files remain the narrower
project authority.

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
40-pixel icons, two-line descriptions, a sticky search/filter row plus a
separate category rail, and
stable **Discover / Installed / Updates / Activity** tabs. Each discovery row
keeps one primary action; details, source, and package-name copy live in its
overflow menu. Every registry category remains in source order on one
horizontally scrollable rail; selection never reorders chips, and edge controls
reflect the actual scroll bounds. The active market package cannot disable, uninstall, or update
itself (`dshmarket` and `dsh-market` are both rejected before the package
runner), while ordinary plugin operations retain the upstream route behavior.

Desktop includes one ordered local **Memory & Learning** stack: the
`@deepseek-ai/dsh-missher-brain@0.1.1-rc.2` coordinator, `dsh-missher-memory@0.2.0`, and the
Harness-native `dsh-missher-evolution@0.1.1`. The user-facing settings page
shows reviewed project memory and learned workflows in plain language. Reviewed
project facts and validated workflow rules share one bounded recall path; provider timeout or
failure never blocks a normal reply. Project memory adds local FTS5 search and
reversible exact-duplicate consolidation. The old TencentDB reader is included
as optional read-only compatibility code, but no user database is bundled,
written, migrated, consolidated, or used as MSE training input. All three
components appear as Desktop-managed built-ins in Plugin Market.

Usage Insights now bounds each Host refresh to 12 seconds and cancels pending
Session reads through their native persistence signals. Completed rows remain
available as a partial snapshot, timed-out rows are reported as omitted, and the
shared refresh always settles. A live Session's folded row remains process-local
and is invalidated by its next Session event, so reopening the page avoids
rescanning the same long log without persisting data ahead of its durable
revision. The renderer exits a still-pending first-load skeleton after 15
seconds and exposes Retry; a previously cached aggregate stays visible with a
stale notice.

The Desktop Settings shell now gives native, bundled, and profile-installed
sections one 760px content measure and one page-title, intro, and subsection
typography contract. Plugins still own their controls and domain layout, while
their title size, top spacing, and content origin no longer jump according to
source.

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

Run this command on native Windows x64. The Setup name is derived from `apps/desktop/package.json`; version 0.5.1 produces `apps/desktop/release/DeepSeek-Harness-Setup-0.5.1-win-x64.exe`. Production staging uses a dedicated short directory on Windows CI to keep native MSVC rebuilds below legacy path limits; all release output is written to `apps/desktop/release`.

The Windows Setup is a visible assisted, per-user NSIS installer. A normal double-click walks through Welcome, installation directory, expanded progress/details, and Finish pages. It needs no administrator elevation, Node.js, pnpm, terminal, browser, or fixed port; it creates desktop and Start menu shortcuts and offers to launch DeepSeek Harness from the finish page. Uninstall removes the application and shortcuts while preserving Harness and Electron user data.

The application uses an operating-system-assigned loopback port and does not reserve port 65000.

Release artifacts are accompanied by ASCII/LF `.sha256` files. Treat the
[public GitHub Release](https://github.com/Missher12/deepseek-harness-desktop/releases)
and its matching checksum asset as the authority for each artifact's exact bytes.

## Packaged verification

For Intel macOS, build the directory app and run:

```bash
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts --config vitest.config.ts
```

For Windows, build the Setup on native Windows and run:

```powershell
./scripts/windows-desktop-installer-ui-smoke.ps1 `
  -SetupPath apps/desktop/release/DeepSeek-Harness-Setup-0.5.1-win-x64.exe
./scripts/windows-desktop-setup-smoke.ps1 `
  -SetupPath apps/desktop/release/DeepSeek-Harness-Setup-0.5.1-win-x64.exe
```

The packaged smokes use an external temporary working directory, temporary Electron data, and temporary `DSH_HOME`. Native macOS and Windows acceptance verifies the preload bridge, preference round-trips, hide-on-close with the Harness still running, window restoration, the three-column workspace, exact ordinary and archived Session IDs in the real system clipboard without opening, restoring, deleting, sending, or starting an Agent, peer-session send/reply metadata, ordinary no-card rendering and rejection side effects, the Add menu, the four-mode workbench, the down-first adaptive reasoning slider and persisted effort, visible Canvas output with the optional character off, all 371 Usage particles plus daily/weekly/cumulative hover semantics, stable Plugin Market category order plus separated search/filter/category geometry, random listener, and complete process cleanup after native exit. Protected self-update remains macOS-only and is explicitly absent on Windows. Tool-level acceptance separately proves bidirectional Agent wake/reply behavior, exact receipt-bound waiting, collaboration stop, and matching-reply refusal without making an external model request. Desktop staging additionally requires exactly one `dshmarket@1.10.1`, coherent compact and category-rail markers in its source, Client bundle, and source map, the Host self-protection marker, immutable Desktop patches, plugin-runtime providers, packaged pnpm bin, and the assisted-installer include. The Windows UI smoke walks the visible Welcome, destination, expanded progress/details, and Finish pages, while the lifecycle smoke proves the same feature behavior alongside silent install, shortcut creation, real clipboard copy, uninstall cleanup, and data preservation. Native Windows CI derives the artifact name from the package version, builds the Setup, runs both smokes, records SHA-256, and uploads both exact files.

Local artifacts are unsigned. macOS may require **Open** from Finder's context menu; Windows SmartScreen may require confirmation of the unknown publisher. Removing those prompts requires trusted platform signing credentials.
