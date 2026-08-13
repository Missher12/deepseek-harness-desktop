# DeepSeek Harness Desktop — Project Context

## Project Goal

Turn the official DeepSeek Harness browser surface into a standalone Intel macOS application with a simple Codex-style desktop experience. The user must be able to launch it from Finder or the Dock without opening a browser or terminal.

## Verified Baseline

- Target machine: Intel (`x86_64`) Mac running macOS 15.7.4.
- Previously installed runtime: `@deepseek-ai/dsh@0.1.0-rc.6`.
- Desktop source baseline: official repository version `0.1.0-rc.5` at upstream commit `47f943859bef60e4160492346772ded9b24f765a`.
- Previous launch path: Hermes gateway → `npm exec @deepseek-ai/dsh web --port 65000` → Node web host.
- Current launch path: `/Applications/DeepSeek Harness.app` → owned bundled CLI → random loopback listener.
- Current UI: React/Vite browser application with workspaces, sessions, model and permission selection, tools, plans, jobs, settings, and a details pane.
- User data root: `~/.dsh`.
- Official source: <https://github.com/deepseek-ai/deepseek-harness>.
- Inspected upstream head: `47f943859bef60e4160492346772ded9b24f765a` on 2026-08-13.
- Upstream currently contains `apps/cli` and `apps/web`; there is no implemented desktop application.

## Confirmed Product Decisions

- Platform: this Intel Mac only for version 1.
- Product name: **DeepSeek Harness**.
- Layout: simple Codex-style three-pane workspace.
- Runtime ownership: the app starts and stops its own Harness; it does not depend on Hermes.
- Data: continue using the existing `~/.dsh` data and credentials in place.
- Transport: the embedded Harness binds to `127.0.0.1` on an OS-assigned random port; users never interact with the port.
- Startup: restore the last workspace and session.
- Scope: reuse the official UI and capabilities; add desktop behavior and targeted Codex-style polish instead of rewriting the interface.

## Architecture Summary

- Electron x64 application shell.
- Electron main process owns the application window and Harness child process.
- The child runs the pinned official `dsh web --host 127.0.0.1 --port 0` build.
- BrowserWindow loads only the discovered loopback URL.
- The existing React/Vite client and WebSocket transport remain intact.
- The renderer has no Node integration and receives no credentials.
- Desktop-only presentation changes live in explicit source modules, not injected selectors against minified bundles.
- The packaged app keeps its JS entrypoint in `app.asar` and unpacks runtime `node_modules`, allowing the profile fallback to create valid filesystem symlinks to in-box plugins.
- The preload bridge is one bundled CommonJS file because Electron's sandboxed preload runtime does not execute the main process's ESM format.

## Repository Shape

The repository is based on the pinned official source and adds the desktop application without editing installed npm-cache files.

- `apps/desktop/`: Electron main process, preload, lifecycle, packaging, and tests.
- `apps/web/` and `packages/client/`: reused renderer with narrow desktop presentation and command hooks.
- `scripts/stage-desktop.ts`: creates and validates a self-contained package staging tree.
- `docs/superpowers/specs/`: product, architecture, and implementation plans.

## Safety Boundaries

- Never copy credentials into the application bundle, logs, fixtures, or commits.
- Never bind the Harness host to `0.0.0.0`.
- Never run two independent Harness writers against `~/.dsh` without an explicit ownership check.
- Do not terminate an existing Hermes-launched Harness automatically during development or testing.
- Use a temporary `DSH_HOME` for automated tests. Live acceptance against `~/.dsh` is a separate, explicit step.
- Preserve the official data format and avoid migrations in version 1.

## Current Progress

- Read-only local runtime audit complete.
- Official source and architecture audit complete.
- Electron x64 application shell, native menu, loading/failure surfaces, random-port runtime ownership, window-state persistence, and the accepted cross-platform icon master complete.
- macOS and Windows share the exact 1254×1254 RGBA icon master (SHA-256 `1fe0c2a3b6475c451f86dc999e97de33e4aabace244e35a284d1c5e162b0672a`); the generated macOS 16–1024 px `.icns` has SHA-256 `d453a58a11cb5247f83f3b220bca2c6f0f216f07a6c7dfbb4998bb9f9f72c54e`.
- Desktop renderer styling and command hooks complete.
- Standalone package staging and unsigned local `.app` packaging complete.
- Isolated packaged smoke passed from outside the repository: clean `DSH_HOME`, preload bridge, random loopback listener, stable plugin graph, settings dialog, native quit, and complete process/port cleanup.
- Intel DMG regenerated with the accepted icon master and verified with `hdiutil`: `DeepSeek-Harness-0.1.0-mac-x64.dmg` (SHA-256 `6c8b1319563563ac204a77a274e2dcc57f5640026b3b2424d47c077bae5a8cae`).
- Live ownership migration complete on 2026-08-14: the exact legacy process group stopped gracefully, port 65000 was released, and the independent Hermes gateway remained running.
- A permission-restricted pre-migration backup is stored under `~/Library/Application Support/DeepSeek Harness Backups/pre-desktop-20260814-021540`.
- The final-icon application installed at `/Applications/DeepSeek Harness.app` passed live acceptance against the existing `~/.dsh`: HTTP 200 on random port 65320, the saved application window and Dock item loaded, Finder resolved `icon.icns`, all 518 profile fallback links resolved to physical packaged modules, and no virtual-asar link remained.

## Known Risks

- Upstream is still a release candidate and may change quickly.
- The installed package does not ship a ready-made Electron shell.
- The desktop source baseline is `0.1.0-rc.5`, while the previous npm runtime reported `0.1.0-rc.6`; the pre-migration backup is retained until longer-term use confirms compatibility.
- Signed/notarized distribution and automatic updates require Apple Developer credentials and are outside version 1.
- This local build is unsigned, so a copied build may require Finder's **Open** action on first launch.
