# `dsh-lark` Feishu Remote Session Plugin Design

English | [中文](2026-08-25-dsh-lark-remote-session-plugin-design.zh.md)

**Date:** 2026-08-25

**Status:** Approved for implementation

**Implementation baseline:** Desktop 0.4.0 from `origin/main` (`e171dd2d45`), Harness package version `0.1.1-rc.2`

## Goal

Deliver `@deepseek-ai/dsh-lark` as an independently installable, disableable, and removable Bundle. One designated Feishu user can select a project and ordinary Session from the current Harness Profile in a bot DM, continue development in that Session, and receive OpenClaw-Lark-style streaming cards, tool status, elapsed time, token usage, attachments, and one-shot approval interactions. Harness remains the sole owner of projects, Sessions, Agents, permissions, approvals, sandboxing, and usage; the plugin neither installs nor starts OpenClaw and does not create a second Agent runtime.

Disabling the plugin must immediately disconnect Feishu, stop inbound consumption, revoke event subscriptions, and end incomplete card updates. Disabling or uninstalling must not archive, delete, reset, or rewrite existing Harness Sessions; user messages already committed to a Session log remain part of that Session.

## Delivery Form

The code lives in `packages/extensions/lark/`, with npm package name `@deepseek-ai/dsh-lark`, and exports the Host plugin, Client settings plugin, `cordis.patch.yml`, and runtime invariant. Its manifest declares `dsh.bundle.patch`, so `dsh plugin --profile web add <package-spec>` adds it to the Profile's `dsh.profile.bundles`. Version one does not join the Desktop default patch and therefore remains independently removable.

The Bundle depends only on public Harness package APIs and the official Feishu Node SDK. It may reference or port host-neutral Feishu transport, card, and media behavior from `@larksuite/openclaw-lark` where its license permits reuse; ported code retains required attribution and third-party notices. The package must not import `openclaw/plugin-sdk`, use `~/.openclaw` state, manage a Gateway, or route OpenClaw Sessions.

## Components

### Feishu Transport and Identity

`LarkTransport` owns the WebSocket, reconnection, message send, card update, media download, and callback response paths. It resolves App ID, credential reference, Feishu or Lark domain, streaming flush interval, media limit, and retry policy from configuration; deployment-varying values belong in Schemastery Config rather than scattered constants.

`OwnerGate` accepts DMs only from one paired `open_id`. Groups, other users, forwarded card callbacks, and identity-mismatched attachments or commands are rejected before project or Session data is read. Every button callback rechecks `open_id`, `chat_id`, card generation, one-shot nonce, and expiry. Feishu cannot prevent the owner from retaining displayed text through screenshots, notifications, or history, so full paths appear only in the authorized DM.

Initial setup stores a Feishu application credential reference in Harness Settings and starts one-shot pairing. The bot returns only a short pairing code containing no project data; the user must confirm that code in the local Harness Settings page, after which the plugin fixes one owner. Re-pairing requires revoking the owner from local Settings and cannot be initiated entirely through Feishu. Harness Credentials owns the secret value; logs, diagnostics, cards, and durable queues never record the App Secret.

### Projects, Sessions, and Binding

`BindingController` reads ordered projects from `ctx.workspaceRegistry.list()` and ordinary Sessions from each Workspace's `sessionIds` plus Host Session summaries. A project card displays its title and full absolute path. A Session card displays title, Session ID, and `Running`, `Idle`, `Awaiting approval`, or `Stopped`, with running Sessions first. Archived, `origin: subagent`, deleted, missing-workdir, or not safely resumable Sessions are not bindable. The implementation reuses the ordinary-Session rules already owned by `@deepseek-ai/dsh-session-messenger`, promoting that resolver to a public Host API if needed; it must not duplicate cold-resume, archive, or subagent policy.

Feishu does not provide a native slash suggestion menu inside its text box; OpenClaw's Feishu documentation likewise requires slash commands to be sent as plain text. The plugin therefore cannot observe `/` before the user sends it. Exact messages `/` and `/进入`, plus the bot menu action `进入项目`, use a no-model command fast path: receipt immediately returns the project card, project selection updates it to a Session card, and Session selection binds the current `owner open_id + chat_id`. `/切换` reopens selection, `/解绑` removes the binding, `/状态` shows connection and binding status, and `/帮助` lists commands.

A binding record contains at least schema version, owner, chat, Workspace ID, canonical project path, Session ID, binding time, and generation, and is atomically stored in plugin-owned Profile state. Harness restart validates owner, Workspace, project directory, archive set, and Session origin before restoring a binding; failure unbinds and requests a new selection. The plugin does not accept messages while completely offline, add a resident background service, or launch Harness remotely.

### Durable Message Queue

`DurableInbox` deduplicates on Feishu message ID and assigns a monotonic sequence per authorized DM in receive order. Text and attachments are atomically persisted with write-ahead ordering before Feishu receives an `enqueued` acknowledgement. Each queue record contains at least event ID, sequence, binding generation, target Session ID, normalized content, attachment references, status, attempt count, and timestamps. Restart recovers only `prepared` or `queued` records that still target the same valid binding generation; delivered IDs never enter Harness twice.

Ordinary messages use Harness `createUserMessage` and `Agent.followup()`, with each message becoming its own follow-up turn. A running target receives it only for the next turn; an idle or cold Session is resolved through Host Typert lookup and woken without calling `ctx.agents.resume()` directly. One binding has one queue consumer. The consumer correlates its pre-created Message ID across `agent/inbox/claimed`, `user/message`, and the matching `turn/end`, and dispatches the next Feishu message only after the prior one reaches a terminal state. It must not preload the entire Feishu queue into Harness or create a parallel driver. The Feishu `enqueued` acknowledgement never claims that the model read or completed the task.

`/插话 <content>` uses `Agent.steer()` for the nearest safe step and shows usage when content is absent. `/停止` uses the command fast path, marks undispatched remote records cancelled, removes an unclaimed remote message from the Harness inbox by its pre-created Message ID, and calls `Agent.cancel(..., { keepInbox: true })` to stop the active turn; queued Harness messages from other sources must survive. Ordinary messages never implicitly steer or interrupt.

### Session Events and Streaming Cards

`SessionProjection` reuses the Harness ApiProxy mux and Host-computed tool views rather than maintaining a second runtime status. After binding, it observes only new events and the currently incomplete turn for the target Session, without replaying full history. The owner sees progress produced after binding whether a turn started from Feishu or from Harness Desktop.

Each active turn owns one continuously updated Feishu card. The card retains the OpenClaw-Lark presentation of typewriter text, streaming output, current phase, compact tool timeline, waiting approval, error, stop, completion, elapsed time, and token usage. Updates use configurable throttling and monotonic revisions so an older update cannot overwrite newer state. Card update failure falls back to bounded text messages without duplicating the final answer.

Text comes from `assistant/chunk` and the final `assistant/message`; tool state comes from `tool/call`, `tool/result`, and Host safe presentation data; elapsed time comes from Harness event time; tokens use only authoritative Harness `TokenUsage` fields. Missing usage displays `Unavailable` and is never estimated or copied from OpenClaw statistics. The plugin follows Harness visibility rules and never sends system prompts, hidden reasoning, credentials, raw environment variables, or complete tool arguments that may contain secrets to Feishu.

### Attachments

Images are downloaded only after owner, Feishu media type, and size checks, then saved through `ctx.attachments.saveImages()` as ordinary Harness `image` blocks. PNG, JPEG, WebP, and GIF count, pixel, and byte limits remain those of the mounted AttachmentStore; the plugin cannot relax them.

Other files are downloaded to a randomized plugin-owned directory under `$DSH_HOME`, using a safe filename, atomic write, content hash, and current-user-only permissions. The message carries only filename, size, hash, and absolute staging path and never writes into or overwrites the project. Harness read tools may inspect that path; PDF, archive, or proprietary-format parsing depends on the Session's existing tools. The default media limit matches OpenClaw-Lark's 30 MiB and may be tightened in plugin configuration. A bounded cleanup job removes staged files after seven days by default.

### Approvals

The plugin does not register a second terminal `approval/request` answerer. It reuses the existing ApiProxy `approval/requested`, `approval/resolved`, and response path, so Desktop and Feishu present the same Harness approval. The first valid answer wins; a later click receives an already-handled or expired response.

A Feishu approval card exposes only `Allow once` and `Reject`. Its callback binds owner, chat, Session ID, Approval ID, optional Call ID, tool name, card generation, one-shot nonce, and short expiry, and submits only `allowed-once` or `rejected` after validation. It does not provide permanent grants, approval-policy changes, sandbox disabling, or permission-preset changes; those operations remain Desktop-owned.

### Settings, Diagnostics, and Lifecycle

The Client plugin contributes a `dsh-lark` Harness Settings page with the master switch, application credential status, domain, owner pairing status, connection state, active binding, queue depth, latest redacted error, connection test, re-pairing, and staged-attachment cleanup. The page does not display the App Secret or grant browser code filesystem or shell access.

Disabling the master switch stops receiving, rejects new callbacks, cancels reconnects and timers, ends incomplete card refreshes, revokes mux and Agent listeners, and closes the WebSocket in order. Persisted but undispatched Feishu instructions become `paused`. Re-enabling leaves them paused until the local Settings page explicitly chooses `Resume queue`; choosing `Clear queue` marks them cancelled. Uninstalling does not delete Harness Sessions or credentials automatically; Settings provides a separate explicit `Clear Feishu plugin data` action.

Connection diagnostics report only plugin version, Harness version, domain, WebSocket phase, whether an owner is paired, whether the binding is valid, queue counts, and stable error codes. Every open ID, chat ID, Session body, attachment body, App ID, and App Secret is omitted, truncated, or hashed. Diagnostics never start a model, answer an approval, or write a project.

## Error Handling

Missing startup configuration or unavailable credentials keep the plugin in `disabled-error` and explain the problem in Harness Settings without starting a partial WebSocket. Network disconnect uses bounded backoff. If Harness remains online while Feishu is unreachable, already persisted inbound records survive and outbound cards enter a recoverable failure state. Once Harness exits completely, no receiver exists and the plugin makes no reliable-delivery promise for messages sent during that offline interval.

If a project or Session expires after its card is rendered, the button callback revalidates and rejects the binding. If a bound Session is later archived, deleted, or becomes a subagent, queue consumption stops, the binding becomes invalid, and the owner is asked to select again. Attachment validation, size, write, or read failures reject only that attachment message and never deliver a partial attachment batch or empty instruction to an Agent.

Restart recovery covers crashes before write, after write but before acknowledgement, after Harness inbox acceptance but before plugin state update, and during card update. Recovery first looks for the Feishu event ID and pre-created Harness Message ID, then either marks the record complete or retries with the same ID; uncertain state never produces a second model instruction.

## Data Limits

Durable plugin state contains only configuration references, owner pairing, one DM binding, message deduplication and FIFO metadata, normalized messages not yet delivered, card revisions, approval callback nonces, and staged-attachment metadata. It does not copy complete Session history, run a cross-device service, upload a project index, or write into `~/.openclaw` or another Agent runtime's directory.

## Verification and Acceptance

- Installation and disablement: pack a tarball; installing it into a real `web` Profile adds both the dependency and `dsh.profile.bundles`; restarting activates Host and Settings; disabling leaves no WebSocket, listener, timer, or new delivery; removing the Bundle leaves the Profile bootable.
- Identity: only the paired owner's DM can read projects, full paths, and Sessions; groups, other users, forwarded cards, and replayed callbacks cannot read or operate Harness; re-pairing starts only from local Settings.
- `/` entry: sending exact `/` immediately returns a project card without a model call, then permits ordinary-Session selection and binding; full absolute project paths are shown; expired, archived, and subagent targets reject consistently.
- Ordering and recovery: consecutive messages reach Harness as separate follow-up turns in receive-sequence order; a running target has no parallel driver; duplicate Feishu events do not duplicate delivery; plugin and Harness restart preserve the binding and unfinished queue order.
- Control: ordinary messages only follow up, `/插话` only steers, and `/停止` stops the current turn, removes an unclaimed remote message, and cancels the undispatched remote queue while preserving other Harness inbox sources; each command checks the owner and current binding generation.
- Cards: text updates with a typewriter stream; tool timeline, state, elapsed time, and authoritative Harness tokens advance monotonically; coverage includes reconnect, out-of-order card revisions, update fallback, and final-answer deduplication.
- Attachments: images pass through Harness AttachmentStore; other files enter private staging without touching the project; tests cover type, size, hash, permission, atomic write, expiry cleanup, and partial failure.
- Approvals: one Harness Approval ID accepts only one valid answer across Desktop and Feishu; Feishu can only allow once or reject; expired, repeated, cross-user, cross-Session, and already-resolved clicks all fail closed.
- Evidence layers: package unit tests cover parsing, authentication, queueing, cards, attachments, and callbacks; Host integration tests use a fake Feishu transport with real Workspace, Typert, Agent, ApiProxy, and persistence composition; product-visible behavior adds a keyless runnable snapshot; build, typecheck, lint, documentation gates, and `git diff --check` pass.
- Real operation: without user-provided Feishu application credentials, validation stops after offline coverage and real Harness install preflight and never reads or copies another runtime's secrets. After the user enters credentials in Harness Settings, acceptance covers real DM pairing, `/` project selection, Session follow-up, streaming cards, attachments, approvals, restart recovery, and plugin disablement.

## Implementation Phases

The foundation phase delivers the installable Bundle, Settings and pairing, WebSocket, exact `/` project and Session binding, text FIFO follow-up, status cards, and complete lifecycle. It first proves zero runtime effect while disabled, zero project disclosure to invalid identities, and zero duplicate delivery for duplicate events.

The completion phase adds typewriter streaming cards, tool timeline, authoritative tokens, `/插话`, `/停止`, images and other files, one-shot approval, and restart recovery. Each capability connects to an existing Harness event or service rather than adding a parallel runtime.

The verification phase completes keyless automation, real Profile package installation, disablement and uninstall, failure recovery, and Feishu acceptance when credentials are available. The artifact retains third-party notices and records the evidence boundary whenever live Feishu operation was not performed.

## Out of Scope

Feishu groups, multiple owners, multiple Harness devices, background receipt while Harness is fully exited, remote Harness launch, cross-Profile Sessions, subagent control, archive restoration, permanent approval, remote sandbox or permission-preset changes, complete Session-history replication, automatic project commit or release, and native slash autocomplete inside the Feishu text box are outside version one.
