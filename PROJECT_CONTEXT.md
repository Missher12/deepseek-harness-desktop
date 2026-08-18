# DeepSeek Harness Desktop — Project Context

## Project Goal

Turn the official DeepSeek Harness browser surface into standalone Intel macOS and Windows x64 applications with a simple Codex-style desktop experience. The user launches the Mac application from Finder or the Dock, or installs the Windows application through one Setup executable, without opening a browser or terminal.

## Verified Baseline

- Target machine: Intel (`x86_64`) Mac running macOS 15.7.4.
- Previously installed runtime: `@deepseek-ai/dsh@0.1.0-rc.6`.
- Desktop source baseline: official repository version `0.1.0-rc.5` at upstream commit `47f943859bef60e4160492346772ded9b24f765a`.
- Previous launch path: Hermes gateway → `npm exec @deepseek-ai/dsh web --port 65000` → Node web host.
- Current launch path: `/Applications/DeepSeek Harness.app` → owned bundled CLI → random loopback listener.
- Current UI: React/Vite application with workspaces, sessions, model and permission selection, tools, plans, jobs, settings, a details pane, a Codex-style archived-session manager, and exact session-ID copy actions for active and archived sessions.
- User data root: `~/.dsh`.
- Official source: <https://github.com/deepseek-ai/deepseek-harness>.
- Inspected upstream head: `47f943859bef60e4160492346772ded9b24f765a` on 2026-08-13.
- Upstream currently contains `apps/cli` and `apps/web`; there is no implemented desktop application.

## Confirmed Product Decisions

- Platforms: Intel macOS and Windows 10/11 x64.
- Product name: **DeepSeek Harness**.
- Layout: simple Codex-style three-pane workspace.
- Runtime ownership: the app starts and stops its own Harness; it does not depend on Hermes.
- Data: continue using the existing `~/.dsh` data and credentials in place.
- Transport: the embedded Harness binds to `127.0.0.1` on an OS-assigned random port; users never interact with the port.
- Startup: restore the last workspace and session.
- Scope: reuse the official UI and capabilities; add desktop behavior and targeted Codex-style polish instead of rewriting the interface.
- Installation: Windows uses one per-user, non-elevating NSIS Setup with desktop and Start menu shortcuts; macOS keeps the Intel app and DMG flow.

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
- Platform decisions keep macOS close-to-Dock and process-group cleanup while Windows uses a standard frame, close-to-quit, fail-closed PowerShell conflict discovery, and exact-PID process-tree termination.

## Repository Shape

The repository is based on the pinned official source and adds the desktop application without editing installed npm-cache files.

- `apps/desktop/`: Electron main process, preload, lifecycle, packaging, and tests.
- `apps/web/` and `packages/client/`: reused renderer with narrow desktop presentation and command hooks.
- `packages/session/usage-insights/`: privacy-minimal, revision-aware all-history
  usage index and Settings Remote.
- `packages/client/ui-settings-usage/`: localized KPI, activity-chart, insight,
  and feature-ranking presentation for the usage snapshot.
- `scripts/stage-desktop.ts`: creates and validates a self-contained package staging tree.
- `scripts/windows-desktop-setup-smoke.ps1`: verifies isolated Setup install, shortcuts, packaged launch, window close, process cleanup, uninstall, and data preservation on native Windows.
- `docs/superpowers/specs/`: product, architecture, and implementation plans.

## Safety Boundaries

- Never copy credentials into the application bundle, logs, fixtures, or commits.
- Never bind the Harness host to `0.0.0.0`.
- Never run two independent Harness writers against `~/.dsh` without an explicit ownership check.
- Do not terminate an existing Hermes-launched Harness automatically during development or testing.
- Use a temporary `DSH_HOME` for automated tests. Live acceptance against `~/.dsh` is a separate, explicit step.
- Preserve the official data format and avoid migrations in version 1.

## Current Progress

- The 2026-08-18 Usage section is implemented between Models and Plugins. It
  summarizes all durable root, archived, and subagent Sessions with five KPIs,
  one stable Sunday-aligned 53×7 particle field with a daily calendar heatmap,
  bottom-up weekly/cumulative particle stacks, scope-specific rounded hover
  copy, an all-history baseline that keeps the final cumulative column equal to
  the headline total, activity insights, and a truthful
  Skill/Tool feature ranking. The Host keeps only derived identifiers and
  counters in a revision-aware cache; prompts, replies, tool payloads, titles,
  paths, attachments, and credentials never enter that cache. Host, Client,
  Settings, Remote, and bundle-focused tests pass. Packaged Intel macOS
  acceptance also passes against isolated data, including all 371 particles
  and the daily, weekly, and cumulative hover semantics.
- Read-only local runtime audit complete.
- Official source and architecture audit complete.
- Electron x64 application shell, native menu, loading/failure surfaces, random-port runtime ownership, window-state persistence, and the accepted cross-platform icon master complete.
- macOS and Windows share the exact 1254×1254 RGBA icon master (SHA-256 `1fe0c2a3b6475c451f86dc999e97de33e4aabace244e35a284d1c5e162b0672a`); the generated macOS `.icns` and Windows `.ico` have SHA-256 values `d453a58a11cb5247f83f3b220bca2c6f0f216f07a6c7dfbb4998bb9f9f72c54e` and `2331df774341ce7796c1c0d06e708ae37bbde84a53e4edd2741659bbe8d4e4ae`.
- Desktop renderer styling and command hooks complete.
- The 2026-08-18 source candidate keeps the default-off ordinary reasoning thumb fully inside both track endpoints and reflows the embedded Plugin Market from its real Settings container width. Every registry category stays in stable source order on one horizontally scrollable rail; selection never moves chips, edge controls and fades reflect the true scroll bounds, search and filter use a separate row above the category rail, and narrow plugin actions occupy a second row. The pinned market Client artifacts were rebuilt from upstream `v1.10.1`; final 0.1.8 staging and the isolated native packaged smoke refreshed the geometry evidence after the collaboration changes.
- The 2026-08-18 Desktop startup path now overlaps the local loading surface with the read-only ownership check, then starts Harness as soon as that check clears while the loading surface finishes. The same-home writer gate, complete Harness readiness probe, failure surface, and owned-process cleanup remain mandatory. A lifecycle regression test and the complete isolated packaged macOS smoke passed. Comparative live timing was not accepted on the installation host because unrelated processes saturated CPU during the run.
- The apparent session-messenger mark-read mutation was a smoke-fixture race, not an acknowledgement write: preserved failed logs contained only delayed selected-Session policy restoration. The fixture now seeds the current permission, sandbox, and approval records before its final end-seed and waits for protected storage to settle on both sides of copy and acknowledgement actions. Three consecutive complete packaged smokes passed with exact protected-file equality, and the final 0.1.8 packaged candidate repeated the complete isolated smoke before installation or publication.
- The model-control visual experiment was removed on 2026-08-17 after user acceptance rejected it. The original simple Host-advertised effort rows are restored, with no canvas, particle renderer, aliases, or invented effort ids.
- Version 0.1.5 reintroduces the requested richer control as the removable `@deepseek-ai/dsh-reasoning-effort` plugin instead of another core UI fork. It uses Host-advertised values, a down-first adaptive portal, HanaAyane's pinned attributed Canvas effect, and a profile-backed character opt-in that defaults off. Desktop dependency, immutable patch, duplicate-original/fork preflight, staged Host/Client/license/notice/sprite closure, and generated root attribution are integrated. Native packaged acceptance proves direct High startup, High-to-Max persistence, down-first/adaptive placement, non-empty Canvas pixels, and the default-off character; separate light/dark/200%/reduced-motion visual sweeps remain future evidence.
- Desktop plugin market integration complete on 2026-08-17: the immutable Desktop patch mounts a dedicated active-profile/packaged-pnpm provider and pinned `dshmarket@1.10.1`; ordinary Web composition remains unchanged. Desktop package operations are serialized, cancellable, tree-terminated, credential-scrubbed, and confined to the fixed `web` profile, with self-restart disabled.
- Harness-native marketplace presentation work is source-locked to the published `dshmarket@1.10.1` tarball integrity and upstream commit `6970a6f801108c04234eb953ff0f707feffa621a`; only an audited pnpm dependency patch may alter its Client presentation or self-protection routes.
- The audited marketplace patch provides a compact Harness-native Discover list and stable Discover/Installed/Updates/Activity tabs, rejects disable/uninstall/update against both active-market aliases before package execution, and is guarded by source/bundle/source-map/Host coherence plus exactly-one-package staging checks. Native packaged acceptance proves the compact tab/search/category/action geometry, clean ordinary rendering, protected self-update, and a real ordinary-plugin uninstall; separate light/dark/200%-zoom visual sweeps remain future evidence.
- Desktop integration for `@deepseek-ai/dsh-session-messenger` now follows the requested Codex-style peer-session model: copy Session A's exact ordinary ID, paste it into Session B, and ask B's Agent to send; A's existing Agent wakes and can reply to B, while either side may later initiate another message with the other's ID. The immutable Desktop overlay mounts one canonical row while ordinary Web remains unchanged. A stable system-prompt section owns four tools: direct wake-and-send, optional wake-send-and-wait, one-use receipt-bound reply that wakes the source by default, and explicit matching-reply wait. Plugin relays retain trusted Source Session and delivery metadata plus a separate untrusted body but use the ordinary Harness context-disclosure renderer; the rejected custom conversation cards are removed. The 320–560 px remembered operator drawer defaults to starting the target Agent, preserves failed drafts, copies the exact Session ID, and exposes metadata-only activity. Existing archive, self, missing, subagent, hop, rate, and unresolved-receipt boundaries plus write-ahead durability remain intact; no new session, subagent, parallel driver, or autonomous Agent loop is created.
- Isolated source and staged-artifact acceptance passed for the plugin market: random loopback Hosts returned `/dsh-market/status` with `pnpm=true`, `restart=false`, `active=false`, and the curated registry was available. The staged application validated the Desktop patch, provider, dshmarket Host/Client artifacts, packaged pnpm bin, native modules, and third-party notices; temporary listeners closed cleanly.
- Native Intel macOS 0.1.6 packaged UI acceptance passed without an API key or model request: exact ordinary and archived clipboard IDs, no-side-effect rejection paths, Codex-style session collaboration controls and ordinary no-card rendering, reasoning slider/Canvas/persistence, stable horizontally scrolling Plugin Market categories plus separated search/filter geometry, self-protection/ordinary uninstall, random-port ownership, and full process cleanup all passed.
- Version 0.1.6 passed lint, documentation sync, 234 focused tests across 19 files, the isolated 19-test packaged smoke, and the two post-build TypeScript checks. A resource-saturated full-repository run completed 13,735 tests with 21 failures: two current-branch contract gaps were fixed and passed their 34-test serial rerun, while all other failed files passed a 197-test single-worker rerun. Staging validated 62 required files including the new Desktop plugin-runtime invariant. The final peer-messaging correction passed an additional 128-test focused rerun. The unsigned Intel DMG is 163,329,569 bytes with SHA-256 `5085c25e85b0eb650941d8b7915c1035090c52ce968b457b03bafc8971f4fe34`; `hdiutil verify` passed, the app executable reports `x86_64`, and the bundle reports `0.1.6`. Native Windows 0.1.6 packaging and acceptance remain pending and must come from the Windows workflow; filenames alone are not release evidence.
- Version 0.1.7 adds the local Usage dashboard and passes 77 focused source tests plus the isolated packaged macOS smoke. Desktop staging validates 62 required files. The unsigned Intel DMG is 163,343,340 bytes with SHA-256 `d9aaf227ebc24f7b1bca0e4b884745665691b92272c25380c226874df5f1c32d`; `hdiutil verify` passes, the bundle reports `0.1.7`, and the app executable plus packaged `node-pty` module report `x86_64`. It has not been installed over the existing application and no Windows build was run from macOS.
- Version 0.1.8 closes the residual generic-CI portability, exact-coverage, persistence-race, and usage-overflow contract gaps without changing the Desktop feature scope. The complete local coverage/static gates, Intel bundle checks, `hdiutil verify`, isolated packaged smoke, install-over-existing-app check, random-port launch, single-Harness-child check, and exact install-time `~/.dsh` preservation check pass. The final consumer repair updates the already-shipped Usage and Archive accessibility goldens, reuses the composed `tool-pwsh` row instead of inserting a duplicate, refreshes its current tool schema, and gives the DeepSeek SSE-comment fixture enough scheduler margin for hosted CI; the local consumer gate passes all 10 build, snapshot, Web, lint, documentation, and built-artifact gates. Native Windows acceptance is required on the final commit and remains the release authority for the real per-user install, shortcuts, launch, close, process cleanup, uninstall, and data preservation. Exact release bytes are intentionally kept out of packaged documentation; the public Release assets and their matching ASCII/LF `.sha256` files are authoritative.
- Version 0.1.4 removes the rejected effort-slider experiment and restores the pre-experiment model-control implementation byte-for-byte. Focused behavior, notice, staging, CI, release, and manifest tests passed 77/77; full lint and production builds passed; Desktop staging validated 49 required files; the isolated packaged smoke passed. Playwright acceptance against the packaged Host reported `slider=0`, `canvas=0`, `ULTRACODE=false`, exact `Off / High / Max` rows, and a working Plugin Market.
- The verified unsigned Intel 0.1.4 DMG is 160,692,416 bytes with SHA-256 `a1b79014e040634c44b24dc4b91ff3f7c00374e92ab53a27dfb6705fabae5865`; `hdiutil verify` passed and the bundle plus executable report `0.1.4` / `x86_64`. It is installed at `/Applications/DeepSeek Harness.app`; the prior 0.1.3 application is recoverably retained at `~/Library/Application Support/DeepSeek Harness Backups/DeepSeek Harness-0.1.3-pre-0.1.4-20260817-183558.app`.
- The 0.1.4 installation itself preserved the exact 16-file `~/.dsh` aggregate SHA-256 `753ae9dab43cdea768ab0470fb68eef780233fb3d7f70855157e86859a5f3953`. First launch then completed on random loopback port 60999 with HTTP 200 and performed ordinary runtime bookkeeping in workspace, project-cache, profile, and one session archive; the resulting JSON, YAML, and Zstandard records all passed structural integrity checks, and no effort-slider profile reference remains.
- Version 0.1.3 passed full lint and production builds, 67 focused behavior tests, 32 notice/staging tests, the staged closure check, and the isolated packaged macOS smoke. Its Intel DMG is 160,717,590 bytes with SHA-256 `21127170a7f28fef0646706507cb0f7cc5bddd23f2170de0d32df8f14ff57760`; a read-only `hdiutil` mount confirmed the `x86_64` executable, bundle version, Desktop patch, and third-party notices.
- Version 0.1.3 is installed at `/Applications/DeepSeek Harness.app`; the replaced application is recoverably retained as `~/Library/Application Support/DeepSeek Harness Backups/DeepSeek Harness-0.1.2-pre-0.1.3-20260817-1540.app`. Live startup completed on random loopback port 62047, and the settings market loaded 1,169 current registry entries. Pre/post hashes of existing session, workspace, and project-cache records were identical.
- The separately installed effort-slider package remains removed after a recoverable profile backup at `~/Library/Application Support/DeepSeek Harness Backups/web-profile-pre-built-in-effort-20260817-1519`; the original built-in list handles effort selection without changing `~/.dsh` sessions. The shared macOS/Windows child launch keeps Electron's internal ESM-loader fallback so profile-installed Host plugins can resolve correctly.
- Archived-session management complete: the sidebar archive lists hidden sessions, restores them to their retained Workspace positions, and gates permanent deletion behind an archive-only Host check plus an explicit irreversible-action confirmation. Running, externally owned, and subagent-owned sessions are refused; project files, shared attachments, settings, and credentials remain outside the deletion boundary.
- Session-ID copy complete: every non-blank session row and archived-session card can copy the exact stable ID with accepted/refused clipboard feedback; the action does not open, restore, archive, or delete the session.
- Standalone package staging and unsigned local `.app` packaging complete.
- Isolated packaged smoke passed from outside the repository: clean `DSH_HOME`, preload bridge, random loopback listener, stable plugin graph, settings dialog, native quit, and complete process/port cleanup.
- Intel DMG regenerated with the accepted icon master and verified with `hdiutil`: `DeepSeek-Harness-0.1.1-mac-x64.dmg` (SHA-256 `e715b4e85553a904d619568803e778fde952c69b2419b1e9d2cf9948bc6e9aad`).
- Version 0.1.2 Intel DMG built and verified with `hdiutil`: `DeepSeek-Harness-0.1.2-mac-x64.dmg` (SHA-256 `40e20ade2025116e0b80181529ba5fef4fbe11087690894636a0c9c5bd4ff138`). The packaged executable and app bundle both report `x86_64` / `0.1.2`, and the packaged smoke passed with an isolated `DSH_HOME`.
- Live ownership migration complete on 2026-08-14: the exact legacy process group stopped gracefully, port 65000 was released, and the independent Hermes gateway remained running.
- A permission-restricted pre-migration backup is stored under `~/Library/Application Support/DeepSeek Harness Backups/pre-desktop-20260814-021540`.
- The final-icon application installed at `/Applications/DeepSeek Harness.app` passed live acceptance against the existing `~/.dsh`: HTTP 200 on random port 65320, the saved application window and Dock item loaded, Finder resolved `icon.icns`, all 518 profile fallback links resolved to physical packaged modules, and no virtual-asar link remained.
- Windows window/menu behavior, runtime conflict discovery, exact process-tree shutdown, x64 NSIS packaging, and native installer lifecycle automation complete.
- Native Windows Setup acceptance passed on `windows-2025` at source commit `c1023875285564aa64d8b6676deaa51e7872a5ca` (run `31756708218`). The one-click per-user Setup created both shortcuts, launched against isolated data, copied exact ordinary and archived `node.id` values through the Windows system clipboard without session side effects, closed its complete process tree and random listener, uninstalled its complete application tree, and preserved both Harness and Electron data markers. The resulting `DeepSeek-Harness-Setup-0.1.2-win-x64.exe` is 136,280,531 bytes with SHA-256 `450d2f8f8770ac3a8008e05cc03b522c63cfa3700fcd885cc2904bd173fc94ed`; the separately generated checksum file matched a local rehash after artifact download.
- Version 0.1.2 is installed at `/Applications/DeepSeek Harness.app`; the replaced 0.1.1 application is retained under `~/Library/Application Support/DeepSeek Harness Backups/DeepSeek Harness-0.1.1-20260814-045758.app`, alongside the earlier 0.1.0 backup.
- The installed 0.1.1 application passed live acceptance against the existing `~/.dsh`: HTTP 200 on random port 49375, the archive manager displayed the retained `AI助手功能简介` session with Restore and Delete actions, the archived log SHA-256 remained unchanged, and neither action was invoked during acceptance.
- The installed Mac 0.1.2 application passed startup and archive-manager safety checks against the existing `~/.dsh`, but its earlier sentinel-only clipboard observation is not valid evidence of exact ID copying: a later audit found the production Electron permission handlers denied every renderer clipboard request. The cross-platform fix now allows only `clipboard-sanitized-write` from the owned main frame, trusted `webContents`, exact `http://127.0.0.1:<bound-random-port>` origin, with request/check parity and an explicit deny matrix. Mac clipboard acceptance and the DMG must be repeated from public main after the Windows PR merge; the existing Mac 0.1.2 DMG must not be cited as clipboard-success evidence. Restore and Delete were not invoked, and the install itself left the 12-file `~/.dsh` aggregate SHA-256 unchanged before first launch.

## Known Risks

- A first Usage read with no derived cache must inspect all durable Session
  logs; partial inspection failures are surfaced as omitted-session counts, and
  unsupported or invalid provider token fields are not estimated.
- Upstream is still a release candidate and may change quickly.
- The installed package does not ship a ready-made Electron shell.
- The desktop source baseline is `0.1.0-rc.5`, while the previous npm runtime reported `0.1.0-rc.6`; the pre-migration backup is retained until longer-term use confirms compatibility.
- Signed/notarized distribution and automatic updates require Apple Developer and Windows code-signing credentials and are outside version 1.
- Unsigned local artifacts may require Finder's **Open** action or a Windows SmartScreen confirmation on first launch.
- Windows release evidence must come from native Windows x64 because Electron native dependency rebuilding cannot safely cross-compile from macOS. The accepted Setup is unsigned, so SmartScreen may warn even though its published SHA-256 is verified.
- Marketplace packages are third-party executable code. The pinned market restricts installs to its curated registry and pnpm blocks unapproved build scripts by default, but users must still inspect plugin provenance and requested build-script approvals; catalog contents and counts are network-derived and can change independently of the Desktop release.
