# Agent Note: Lark uses a Harness-native command center

Status: implemented

English | [中文](2026-08-26-lark-harness-command-center.zh.md)

## Problem

The first Lark remote-session release used exact `/` as a project-picker shortcut and exposed only binding, steering, stop, and help commands. It could continue an existing Session but could not act as the requested Harness remote development control surface for Session creation, model selection, native commands, or current capability discovery.

Feishu bots cannot observe an unsent `/` keystroke in the user's composer. Copying OpenClaw's complete command registry would also expose gateway, channel, OAuth, browser, restart, and administrative operations that do not belong to a removable Harness Session plugin.

## Decision

Sending exact `/` now returns a complete no-model command-center card. `/进入` and `/切换` retain the project/Session picker. Every card action uses the existing owner/chat/generation/expiry/one-use-nonce admission boundary.

The package adapts Session creation and rename, fresh model and reasoning directories, skills and subagents through existing Host APIs. It reads tool names and background jobs from the exact Agent's scoped registries. It reports usage only from final `assistant/message` token facts in completed turns and emits redacted diagnostic booleans/counts. Model and reasoning callbacks re-read the directory and reject stale choices before mutation.

Native command execution is limited to the explicit `compact`, `goal`, `plan`, and `permission` allowlist and still requires that exact command to be registered for the bound Agent. Future Harness commands do not become remotely callable automatically. A typed `/skill-name ...` is admitted only after exact current skill-catalog matching, then enters the existing durable Lark FIFO unchanged as a normal visible user message so the Harness skill pre-step remains authoritative.

`/新建` calls the Host create API with the exact bound workspace, then accepts only the returned ordinary Session after workspace-membership, archive, lineage, cwd, and ordinary-resolution checks. A create that committed but failed later binding is reported without destructive compensation.

## Alternatives considered

**Keep `/` as the project picker.** Rejected because the owner explicitly chose `/` as the complete command-discovery entry point; `/进入` already names project selection precisely.

**Pass every unknown slash command to Harness.** Rejected because future or deployment-specific commands may change permissions, export data, or perform administration without a remote-safety contract.

**Copy OpenClaw command implementations.** Rejected because they target OpenClaw's gateway and channel runtime rather than the selected Harness Session and would create duplicated state and authority.

**Invoke skills as hidden context.** Rejected because it would reproduce the earlier visibility problem. Skill text remains a normal durable user message visible in the Harness conversation.

## Verification

Tests require exact `/` command-center routing, `/进入` picker preservation, fixed native-command mapping, exact skill admission, strict created-Session binding, signed model/reasoning callback revalidation, bounded skill/tool/task/usage views, and diagnostic redaction. The full Lark suite, TypeScript build, Bundle build, bilingual documentation gates, Profile installation/removal, installed-byte verification, restart status, and one real owner DM form the remaining verification layers.

## Consequences

The paired owner gains a useful Harness remote development command center without a second Agent runtime or Harness core patch. Command discovery and read-only status do not consume model tokens. Session mutations are limited to explicit commands and signed callbacks. Some OpenClaw commands remain intentionally absent until Harness exposes an equivalent native service and an explicit remote-safety policy.
