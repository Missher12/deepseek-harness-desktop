# `dsh-lark` Harness Command Center Design

English | [中文](2026-08-26-dsh-lark-command-center-design.zh.md)

**Date:** 2026-08-26

**Status:** Approved for implementation

## Goal

Turn the paired Feishu private chat into a removable Harness remote development command center. Sending the exact text `/` must return the complete command catalog immediately without invoking the model. The owner can then select the current project and Session, create or rename a Session, inspect or change its model and reasoning effort, execute an explicitly allowed Harness command, inspect skills, tools, jobs, subagents, usage, and diagnostics, and continue sending ordinary development messages into the same Harness Session.

## Interaction Contract

Feishu does not expose unsent composer keystrokes to a bot. The supported interaction is therefore: the owner types `/`, sends it, and receives one command-center card. `/进入` and `/切换` retain the project and Session picker. Commands with free-form input remain text commands because a button cannot safely invent a title, goal, or plan.

The command center groups all supported commands and shows their exact syntax. Buttons cover safe argument-free actions such as entering a project, creating a Session, opening the model or reasoning selector, compacting context, and reading status, skills, tools, tasks, usage, or diagnostics. Every callback is owner-, chat-, generation-, expiry-, and one-use-nonce-bound.

## Command Surface

The first release exposes these owner-facing commands:

- Session: `/进入`, `/切换`, `/新建`, `/重命名 <标题>`, `/解绑`, `/状态`, `/停止`.
- Model and execution: `/模型`, `/推理`, `/压缩`, `/目标 <内容>`, `/计划 [内容|off]`, `/权限 [预设]`, `/插话 <内容>`.
- Discovery: `/技能`, `/工具`, `/任务`, `/用量`, `/诊断`, `/帮助`.

Harness-native English forms `/compact`, `/goal`, `/plan`, and `/permission` are accepted through the same fixed remote-safe bridge. A leading `/skill-name ...` is accepted only when the exact name appears in the current Session's user-invocable skill catalog; it then enters the existing durable Lark FIFO as an ordinary visible user message so the Harness skill pre-step owns invocation.

OpenClaw-only gateway, channel, voice, browser, OAuth, configuration, restart, and administrative commands are not copied. Browser-only `/export`, persistent permission elevation, arbitrary command passthrough, arbitrary tool execution, shell shortcuts, and file upload from the Harness host remain excluded.

## Harness-Native Data Flow

Every command starts after the existing paired-owner gate. Session-bound operations re-read the durable binding and resolve the exact ordinary Agent through the established Harness ordinary-Session policy before acting.

Session creation calls `sessions.create` with the bound `workspaceId`, then binds only the exact returned ordinary Session after verifying workspace membership and cwd. Rename, model directory, model selection, reasoning selection, skill listing, and subagent listing use the existing Host APIs. Native commands call the current Agent's `ctx.commands` registry through a fixed allowlist. Tool names come from the current Agent's scoped `ctx.tools` schemas. Jobs come from the optional owner-scoped `ctx.jobs` view. No command-center operation changes Harness core or Desktop conversation storage.

Ordinary text and admitted skill invocations continue through `DurableLarkInbox`: one durable record per Feishu event, preallocated Harness Message ID, strict FIFO claim/terminal fencing, and restart reconciliation. Consequently, messages remain visible as ordinary user messages in the Harness conversation rather than hidden context injection.

## Model and Reasoning Cards

`/模型` reads the fresh Session model directory and renders provider/model buttons with the current route marked. Model callbacks carry only provider and model identifiers and are revalidated by `sessions.selectModel` at click time. `/推理` reads the same directory, finds the exact current route, and renders only efforts advertised for that model. The current/default effort is labeled; unsupported efforts are never invented.

Large model directories are split into provider and model cards so Feishu card limits stay bounded. Callback data remains within the existing four-key limit. Failed provider catalogs are summarized without exposing credentials or endpoint configuration.

## Read-Only Views

`/技能` lists current user-invocable skills and bounded descriptions. `/工具` lists only scoped tool names, not schemas, arguments, results, or secrets. `/任务` lists owner-visible background jobs and direct subagents with bounded labels and lifecycle status. `/用量` folds the latest bounded Session history and reports the newest completed assistant usage facts without estimating missing data or double-counting chunks. `/诊断` reports connection, pairing, binding, queue, Agent state, model routability, and capability availability as redacted booleans or counts; it never prints credentials, card nonces, Feishu identities, or raw tool payloads.

## Failure and Isolation

Business errors are rendered as short owner-facing messages. A command failure does not enqueue a model turn, mutate another Session, or disable the transport. Session creation is the only multi-step mutation: if creation succeeds but binding unexpectedly fails, the reply says that creation committed and asks the owner to switch manually; the plugin never deletes the created Session as compensation.

The feature remains inside the independently removable `@deepseek-ai/dsh-lark` Bundle. Existing typewriter streaming, coalesced terminal delivery, model and token facts, approvals, durable queue recovery, settings disablement, and uninstall behavior remain unchanged.

## Verification

Focused tests pin bare-slash routing, complete catalog rendering, fixed command allowlisting, skill admission, created-Session binding, model/reasoning callback revalidation, bounded read-only views, diagnostics redaction, and old callback rejection. The existing Lark suite must remain green, followed by package typecheck, bundle, documentation pairing, diff checks, tarball profile installation, Harness restart status, and installed-byte verification. A real Feishu owner DM remains the final network acceptance boundary.
