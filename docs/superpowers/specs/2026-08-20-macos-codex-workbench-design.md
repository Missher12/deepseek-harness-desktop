# Intel Mac Codex-style workbench design

English | [中文](2026-08-20-macos-codex-workbench-design.zh.md)

## Goal

Give the Intel macOS Desktop application a compact Codex-style workbench without turning the web client into a privileged desktop page. The product name remains `DeepSeek Harness`, a single button beside `Session log` opens a resizable right-side panel, and the panel provides Terminal, Browser, Files, Side Chat, and Review modes. Running reasoning uses a restrained typewriter presentation instead of the current sweeping shimmer.

The implementation must preserve Harness session semantics, plugin removability, random loopback startup, the protected updater, and the hardened Electron renderer boundary.

## Confirmed product decisions

- The utility trigger is a 32-pixel icon button in `conversation.session.header.utilities`, immediately after `session-log-download`. It is not a persistent rail and does not sit beside the window controls.
- The workbench is closed by default. Activating the trigger opens the last selected mode; activating it again closes the panel.
- The panel header contains the five modes in this order: Terminal, Browser, Files, Side Chat, Review.
- The panel uses Harness typography, spacing, borders, muted surfaces, and blue focus/active tokens. It does not use particles, character mascots, gradients that sweep continuously, or floating cards.
- The user can resize the panel. The preferred width survives application restarts, while narrow windows present the same content as a right drawer instead of squeezing the conversation below its usable width.
- Side Chat is the only manual cross-session communication surface. Incoming deliveries and replies remain visible in the ordinary conversation with sender attribution; there is no separate messenger header button or legacy drawer.
- This delivery is Intel macOS only. Windows and GitHub release publication are outside this change.

## Approaches considered

### Persistent utility rail

This would make every tool discoverable, but it permanently consumes horizontal space and does not match the approved interaction. It is rejected.

### Restore the legacy messenger drawer and add separate tool buttons

This would reuse more existing UI, but it repeats the protruding, card-heavy presentation the user rejected and creates competing right-side surfaces. It is rejected.

### Embed arbitrary sites with a renderer `<webview>` or `<iframe>`

An iframe fails on common sites that disallow embedding. Enabling `<webview>` would weaken the Desktop shell's current policy, which deliberately rejects renderer-created webviews. It is rejected.

### One removable client/Host workbench extension plus a narrow Electron browser bridge

This keeps almost all product behavior in Harness plugin boundaries, reuses the existing layout and session services, and reserves native privilege for the one capability that needs it. An Electron-managed `WebContentsView` provides the browser without giving the Harness renderer Node access. This is the selected approach.

## Architecture

### Package boundary

Add a Desktop-only workbench extension package with separate Host and Client faces. The Desktop profile includes it through the existing patch/profile composition; the ordinary Web profile does not. The extension owns:

- the header trigger and workbench panel;
- panel state, selected mode, and saved width;
- the user-owned Terminal Host service;
- bounded Files and Review Host services;
- Side Chat composition over the existing session-messenger transport.

The Electron application gains only the browser-view controller and a closed preload API for that controller. It does not gain raw filesystem, shell, package-manager, or unrestricted IPC methods.

Removing the workbench extension must remove the trigger, panel, Terminal, Files, Review, and Side Chat surfaces without changing ordinary conversation behavior. The existing relay node renderer stays in the session-messenger package so persisted cross-session messages remain readable even when the workbench surface is absent.

### Layout ownership

Extend `ui-layout` with one optional `layout.utility` slot and a utility-column state. The column is zero-width while closed and occupies the saved width while open. Opening the utility panel closes the existing tool-call details column; opening tool-call details closes the utility panel. This prevents two right columns from starving the conversation.

The utility state records `open`, `mode`, and `preferredWidth`. Width is clamped to 320–720 pixels, defaults to 420 pixels, and is persisted under a versioned local preference key. Closing the panel preserves the preferred width. At the existing narrow-layout breakpoint, the utility becomes a fixed right drawer with a bounded width and backdrop; Escape closes it and returns focus to the header trigger. As an adjacent bug fix, the existing tool-call detail action is wired to its already implemented details panel; it shares the same mutual-exclusion rule and does not add another right-side surface.

The panel body stays mounted only while open. Switching modes preserves lightweight form state but detaches native browser pixels and pauses terminal rendering for inactive modes.

### Header trigger

The workbench Client plugin registers one entry in `conversation.session.header.utilities` with an explicit order after `session-log-download`. The control uses the same 32-pixel height, focus ring, hover surface, and disabled semantics as the Session log control, but remains icon-only with an accessible `打开工具` or `关闭工具` label and `aria-expanded` state.

Because this is a session-scoped slot, the control is absent when no session is selected. Changing the current session keeps the panel mode and width but updates all session-owned data to the new session.

## Branding

Replace the generic client title and sidebar fallbacks from `DSH Local Build` to `DeepSeek Harness`. The official brand plugin may still provide the same value, but a missing or late official build environment can no longer expose a developer placeholder in a packaged application.

The document title remains session-aware: a selected session may produce `<session title> — DeepSeek Harness`, while the persistent sidebar product mark always reads `DeepSeek Harness`. Tests cover both the official-build environment and the fallback path used by Desktop staging.

## Tool modes

### Terminal

Terminal is a human-owned interactive PTY surface, not an invocation of the model-facing `terminal_*` tools and not an impersonation of the session Agent. The Host service resolves the requested session server-side, derives its working directory from the durable session header, and creates a separate terminal owner record keyed by client connection, session id, and terminal id.

The Client receives bounded incremental output frames and sends only validated UTF-8 input, resize dimensions, and a closed signal vocabulary. One current terminal is shown initially; the user may create and close additional terminals within a conservative per-session cap. Closing the panel keeps live terminals for the application session, while session removal, client disconnect, Host shutdown, or application quit terminates their complete process trees.

The terminal surface reuses Harness monospace and ANSI primitives where possible. It supports copy, clear-view, restart, and explicit close. It does not silently run commands, restore command history across application restarts, or expose a shell outside the selected session workspace.

### Browser

Electron main owns one `WebContentsView` per Desktop window. It is created lazily on first use with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, and a partition distinct from the Harness renderer. The Harness page can request only these validated operations: show with pixel bounds, hide, navigate to an HTTP(S) URL, go back, go forward, reload, stop, and read a bounded navigation snapshot.

The main process validates the exact trusted Harness `webContents`, main frame, and current random-loopback origin on every request. It converts plain search text into the configured search URL, rejects non-HTTP(S) schemes, denies popups, prevents permission prompts, denies downloads, opens explicitly externalized links in the system browser, and destroys the view on window teardown.

The Client reports the browser viewport's CSS rectangle and scale changes while Browser is active. Main converts it to content-view bounds, clips it to the window content area, and hides the native view before any panel transition so stale pixels cannot cover another mode. Navigation state and failures are relayed as validated snapshots; page content never enters the Harness DOM.

### Files

Files is a read-only, lazy tree rooted at the current session workspace. The Host resolves and canonicalizes the workspace root, canonicalizes every requested child, and rejects traversal or symlink escape. Directory pages and file previews are capped by entry count, byte size, and response size. Binary files show metadata only; oversized text files show an explicit truncated preview.

The mode supports filter, expand/collapse, copy path, and inserting `@path` into the current composer draft. It does not reveal arbitrary operating-system paths, edit, rename, delete, upload, or execute files.

### Side Chat

Side Chat reuses the existing session-messenger Host transport, delivery receipts, wake control, reply linkage, unread state, and inline relay nodes. The workbench supplies a compact continuous layout rather than the legacy card drawer:

- current Session ID with copy action;
- target Session ID, validated before send;
- message composer and `唤醒目标 Agent` control;
- reply context when opened from an incoming relay;
- recent metadata-only delivery status.

Sending does not navigate to, open, archive, restore, delete, or otherwise mutate the target session. The source conversation immediately receives an inline outgoing relay node containing the exact sent text and delivery status. The target conversation receives an inline node labelled `由 DeepSeek Harness 从另一个聊天发来`; when wake is enabled, the target Agent may answer and that exact linked reply is mirrored visibly into the source conversation. No leg of this flow is represented only as invisible context injection.

The obsolete messenger trigger, drawer registration, and stale documentation are removed. Reusable transport and relay rendering remain independently testable.

### Review

Review is a read-only Git surface rooted at the current session workspace. The Host invokes Git with argument arrays, never a shell string. It reports repository root, branch, bounded porcelain status, file-level diff statistics, and a bounded unified diff for a selected file. Paths are canonicalized and must remain inside the discovered repository root.

The panel provides refresh, file selection, copy diff, and `在当前聊天中审阅` actions. The last action places a prepared review request into the current composer draft but never sends it automatically. Non-repositories receive an empty explanation rather than repeated process retries. No stage, commit, checkout, reset, clean, discard, or other mutation is available in this version.

## Reasoning presentation

Remove the running-row sweep shimmer. While reasoning is running and collapsed, the latest real reasoning summary is revealed with a short buffered typewriter cadence and a quiet caret. The presentation never invents text, never replays the complete reasoning body, and never changes persisted content.

The reveal queue is bounded: small token chunks are smoothed, a large backlog catches up rapidly, and completion flushes immediately to the exact final text. A new summary line replaces the old target without replaying settled content. Expanding the row always shows the complete current reasoning immediately. `prefers-reduced-motion` bypasses the queue and hides the caret.

All animation work is cancelled when reasoning settles, the component unmounts, the document becomes hidden, or reduced motion is enabled. This prevents an idle requestAnimationFrame loop.

## Security and trust boundaries

The Harness renderer remains sandboxed and receives no Node primitive. New preload values use closed discriminated unions and explicit size limits. Every privileged IPC handler applies one shared sender predicate requiring:

- the active Desktop BrowserWindow's exact `webContents`;
- the main frame rather than a child frame;
- the exact origin of the currently owned random-loopback Harness URL.

The Browser view uses a different session partition and never receives the Harness preload. Browser-origin content cannot call Desktop IPC. Files, Review, and Terminal resolve workspace ownership in the Host instead of trusting a renderer-supplied absolute root. Logs contain operation classes and error codes, not terminal input, file contents, browser URLs with query strings, cross-session message bodies, credentials, or environment values.

## Lifecycle, errors, and performance

- Opening the workbench is synchronous; each mode shows a local skeleton until its first bounded snapshot arrives.
- A mode failure stays inside that mode and offers retry without closing the conversation.
- Browser renderer crashes are reported in the Browser mode and the isolated view can be recreated without restarting Harness.
- Terminal output is event-driven and rendered in bounded batches. Inactive modes do not poll.
- Files load directories on demand and do not recursively watch the workspace.
- Review refreshes on open, manual refresh, or an explicit known workspace mutation signal; it does not run Git on a timer.
- Side Chat uses existing push events and performs no background polling.
- Closing the panel hides native browser content before the layout animation begins. Application quit awaits terminal process-tree cleanup and destroys the browser view.
- Panel animation is limited to transform/opacity and disabled under reduced motion. There are no perpetual particle, shimmer, or canvas loops.

## Program audit included with delivery

The implementation pass includes a bounded audit of the surfaces touched by this feature and the current packaged Mac application:

1. Brand/build-profile drift, including fallback behavior in staged Desktop assets.
2. Desktop IPC main-frame/origin checks and navigation/permission denial matrices.
3. Stale session-messenger UI code, tests, and README claims.
4. Unreachable or competing right-panel entry points in the current layout.
5. Listener, animation-frame, PTY, browser-view, and child-process teardown.
6. Narrow-window geometry, resize persistence, keyboard focus, and reduced motion.
7. Renderer console errors and startup/runtime regressions in the installed Intel app.

Findings outside this feature are reported with severity and evidence. A risky unrelated refactor is not folded into this delivery.

## Testing strategy

Implementation follows red-green-refactor and is split into three stages.

### Stage 1: foundation

- Pin the brand fallbacks with focused Client tests.
- Add the generic utility column and its mutually exclusive details behavior with layout-store and AppFrame tests.
- Register the header button after Session log and verify open, close, focus return, narrow drawer, resize clamp, and preference recovery.
- Add preload validators and main-process allow/deny tests before exposing the Browser controller.

### Stage 2: tool completeness

- Terminal service tests cover server-side cwd resolution, ownership, size/input caps, resize, disconnect, session removal, and full process-tree cleanup.
- Browser tests cover trusted main-frame calls, rejected subframes/origins/schemes/popups/downloads/permissions, bounds clipping, hide-before-switch, crash recovery, and destroy-on-close.
- Files tests cover lazy listing, text preview, binary/large-file behavior, traversal, symlink escape, and session switch.
- Side Chat tests cover exact target id, visible source/target projections, reply linkage, wake/no-wake, rejection side effects, and absence of the legacy drawer/button.
- Review tests cover repository detection, argument-safe Git execution, bounds, path escape, non-repository behavior, and draft-only review action.

### Stage 3: polish and release-shaped verification

- Reasoning tests cover chunk smoothing, target replacement, immediate expanded/final text, hidden-document cleanup, and reduced motion.
- Interaction tests cover all five modes, width persistence, details-panel exclusion, keyboard navigation, focus recovery, narrow geometry, and zero console errors.
- Run the relevant package tests, Desktop main/preload tests, production Host/Client/Web builds, Desktop staging checks, and the existing feature regression matrix.
- Build the Intel x64 `.app` and `.dmg`, run the packaged Electron smoke, verify the DMG with `hdiutil`, install without changing `~/.dsh`, and manually verify the approved header-button and panel geometry.
- Report final paths, byte sizes, SHA-256 values, test totals, and any remaining audit findings. Do not publish or modify a GitHub Release without a separate instruction.

## Acceptance criteria

- The sidebar product mark always reads `DeepSeek Harness`; `DSH Local Build` is absent from the packaged UI.
- A single compact button immediately beside `Session log` opens and closes the workbench. No permanent rail or legacy messenger button/drawer remains.
- Terminal, Browser, Files, Side Chat, and Review are functional in the panel, retain the approved order and Harness visual language, and do not compete with tool-call details.
- The panel is resizable, restores its width, behaves as a drawer on narrow windows, and supports keyboard and reduced-motion users.
- Cross-session messages and replies are visibly attributed in both relevant conversations and are not context-only injection.
- Reasoning streams with a bounded typewriter presentation and no sweep shimmer, particles, mascot, or idle animation loop.
- Privileged browser and desktop operations pass default-deny sender, origin, frame, scheme, path, and lifecycle tests.
- The final artifact remains Intel x86_64, starts on a random loopback port, preserves the protected updater and all existing user data, and passes release-shaped Mac verification.

## Non-goals

- No Windows implementation, build, CI run, installer, or Release asset.
- No GitHub push, pull request, merge, tag, or public release in this design phase.
- No file editing, Git mutation, terminal auto-execution, background browser automation, or browser download manager.
- No replacement of the ordinary Harness chat, session list, plugin market, usage insights, reasoning-effort control, or updater architecture.
- No attempt to make the ordinary browser build expose native Terminal or embedded Browser features.
