# DeepSeek Harness Desktop — Project Context

## Project Goal

Turn the official DeepSeek Harness browser surface into standalone Intel macOS and Windows x64 applications with a simple Codex-style desktop experience. The user launches the Mac application from Finder or the Dock, or installs the Windows application through one Setup executable, without opening a browser or terminal.

## Verified Baseline

- Target machine: Intel (`x86_64`) Mac running macOS 15.7.4.
- Previously installed runtime: `@deepseek-ai/dsh@0.1.0-rc.6`.
- Desktop source baseline: official repository version `0.1.1-rc.2` at upstream commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- Previous launch path: Hermes gateway → `npm exec @deepseek-ai/dsh web --port 65000` → Node web host.
- Current launch path: `/Applications/DeepSeek Harness.app` → owned bundled CLI → random loopback listener.
- Current UI: React/Vite application with workspaces, sessions, model and permission selection, tools, plans, jobs, settings, a details pane, a Codex-style archived-session manager, and exact session-ID copy actions for active and archived sessions.
- User data root: `~/.dsh`.
- Official source: <https://github.com/deepseek-ai/deepseek-harness>.
- Inspected upstream release: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (`dsh-v0.1.1-rc.2`) on 2026-08-22.
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
- Installation: Windows uses a visible assisted, per-user, non-elevating NSIS Setup with Welcome, destination, expanded progress/details, and Finish pages plus desktop and Start menu shortcuts; macOS keeps the Intel app and DMG flow.

## Architecture Summary

- Electron x64 application shell.
- Electron main process owns the application window and Harness child process.
- The child runs the pinned official `dsh web --no-open --host 127.0.0.1 --port 0` build.
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
- `scripts/windows-desktop-installer-ui-smoke.ps1`: drives and verifies every visible assisted-installer page on native Windows before cleaning up its isolated installation.
- `scripts/windows-directory-picker-ui-smoke.ps1`: selects an exact isolated folder through the real Windows common-item dialog so the packaged result-decoding path is release-blocking.
- `docs/superpowers/specs/`: product, architecture, and implementation plans.

## Safety Boundaries

- Never copy credentials into the application bundle, logs, fixtures, or commits.
- Never bind the Harness host to `0.0.0.0`.
- Never run two independent Harness writers against `~/.dsh` without an explicit ownership check.
- Do not terminate an existing Hermes-launched Harness automatically during development or testing.
- Use a temporary `DSH_HOME` for automated tests. Live acceptance against `~/.dsh` is a separate, explicit step.
- Preserve the official data format and avoid migrations in version 1.

## Current Progress

- The next Desktop branch adds real local document attachments to the composer:
  users can drag or choose PDF, DOCX, XLSX, UTF-8 text, Markdown, JSON, CSV,
  YAML, XML, and a closed shared roster of source-code filenames. Original
  bytes and extracted UTF-8 text are stored as separate immutable SHA-256
  objects. Images and documents share a 296MiB canonical-base64 carrier cap
  beneath the 300MiB HTTP ceiling. PDF parsing runs in a separately bundled
  Worker with a 30-second deadline, a 128MiB V8 old-generation limit, and
  page/item/output work bounds. Prompt projection favors the current and newest
  messages, fits verified text to the exact resolved model context and output
  reserve, and sends neither local paths nor content-address ids to the model.
  Host history/live/queue projections replace durable document ids and digests
  with bounded renderer metadata and process-random display ids before crossing
  into the browser process.
  The user-facing External Brain label is replaced by **Memory & Learning** /
  **记忆与学习** without changing the single local Brain Hub authority. The
  unfinished Browser/Computer Control product remains excluded by exact
  staging and packaged-artifact guards; the ordinary Workbench browser remains
  an unrelated workspace feature. Intel macOS and Windows x64 release evidence
  must still originate from one exact public commit.
- Version 0.4.2 is the active release candidate. A navigation-only prompt
  ruler indexes every user-message boundary from the immutable history tail,
  renders a bounded left-side rail, reveals localized prompt summaries on
  pointer hover or keyboard focus, and fetches older pages only when an exact
  sequence is selected. It does not delete, edit, rewind, resend, or fork
  history. Custom pi-ai model rows now expose an explicit input-capability
  choice: inherit the catalog or route default, text only, or text plus images.
  OpenAI-compatible discovery adopts only modalities explicitly reported by
  the endpoint and never guesses from a model id or display name. Version 0.4.1
  previously made long reasoning model lists scroll independently from the
  fixed preference footer, coalesced immediate model-directory reads, and
  allowed Desktop warm startup to reuse the module fallback only after
  validating its complete install shape. Version 0.4.0 gave each Desktop-managed
  built-in an explicit mapping from its market-facing package name to the exact
  Loader entry that implements it. Plugin Market now reports Memory, MSE, and
  the Memory & Learning coordinator as live only when their real fibers are up;
  an absent or merely similar Loader name remains restart-required. Packaged
  smoke verifies all three statuses against the same-origin installed endpoint
  on both platforms. Version 0.3.9 previously let manually declared
  models advertise an explicit reasoning capability, including a distinct
  High-only shape that does not invent Low or Medium wire values. The six-step
  Desktop slider keeps the user's visual choice while safely mapping requests
  to an actual Host-advertised effort; up to 64 exact session/provider/model
  visual positions persist in the plugin-owned local profile section across
  remounts, random listener ports, and application restarts. Mac Intel and
  Windows x64 artifacts must originate from the same public merge commit.
- The Desktop 0.3.8 local memory-and-learning stack (internally introduced as the external brain) implements the bounded local scope recorded in
  `.agents/notes/implemented/architecture/2026-08-24-local-external-brain.md`. It keeps project facts in
  `dsh-missher-memory`, procedural learning in the Harness-native
  `dsh-missher-evolution`, and coordination in a new `@deepseek-ai/dsh-missher-brain`
  Bundle. The Brain Hub owns the only injection path and a pathless Settings
  snapshot; Provider failures are fail-open. Memory schema v2 adds FTS5 search
  and reversible automatic consolidation for reviewed memory and
  packages the TencentDB compatibility reader without packaging, writing,
  migrating, consolidating, or learning from a user's live `vectors.db`. The
  immutable Desktop overlay disables matching legacy Profile rows without
  editing the Profile, then mounts distinct Desktop-owned dual-face wrappers;
  this prevents old Profile-local Memory or Evolution packages from shadowing
  either the packaged Host implementation or its Web settings page during an
  application upgrade. Packaged smoke seeds both legacy Host and Web tripwires
  and exercises a real plugin-market transaction before accepting the build.
  The Mac and Windows native packaging plus public artifact verification must all
  originate from the same final shared commit.
- Version 0.3.8 is the previous public baseline. Version 0.3.7 upgrades the managed memory
  fallback to `dsh-missher-memory@0.1.3`, separates ready built-in project memory
  from the optional legacy `vectors.db` source on fresh Desktop installs, and
  preserves the zero-write-before-binding boundary. Usage Insights
  now shares one 12-second cancellation deadline across durable Session reads,
  returns partial cached results when a Session stalls, clears every shared
  refresh for retry, and leaves a first-load renderer skeleton after 15 seconds
  with an honest retryable state. Repeated reads of an active Session now reuse
  a process-local generation-bound row and invalidate it on the next Session
  event, avoiding a full active-log fold without ever persisting a row ahead of
  its durable revision. The Settings shell also owns one 760px page measure and
  one title, intro, and subsection typography contract for built-in, bundled,
  and profile-installed sections. Native Intel macOS packaging, install,
  persisted-data preservation, visual geometry, and repeated-open performance
  acceptance have passed; public-release evidence remains pending. Windows is
  validated and published from its separate platform worktree.
- Version 0.3.6 adds a first-class global Personalization section whose bounded
  Host API owns only a marked block in `~/.dsh/AGENTS.md`, preserves unrelated
  instructions byte-for-byte, rejects stale revisions and unsafe targets, and
  exposes no filesystem path to the browser. The conversation footer now uses
  the current Beijing tariff window, late-bound DeepSeek provider facts, and the
  official read-only balance endpoint; failures keep cost estimates and show an
  explicit unavailable balance instead of fabricating a value. The standalone
  `dsh-missher-memory@0.1.1` bundle is included as an enabled Desktop fallback,
  remains inert until a project is explicitly bound, appears in Plugin Market,
  and is protected from market update, disable, repair, and uninstall actions;
  profile-local installations retain Loader precedence. The 229-test affected
  suite, all 28 documentation gates, full typecheck and lint, official build,
  67-file Desktop staging, and two final isolated native packaged smokes pass.
  The public Intel DMG is 163,728,392 bytes with SHA-256
  `bffc197ca145b3dc7c8262bf8ab5d8878ce05cbe1ebe03f3717b5e9c7b2d7b80`;
  `hdiutil verify`, LF checksum validation, and anonymous public re-download
  byte comparison pass. The installed 0.3.5 application then discovered,
  downloaded, verified, installed, and relaunched this exact 0.3.6 release
  through its real update bridge. The installed executable and `app.asar`
  match the built application, the random loopback Host is ready, and the
  existing `~/.dsh` file count and total byte count are unchanged. Native
  Windows run `32656918392` built from the same tagged source commit
  `a52c03b7c59a454dae2ac50a53115e35e72e0980` and passed 206 focused tests plus
  the visible installer, installed-app lifecycle, personalization, balance
  fallback, memory-market protection, cross-session stop, close behavior,
  shortcut, process-cleanup, uninstall, and data-preservation checks. Its Setup
  is 139,791,104 bytes with SHA-256
  `be8757e794c9532b3aee9eb7280ed5b0db361663dbf0770cb0d84b8e3396e895`;
  anonymous public re-download and the 107-byte LF checksum match the CI
  artifact, and publication preserved all three Mac asset identities.
- Version 0.3.5 keeps the existing 53×7 particle
  geometry and daily heatmap semantics, but gives weekly and cumulative filled
  particles logarithmic relative intensity levels from 1 through 4 instead of
  painting every non-zero aggregate at the strongest color. This changes only
  visual emphasis: row counts, token totals, hover facts, and daily particles
  are unchanged. Desktop startup now uses one shared white DeepSeek loading
  document on macOS and Windows, and the later Web-plugin boot surface recognizes
  the explicit `surface=desktop` marker on both platforms; ordinary browser Web
  sessions retain the generic Harness spinner. The expanded affected regression
  suite passes 68 tests across Usage, boot-page, Desktop lifecycle, window, and
  release-version paths; full-repository lint and the Host, Client, Web, and
  Desktop-main production builds also pass. Desktop staging validates 67 required
  files. The isolated native packaged smoke passes against the final unsigned
  Intel application, whose bundle and executable report `0.3.5` / `x86_64`; it
  shuts down its complete process tree and random listener. The verified DMG is
  `apps/desktop/release/DeepSeek-Harness-0.3.5-mac-x64.dmg`, 163,661,182 bytes,
  with SHA-256 `dfa4b1f27ac3ff2235f67105b065be25465b701ea3be88956efbe2d0b1120852`.
  `hdiutil verify` and the LF-only 101-byte checksum both pass. Native Windows
  Setup acceptance must still be produced on Windows; no Windows artifact is
  inferred from this macOS build.
- The 2026-08-23 source candidate adds an explicit stop boundary to the existing
  transcript-only cross-session messenger: either participant can stop one
  receipt-linked collaboration chain, all unresolved deliveries and waits settle
  as `collaboration-stopped`, later replies/continuations are rejected, and a
  fresh user-directed send starts an independent chain. The existing outgoing
  conversation row gains only a compact Stop/Stopped action; no drawer, card,
  side-chat surface, background Agent loop, or second message archive was added.
  Desktop General Settings now persist an owner-only close preference and a
  tiered-price-estimate switch under Electron `userData`. macOS defaults to
  keep-running and Windows defaults to quit; Windows creates a Show/Quit tray
  only when keep-running is selected, while explicit Quit always performs the
  bounded Harness shutdown. The conversation footer keeps its performance line
  and adds settled latest-turn cost, session estimate, exact provider balance,
  and the current official pricing tier on a second line. Disabling estimates
  hides both local estimates and the tier while retaining exact balance. These
  passed 201 focused cross-session/Desktop/billing tests, 40 packaged-helper and
  manifest tests, affected production builds, full-repository lint, bilingual
  contract pairing, 67-file Desktop staging, and the isolated native Intel Mac
  packaged smoke. The native smoke verified preference round-trips, hide-on-close
  with the Harness listener still owned, window restoration, explicit bounded
  quit, and complete process/listener cleanup. Windows code and the same native
  smoke contract are synchronized, but native Windows Setup/tray acceptance has
  not run from this source candidate. No release version or public asset is
  implied here.
- Version 0.3.4 is the current verified cross-platform release. The stable
  `Low / Medium / High / XHigh / Max / Ultra` reasoning ladder still maps every
  visual stop to an exact Host-advertised effort and still displays the model's
  separate capability limit, but the selected value no longer appends
  `actual …` / `实际 …`; visual and accessibility value text use only the clean
  display label. High-only Ultra still submits High, and Low can still submit
  Off where the model capability requires it. The shared Mac/UI source landed
  as public main commit `3c3f72c8565be8c76df465ab36ebc7efd9ec378a`.
  Windows standard-frame windows had also inherited the Mac-only 38 px
  hidden-inset drag strip: native RED run `32554789168` measured
  `sidebarTop=38`, `padding-top=38px`, and a 38 px pseudo-element. The Desktop
  renderer URL now marks `titlebar=hidden-inset` only for the actual macOS
  hidden-inset window, and the Web surface applies its inset only for that
  trusted marker. Windows therefore keeps the standard native frame with no
  renderer inset while macOS retains its drag strip. PR #20 squash-merged this
  fix as public main commit `fb8dc97c368417edd4420a493b32cb280ffc8fc4`.
  Final native Windows Setup run `32558492256` passed the visible installer,
  installed-app lifecycle, Ultra→real-effort fallback, directory picker,
  clipboard, process cleanup, uninstall, and isolated data preservation; its
  packaged geometry is `frameTop=0`, `sidebarTop=0`, `padding-top=0`, with no
  drag pseudo-element. Full Windows CI run `32558492405` passed all 46 native
  gates after the SQLite retry pacing test stopped advancing unrelated fake
  timers. Release `desktop-v0.3.4` now contains
  `DeepSeek-Harness-Setup-0.3.4-win-x64.exe`, 139,705,330 bytes, SHA-256
  `46671cd4be4533196a1e0e939494e8e69797f9ccc71acd9917b5f162ba84b28a`,
  plus its 107-byte LF checksum. Anonymous public re-download matches both
  exact files. The final 16,656-entry Setup scan contains no private config,
  secret-like value, or personal path. Windows assets are IDs `524796800` and
  `524796801`; the existing Mac DMG, checksum, and updater-manifest assets keep
  IDs `524704681`, `524704689`, and `524704688` with their original bytes and
  digests. Package and updater metadata remain bound to Harness `0.1.1-rc.2`.
- Version 0.3.3 is the preceding verified Intel-macOS release. It applies the
  complete official `dsh-v0.1.0-rc.8` → `dsh-v0.1.1-rc.2` source delta while
  retaining the Desktop shell, workbench, plugin market, reasoning-effort,
  usage-insights, session-messenger, archive, updater, and DeepSeek billing
  additions. The official session-projection API now requires persisted state
  schemas and explicit wire views; the custom billing-model projection has
  been migrated to that contract and is versioned with the other token-meter
  projections. `apps/desktop/update-metadata.json` binds the candidate to
  Desktop `0.3.3`, Harness `0.1.1-rc.2`, Intel macOS, and the release channel.
  A failing migration assertion first pinned the required 0.3.3/rc.2 pair;
  after the minimal manifest change it passed, as did 20 focused token-meter
  projection tests, 207 merge/conflict-impact tests, and the full Host/Client
  typecheck. The raw full-repository test run saturated the Intel host and
  timed out 31 files; its two deterministic manifest/version failures were
  fixed, then every affected path passed under a one-worker budget (527 passed,
  2 platform-skipped). Final validation passes lint, the Host/Client/Web
  production build, all 28 documentation gates, 187 updater/custom-feature
  assertions, and 10 readiness/process assertions. Packaged smoke first caught
  the rc.2 boot-manifest assignment change; a regression test now proves the
  Desktop probe accepts both the legacy `window.__DSH_BOOT__` assignment and
  rc.2's `globalThis["__DSH_BOOT__"]` assignment, and the rebuilt packaged
  application passes its complete isolated smoke. The unsigned Intel DMG is
  163,638,106 bytes with SHA-256
  `803810e8767ed86514368906782d0a80c0bed54907973f84ff57eb8edf0167fa`;
  `hdiutil verify` passes, the bundle reports Desktop `0.3.3`, the packaged
  executable reports `x86_64`, and the embedded Harness reports `0.1.1-rc.2`.
  PR #17 was squash-merged as public main commit
  `927a5f7c999a3074496ac3b0274fc8dcc35ead75`; tag and Release
  `desktop-v0.3.3` point to that exact application tree. The public DMG asset
  (ID `524615247`) is 163,638,106 bytes and its anonymous proxy-assisted
  re-download matches the local candidate byte-for-byte and passes the
  101-byte LF checksum. The public updater manifest (ID `524615248`) also
  matches the local 378-byte manifest exactly. The already installed 0.3.2
  application then displayed the real `Download update` action, progressed to
  `Restart and install`, verified the public DMG SHA-256, invoked the native
  rollback-capable helper, and relaunched `/Applications/DeepSeek Harness.app`
  as Desktop `0.3.3`, `x86_64`, with embedded Harness `0.1.1-rc.2`. The live
  `~/.dsh` aggregate remained 98 files / 8,972 KiB before and after replacement,
  and the custom Usage, Evolution, Plugin Market, and reasoning controls
  remounted on the upgraded core. The old 0.3.2 single-stream GitHub transfer
  became CDN-throttled during acceptance, so the final UI/hash/native-install
  leg reused the separately anonymous-downloaded, byte-identical public DMG
  through a temporary exact-URL bridge; this did not bypass the updater's byte
  count or SHA-256 checks. Normal Finder launches do not inherit the temporary
  proxy environment, so persistent application-level proxy selection and
  concurrent download acceleration remain future work. This Mac task did not
  build, replace, or publish Windows assets; Windows remains at the separately
  verified Desktop 0.3.2 release.
- Version 0.3.2 was the preceding Intel-macOS release. The composer `+` now
  opens one compact Codex-style Add menu over the existing input-trigger
  pipeline: files/folders reuse `@` references, images reuse the existing
  attachment intake, Goal and Plan are promoted without duplicating their
  command implementations, every remaining command is preserved, and current
  callable skills appear under Plugins. Image is omitted when the active
  composer has no attachment capability. The reasoning plugin now presents a
  stable six-stop `Low / Medium / High / XHigh / Max / Ultra` ladder and maps
  each stop to an exact Host-advertised effort; visual stops above a model's
  limit converge on that real limit (High-only Max/Ultra submit High), while a
  model with no positive reasoning capability remains explicitly unavailable.
  The candidate also preserves live workbench width across every utility-mode
  switch, overlaps safe startup discovery with local loading, and unifies the
  white native/Web loading surfaces around the official app icon. Final local
  acceptance passes 51 changed-surface test files / 705 tests, 28 / 28 full
  documentation gates, full-repository lint, the production Host/Client/Web
  build, and the isolated native packaged smoke. The x86_64 application is
  installed in `/Applications` as 0.3.2 without changing `~/.dsh` at the
  installation boundary. The verified DMG is
  `apps/desktop/release/DeepSeek-Harness-0.3.2-mac-x64.dmg`, 163572840 bytes,
  SHA-256 `4bd4ef106ba018b2a99cab95ecf243989f25effeb3ee533b8f9988d80fe19944`;
  its checksum and updater manifest validate locally and after anonymous public
  re-download from `desktop-v0.3.2`. A real installed-app update from 0.3.0
  completed the visible check, download, SHA-256 verification, restart, and
  replacement flow, then relaunched `/Applications/DeepSeek Harness.app` as
  0.3.2 x86_64. The `~/.dsh` file/directory counts remained 97 / 103 across
  that update; two runtime-managed links were added and no data tree was
  copied or deleted by the installer. The verified 0.3.0 DMG is also published
  as a normal historical Release with its checksum and updater manifest. The
  verified 0.3.1 DMG is published only as a prerelease archive: it was a local
  transition build without a separately reproducible source commit, so it has
  no updater manifest and must never enter automatic update selection. Public
  re-downloads of both historical DMGs match their local byte counts and
  SHA-256 values. Windows x64 is synchronized with the same 0.3.2 product at
  public main commit `bf5d1805a0fb14e614a1438bc5ba49d9f9e93caf`. Native
  Windows run `32456696621` passed the assisted installer pages and the full
  installed-application lifecycle, including exact active/archived Session ID
  clipboard behavior, refusal feedback, the native directory picker,
  PowerShell workbench, process cleanup, uninstall, and isolated data
  preservation. The published Setup is
  `DeepSeek-Harness-Setup-0.3.2-win-x64.exe`, 139639588 bytes, SHA-256
  `816a6ce48b96d2fcfebbe42d4c962b2b29df9a0d5e4e028bcac8f471302f1542`;
  its 107-byte LF-only checksum and Setup bytes match an anonymous public
  re-download. The NSIS archive and its `app.asar` contain no `.env*`,
  `.credentials.yaml`, or `.dsh` paths. The three existing macOS Release
  assets retain their original IDs, sizes, and digests; the macOS updater
  manifest remains macOS-only.
- Version 0.3.0 adds the removable Intel-macOS Codex-style workbench opened by
  one compact button beside Session log. Its bounded 320–720 px utility panel
  contains a separately owned Terminal, an isolated native Browser, read-only
  Files and Git Review modes. The duplicate Side Chat surface, its component,
  styles, service dependency, and utility mode were removed; cross-session
  messages still append visible source and target chat rows while retaining
  receipt-bound delivery through requests made in the ordinary composer. The
  former standalone messenger trigger and drawer remain unmounted.
  The Terminal is limited to four shells, 16 KiB input, and 1 MiB retained
  output and is terminated on mode close or plugin disposal. The Browser allows
  HTTP(S) only, denies popup, download, and permission requests, and destroys
  its sandboxed native view when closed. Files and Review canonicalize the
  live session workspace, reject traversal and symlink escape, and cap text and
  diff previews at 256 KiB. Reasoning uses a bounded typewriter reveal with no
  sweep effect and flushes for settled, expanded, hidden, or reduced-motion
  states. Only Desktop composition mounts the workbench; ordinary Web remains
  unchanged. Public main baseline
  `59058b0173b1f2b9447fef89f4312303eb2de200` is merged as the second parent,
  retaining its no-browser-handoff startup parsing, macOS-only updater bridge,
  packaging exclusions, and runtime hardening. Mac Desktop packaging now uses
  the existing official Client profile, so the official DeepSeek Harness brand
  occupant replaces the local fallback and its clipped commit badge. The final
  build record is bound to source commit `c8e556cffad6bd67d543612065efc605325bf21a`.
  The synchronized unsigned Intel DMG is 163,555,915 bytes with SHA-256
  `5c306c58b8e733b25baddac1f2f711ff97e350138945f5c10b64d569d2bde633`;
  `hdiutil verify` passes and the packaged application reports `0.3.0` / `x86_64`.
  Brand/profile regression passes 3 files / 26 tests; the affected Workbench,
  Layout, Messenger, and Desktop regression passes 13 files / 115 tests; the
  two affected TypeScript project builds pass. The complete official Host,
  Client, Web, Desktop-main, 67-file staging, and DMG builds pass.
  The isolated native packaged smoke passes the ordinary and archived
  clipboard paths, visible cross-session chat rows, a real workbench terminal
  command and teardown, all four workbench modes with no Side Chat tab,
  reasoning effort, Usage
  Insights, System Update, Plugin Market, provider isolation, random-port
  ownership, and final process cleanup. The synchronized application is
  installed and running at `/Applications/DeepSeek Harness.app`; its owned
  Harness returned HTTP 200 on random port 58995. The installed and final
  packaged `app.asar` share SHA-256
  `c89e2078391bae97ef9523201ad8c392dad7e79bc36714e2ced5548b070fc7eb`.
  The live 97-file `~/.dsh` aggregate remained
  `8195253bdf6de8b0beb2cd4c18195f44514a73633fa8df890ab01ab4f2841850`
  before replacement, after replacement, and after launch. The previous 0.2.2
  application is recoverably retained at
  `~/Library/Application Support/DeepSeek Harness Backups/DeepSeek Harness-0.2.2-pre-0.3.0-20260821-020107.app`.
  The pre-final-layout 0.3.0 application is retained beside it as
  `DeepSeek Harness-0.3.0-pre-final-layout-20260821-022529.app`; the immediately
  preceding 0.3.0 application is retained as
  `DeepSeek Harness-0.3.0-pre-main-59058b0-20260821-042841.app`; the immediately
  replaced build is retained as
  `DeepSeek Harness-0.3.0-before-brand-sidechat-20260821-094826.app`. No Windows
  build or public GitHub release was produced for this synchronization task.
- Version 0.2.2 replaces the rejected macOS startup artwork with the approved
  Codex-like A direction. The local Electron phase is a network-free centered
  DeepSeek whale, title, status, and five-pixel indeterminate bar because Host
  startup has no truthful denominator. The following Web phase is selected
  only by `?surface=desktop` plus a macOS user agent and reports the existing
  monotonic active-plugin count as a real percentage; ordinary Web and
  non-macOS surfaces retain the generic circular loader, and plugin failure
  still replaces progress with the kernel-owned report. Focused regression
  passes 46 files / 378 tests, explicit Host, Client, Web, and Desktop-main
  production builds pass, and browser visual acceptance passes at 736×480 and
  360×480 without clipping or progress overflow. The final unsigned Intel DMG
  is 163,541,739 bytes with SHA-256
  `f6ec1b99261bc1e8e9494dcdd13eddeba24bc028aa14c1f13fa295aa7b09c96b`;
  `hdiutil verify` and the isolated native packaged smoke pass. The exact final
  candidate and installed `app.asar` share SHA-256
  `22fc5a5200c3784d184974f1fdaa4a27982be20f77ba1bba10c93b6b11ce7f01`.
  `/Applications/DeepSeek Harness.app` reports `0.2.2` and `x86_64`, launches
  its owned `--no-open --host 127.0.0.1 --port 0` child, and returned HTTP 200
  on the observed random port 63641. The exact 63-file `~/.dsh` aggregate hash
  remained `6b1cda7016342b9de37c85e760c95802f2e1941e8c5d1456a9621ca089dcf76d`
  across final installation. Recoverable application backups remain in
  `/Applications`; no Windows build or public GitHub release was produced.
- Version 0.2.1 fixes the Windows false startup failure by disabling the CLI's
  default-browser handoff and accepting exactly one valid loopback URL while
  ignoring other `dsh web:` status lines. It also replaces the directory
  picker's unsafe fixed-size native memory view with Koffi's NUL-terminated
  UTF-16 decoder, covering the fatal `readUtf16` crash observed after a folder
  was selected. Native Windows acceptance now selects a real isolated folder
  through the installed application in addition to installer, clipboard,
  process, uninstall, and data-preservation checks. The root Harness version
  remains `0.1.0-rc.8`; only the Desktop artifact version advances to `0.2.1`.
  This standalone public repository now defaults its required CI lanes to
  GitHub-hosted `ubuntu-24.04` and `windows-2025` runners; the existing explicit
  self-hosted failover selectors remain available. This prevents release
  checks from waiting forever on upstream-only enterprise runner labels.
  Windows does not expose or invoke the macOS-only update bridge; Windows
  upgrades remain explicit Setup installs. Desktop packaging keeps its narrow
  runtime allowlist and now also excludes `.env`, credential, and `.dsh`
  paths explicitly. The final local candidate passes all 37 static gates, all
  10 consumer/build gates, 124 Desktop tests, and the complete 14,483-test
  coverage gate at 100% statements, branches, functions, and lines. A clean
  native Windows Setup build and installed-app lifecycle smoke remain the
  release authority for this commit. The final hosted-CI repair also makes the
  persistent PowerShell terminal answer cursor-position device queries, waits
  for the private OSC prompt instead of matching its echoed `dsh> ` source,
  and defers Linux exact-wait fallback until output is quiet. Once that private
  prompt is established, PowerShell silence alone can no longer release a send
  slot before delayed output; startup retains the bounded fallback needed to
  establish the first prompt. The serialized persistent PowerShell tool may
  also opt into that fallback because its independent random completion marker,
  rather than terminal settlement, is authoritative for command completion.
  A portable pwsh 7.6.5 run passes the real persistent-state, UTF-8,
  large-output, exit/restart, and ACP snapshot scenarios. Browser steering
  snapshots now anchor on the open question
  composer instead of runner-dependent intermediate timing, and the HMR
  browser gate gives only its cold watch build bounded hosted-runner headroom
  while retaining the existing source-update deadline. The
  four-core Windows hosted lane now uses a bounded 3-partition/2-gate budget so
  subprocess and worker timing tests are not starved by the coverage
  coordinator.
- Version 0.2.0 rebased the Desktop product on official `dsh-v0.1.0-rc.8`
  while retaining the current macOS/Desktop feature set. It adds a native
  Windows assisted installer whose ordinary double-click flow exposes Welcome,
  installation directory, expanded progress/details, and Finish pages while
  remaining per-user and non-elevating. The root Harness version remains
  `0.1.0-rc.8`; only the Desktop artifact version advanced to `0.2.0`.
  Host/Client typecheck, the complete Host/Client/Web production build,
  85 SQLite persistence tests, 28 installer/staging contract tests, and a
  63-file Desktop staging closure pass locally. Native Windows UI, clipboard,
  install lifecycle, public artifact, and SHA-256 acceptance remain required
  on the final committed source.
- Version 0.2.1 adds a Desktop-only **System Update** for macOS while leaving
  the already-published Windows 0.2.0 release untouched. The updater is backed
  by fixed GitHub endpoints, a 24-hour cache, ETag revalidation, strict release
  manifests, bounded downloads, SHA-256 checks, x86_64 bundle and packaged-
  metadata verification, and a detached same-parent installer with backup and
  rollback. Official Harness tags remain informational; only a compatible
  Desktop DMG can authorize installation. Marketplace install and update also
  snapshot `dependencies` and `dsh.profile.bundles` together and restore both
  on failed, cancelled, timed-out, stale, or rejected operations.
  The integrated Intel Mac build, verified DMG, packaged smoke, native
  replacement, random-port startup, and no-browser-handoff checks pass locally;
  public Release download and updater-discovery evidence remains to be produced.
- Version 0.1.9 consolidated the earlier macOS/Desktop work: the separate
  session-communication trigger and drawer are removed, session-messenger
  relays render directly in the ordinary chat timeline with source
  attribution, Settings uses one stable 1040px responsive width, the archive
  manager has room for its three row actions, and the reference-style Plugin
  Market, Usage skeleton/cache, macOS startup reveal, and eight additional
  built-in role presets are included. The composer stats strip estimates cost
  only for a single identified official DeepSeek V4 route using the current
  Beijing-time peak/off-peak prices; the optional account balance uses a
  read-only, capability-gated same-origin bridge restricted to the official
  DeepSeek endpoint. The focused 208-test suite, 31-test preset E2E, 6-test
  built-Web E2E, 28-test release-workflow gate, full Host/Client/Web production
  build, lint, 62-file Desktop staging, isolated packaged Electron smoke, and
  `hdiutil verify` pass. The unsigned Intel DMG is 163,392,392 bytes with
  SHA-256 `c6b360e08c221ee7afa452b84e0f7ab2e6670b042cfafd4d382dcd35fdf4af0f`;
  the packaged application reports `0.1.9` and `x86_64`. Native Windows Setup
  acceptance and public Release publication still require the final committed
  source.
- The 2026-08-20 internal macOS build replaces the Plugin Market's legacy
  card/category rail with the accepted reference-style surface: full-width
  functional search, installed-plugin icon rail, Public and Personal modes,
  grouped Featured/category sections, and flat two-column rows with exactly
  one trailing Install or overflow action. Personal is deliberately limited
  to installed dependencies whose durable spec starts with `file:` or
  `link:`; the gear menu retains installed/update/activity/theme/group and
  backup/recovery management. Every Settings section now uses the same 1040px
  responsive panel width, so navigating between General, Models, Usage,
  Plugins, Agent presets, and Plugin Market no longer resizes the dialog. The
  focused layout/artifact/manifest/Settings suite passed 52/52, the isolated
  packaged Electron smoke passed, and the verified x86_64 0.1.8 bundle was
  installed at `/Applications/DeepSeek Harness.app`. The replaced bundle is
  recoverably retained at `/Applications/DeepSeek Harness.app.backup-20260820-025949`;
  no GitHub upload or public release was performed.
- The 2026-08-20 internal macOS candidate keeps the original Standard, Code,
  Minimal, and Creator presets and adds Planning, Frontend and UI, Backend and
  API, Troubleshooting, Code review, Testing and QA, DevOps and release, and
  Documentation and research. All 12 presets remain manually selected through
  the existing composer and Settings controls; no automatic classifier or
  router was added. Execution-oriented roles retain the normal tool surface,
  while focused planning, review, and research roles omit background-job,
  delegation, and workflow tools. These prompt/tool presets guide behavior but
  are not treated as a security boundary. The x86_64 `0.1.8` candidate passed
  configuration, localization, Host behavior, browser-selection, typecheck,
  lint, translation-pairing, packaging, and isolated packaged-app smoke gates;
  it was installed to `/Applications/DeepSeek Harness.app` after moving the
  previous application bundle to a timestamped per-user backup. The installed
  bundle contains all 12 preset snapshots and starts its owned loopback Host.
- The 2026-08-19 internal macOS candidate adds a Darwin-only Endfield-inspired DeepSeek-blue startup reveal that overlaps the first real application render and exits directly into the page; it does not add a second window or delay Host readiness. Usage Settings now paints a dimensionally stable structural skeleton on first read, keeps the last immutable in-process snapshot on revisit, and refreshes it in the background. The pinned `dshmarket@1.10.1` patch uses the accepted B2 single-row hierarchy, keeps plugin name/category/Install/icon-only More aligned on the first row even at narrow Settings widths, and paints an immediately visible blue initial tile underneath asynchronously decoded owner images. The composer strip now prices the complete durable token ledger only when the durable billing-route projection identifies one supported official DeepSeek V4 model, and exposes the exact account balance only through the optional official-endpoint, read-only, capability-gated same-origin bridge. This is local tuning only: no GitHub upload, public release, application replacement, or live `~/.dsh` acceptance is authorized.
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
- The 2026-08-18 source candidate keeps the default-off ordinary reasoning thumb fully inside both track endpoints and reflows the embedded Plugin Market from its real Settings container width. Every registry category stays in stable source order on one horizontally scrollable rail; selection never moves chips, edge controls and fades reflect the true scroll bounds, search and filter use a separate row above the category rail, and narrow plugin actions stay aligned with the title row. The pinned market Client artifacts were rebuilt from upstream `v1.10.1`; final 0.1.8 staging and the isolated native packaged smoke refreshed the geometry evidence after the collaboration changes.
- The 2026-08-18 Desktop startup path now overlaps the local loading surface with the read-only ownership check, then starts Harness as soon as that check clears while the loading surface finishes. The same-home writer gate, complete Harness readiness probe, failure surface, and owned-process cleanup remain mandatory. A lifecycle regression test and the complete isolated packaged macOS smoke passed. Comparative live timing was not accepted on the installation host because unrelated processes saturated CPU during the run.
- The apparent session-messenger mark-read mutation was a smoke-fixture race, not an acknowledgement write: preserved failed logs contained only delayed selected-Session policy restoration. The fixture now seeds the current permission, sandbox, and approval records before its final end-seed and waits for protected storage to settle on both sides of copy and acknowledgement actions. Three consecutive complete packaged smokes passed with exact protected-file equality, and the final 0.1.8 packaged candidate repeated the complete isolated smoke before installation or publication.
- The model-control visual experiment was removed on 2026-08-17 after user acceptance rejected it. The original simple Host-advertised effort rows are restored, with no canvas, particle renderer, aliases, or invented effort ids.
- Version 0.1.5 reintroduces the requested richer control as the removable `@deepseek-ai/dsh-reasoning-effort` plugin instead of another core UI fork. It uses Host-advertised values, a down-first adaptive portal, HanaAyane's pinned attributed Canvas effect, and a profile-backed character opt-in that defaults off. Desktop dependency, immutable patch, duplicate-original/fork preflight, staged Host/Client/license/notice/sprite closure, and generated root attribution are integrated. Native packaged acceptance proves direct High startup, High-to-Max persistence, down-first/adaptive placement, non-empty Canvas pixels, and the default-off character; separate light/dark/200%/reduced-motion visual sweeps remain future evidence.
- Desktop plugin market integration complete on 2026-08-17: the immutable Desktop patch mounts a dedicated active-profile/packaged-pnpm provider and pinned `dshmarket@1.10.1`; ordinary Web composition remains unchanged. Desktop package operations are serialized, cancellable, tree-terminated, credential-scrubbed, and confined to the fixed `web` profile, with self-restart disabled.
- Harness-native marketplace presentation work is source-locked to the published `dshmarket@1.10.1` tarball integrity and upstream commit `6970a6f801108c04234eb953ff0f707feffa621a`; only an audited pnpm dependency patch may alter its Client presentation or self-protection routes.
- The audited marketplace patch provides a compact Harness-native Discover list and stable Discover/Installed/Updates/Activity tabs, rejects disable/uninstall/update against both active-market aliases before package execution, and is guarded by source/bundle/source-map/Host coherence plus exactly-one-package staging checks. Native packaged acceptance proves the compact tab/search/category/action geometry, clean ordinary rendering, protected self-update, and a real ordinary-plugin uninstall; separate light/dark/200%-zoom visual sweeps remain future evidence.
- Desktop integration for `@deepseek-ai/dsh-session-messenger` follows the requested peer-session model: copy Session A's exact ordinary ID, paste it into Session B's chat request, and let B's Agent send to A; A's existing Agent can wake and reply while both durable relays remain visible in their ordinary chat timelines. Relay cards explicitly attribute the text as sent by Codex from another chat, retain the untrusted-body boundary and trusted source metadata, and fall back to the source Session ID when no title is available. The separate session-communication header button, operator drawer, activity panel, duplicate composer, and client notification surface are absent; the Client plugin intentionally mounts nothing. Existing Host tools, write-ahead receipts, exact-once recovery, archive/self/missing/subagent/hop/rate boundaries, and ordinary Session-ID copy actions remain intact; no new Session, subagent, parallel driver, or autonomous Agent loop is created.
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
- The desktop source baseline is official `0.1.0-rc.8`; older installed macOS builds and their retained backups may still contain the earlier `rc.5`-derived Desktop graph.
- Signed/notarized distribution and automatic updates require Apple Developer and Windows code-signing credentials and are outside version 1.
- Unsigned local artifacts may require Finder's **Open** action or a Windows SmartScreen confirmation on first launch.
- Windows release evidence must come from native Windows x64 because Electron native dependency rebuilding cannot safely cross-compile from macOS. The accepted Setup is unsigned, so SmartScreen may warn even though its published SHA-256 is verified.
- Marketplace packages are third-party executable code. The pinned market restricts installs to its curated registry and pnpm blocks unapproved build scripts by default, but users must still inspect plugin provenance and requested build-script approvals; catalog contents and counts are network-derived and can change independently of the Desktop release.
