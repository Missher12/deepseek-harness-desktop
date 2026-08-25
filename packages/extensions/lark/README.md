# @deepseek-ai/dsh-lark

English | [中文](README.zh.md)

An independently installable DeepSeek Harness Bundle that lets one explicitly paired Feishu or Lark owner enter an existing ordinary Harness Session from a private chat and continue developing in it. It reuses the Session's existing Agent, approval policy, sandbox, tools, model, history, and project directory. It does not embed OpenClaw, create a second Agent runtime, or expose project data to unpaired users.

## Install

Build and pack from this repository, then add the tarball to the `web` Profile: run `pnpm --filter @deepseek-ai/dsh-lark bundle`, run `pnpm --filter @deepseek-ai/dsh-lark pack --pack-destination ./artifacts`, then run `dsh plugin --profile web add /absolute/path/to/artifacts/deepseek-ai-dsh-lark-0.1.1-rc.2.tgz`.

Restart Harness after installation. The transaction writes both the package dependency and the `dsh.profile.bundles` layer. The package is not a Desktop-managed default and can be removed independently.

## Feishu/Lark app setup

Create a self-built app, enable its bot, and use WebSocket/long-connection event delivery. Subscribe only to:

- `im.message.receive_v1`
- `card.action.trigger`

Grant the application permission to receive and send bot messages (`im:message`). Grant `im:resource` when image/file input is required. Publish an app version and make the bot available only to the intended owner account. A bot menu item named `进入项目` is optional; it uses the same fast path as `/`.

In Harness Settings → Lark Remote Development, enter the App ID and App Secret. Secret values are written only to the Harness credential store and are never returned to the browser, plugin state, logs, or cards. Select Feishu or Lark as the domain in the plugin configuration when needed, then enable the plugin.

The first accepted private DM receives a short pairing code. Enter that code locally in Harness Settings. Only the exact paired `open_id` and private-chat ID can read project/session facts or submit work. Group chats, bot echoes, another account, expired/replayed card actions, and stale generations are rejected before project data is read.

## Enter a project and Session

Send exact `/`, `/进入`, `/切换`, or use the `进入项目` menu item. This opens a no-model project card. Select the full project path, then select an existing ordinary unarchived Session. Running Sessions are listed first. Archived, deleted, blank, subagent, and project-mismatched Sessions are excluded and revalidated when clicked. The final owner/chat/project/Session binding is durable across restart.

Ordinary text then becomes one remote Harness turn in that exact Session and appears in conversation history as the same visible user message produced by the local composer. Every accepted Feishu event is write-ahead persisted with a pre-created Harness Message ID. Messages are delivered in original Feishu order, one at a time; item N+1 is not submitted until item N is claimed by the selected Session and its exact `turn/end` is observed. Restart recovery reconciles the existing inbox and Session history before reusing that same Message ID, so it does not intentionally duplicate an indeterminate delivery.

Before an active binding exists, ordinary text is not accepted into the durable queue. The bot replies with the current binding status and directs the owner to `/` instead of failing the Feishu callback.

Images are downloaded only after owner admission, validated by the Harness AttachmentStore, and committed as durable image references. Generic files are limited to 30 MiB, stored with mode `0600` under `$DSH_HOME/lark/files`, described to the Agent by a private temporary path plus SHA-256, and retained for seven days by default. No attachment is written into the selected project automatically.

## Commands and output

- `/` or `/进入`: choose project and Session without invoking a model.
- `/切换`: reopen project selection.
- `/解绑`: remove the current Session binding.
- `/状态`: show the paired owner's current binding.
- `/插话 <内容>`: steer the currently running Session through its existing Agent.
- `/停止`: cancel the active remote turn, remove only unclaimed `dsh-lark` messages, and retain unrelated inbox work.
- `/帮助`: show bounded command help.

Each Harness turn owns one Feishu interactive card. It paints a stable placeholder first, then streams visible assistant text with a typewriter effect, safe tool titles/status, elapsed time, the exact model ID/provider/reasoning effort, and real Harness input/output/cache token usage when available. The route comes from the selected Session's durable request header and is corrected by the actual assistant message, so a model switch is reflected in the same card. Reasoning content, system messages, environment values, raw tool arguments/results, secrets, and unrestricted logs are not projected. A bounded text reply is used if card creation or update fails.

Harness approval requests use the existing ApiProxy approval record. Feishu exposes only Allow once and Deny; the first valid desktop or Feishu response wins. No always-allow authority is added.

## Disable, recovery, and uninstall

Disable from Harness Settings to reject new ingress, close the WebSocket and mux stream, stop card timers, and pause undispatched remote queue items. Re-enabling does not silently replay them: click Resume queue locally. Full Harness shutdown leaves no receiver or background daemon.

Clear data removes only plugin-owned owner, binding, queue/card/nonce metadata and private staged files. It does not delete Harness projects, Sessions, Session messages, credentials, or unrelated inbox entries. Uninstall with `dsh plugin --profile web remove @deepseek-ai/dsh-lark`.

Restart Harness after removal. The package dependency and bundle layer disappear together; ordinary Sessions remain unchanged.

## Verification boundary and attribution

Offline tests cover owner gates, signed actions, ordinary-Session validation, durable FIFO/restart reconciliation, cards, approvals, attachments, settings lifecycle, Loader composition, and Profile removal. A real Feishu acceptance requires App credentials entered by the user in Harness; tests must never import credentials from OpenClaw or Hermes.

The implementation uses the official `@larksuiteoapi/node-sdk`. WebSocket lifecycle and serialized card-flush patterns were informed by the MIT-licensed `@larksuite/openclaw-lark` version `2026.7.16`; this package is an independent Harness implementation and neither bundles nor depends on OpenClaw-Lark. See [LICENSE](LICENSE#third-party-notices).

## Model Experience

### Remote owner turns

#### What the model sees

The plugin registers no model tool, system prompt, or hidden instruction. Each accepted ordinary Feishu message becomes one ordinary visible user-role turn in the selected Session with `source.kind=user`; the paired-owner and transport facts remain in plugin-owned storage rather than model context. Admitted images appear as durable Harness image attachments; admitted generic files add only the owner text plus their private staged path, display name, SHA-256, and expiry. Feishu identity values, pairing codes, credentials, card action values, transport diagnostics, raw tool payloads, and reasoning are never added to model context.

#### Token effect

An accepted remote turn adds the same user text and admitted attachment description that a local turn would add, then the selected Agent's normal reply, tool calls, and results follow the Session's existing retention policy. The settings UI, transport, project cards, queue metadata, pairing state, and streamed Feishu projection add no model tokens. The card reports the actual Harness model route and token usage but does not feed that report back into the Session.

#### KV Cache effect

Enabling this plugin does not change the model's static prompt or tool-definition prefix. Each claimed remote message appends at the existing Session tail, so it preserves prior prefix cacheability just like a local user turn; switching the bound Session changes only which existing Session receives later tail content.

## Known Limitations and Deferred Work

- One plugin instance supports one paired owner, one exact private chat, and one active project/Session binding; group chat, multiple owners, concurrent bindings, broadcasts, and public-network control are intentionally unsupported.
- A real Feishu/Lark acceptance still requires a user-created self-built app, published permissions, and credentials entered locally in Harness; the package never imports legacy OpenClaw or Hermes credentials.
- Generic files use a private temporary path available only on the Harness host and expire after the configured retention period; the plugin does not upload arbitrary local project files back to Feishu or automatically copy received files into a project.
- Feishu exposes only Allow once and Deny for an existing Harness approval. Persistent permission changes, always-allow authority, Session creation, archived/subagent selection, and autonomous background development are not implemented.
