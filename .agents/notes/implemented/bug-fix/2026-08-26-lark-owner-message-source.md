# Agent Note: Lark owner messages use the user source

Status: implemented

English | [中文](2026-08-26-lark-owner-message-source.zh.md)

## Problem

An admitted Feishu owner message opened an ordinary Harness turn but carried a plugin message source. Harness therefore classified it as injected context instead of the visible user message produced by the local composer. The selected Session ran the instruction, but its conversation history, activity, title, and human-message accounting did not represent the remote owner input as a user prompt.

## Decision

The exact paired-owner and private-chat checks establish the human origin before `DurableLarkInbox` creates a Harness message. Ordinary queued input and `/插话` steering therefore use `source: { kind: 'user' }` and continue through the existing `Agent.followup()` or `Agent.steer()` path. Feishu event identity, binding generation, target Session, queue sequence, and delivery status remain authoritative in plugin-owned durable records; transport metadata does not enter the model-visible message.

The plugin does not rewrite existing Session history. Messages committed with an older plugin source remain context records, and a message already present in the Agent inbox retains its stored source. New messages and queue records reconstructed by the current runtime use the user source.

## Alternatives considered

**Render `dsh-lark` plugin context as a user bubble in the Client.** This lost because it would couple the removable transport to Harness conversation rendering while titles, activity timestamps, and usage accounting would still treat the prompt as non-user context.

**Append a second user message for presentation.** This lost because two durable messages would duplicate the prompt in Session history and risk sending the same owner instruction to the model twice.

**Add a new external-user message-source variant.** This lost because the paired Feishu owner is the same human actor represented by the existing user source, while transport provenance already has an authoritative durable home outside model context.

## Verification

Inbox tests require ordinary and steering messages to carry the user source while preserving write-ahead persistence, exact Message IDs, strict FIFO, deduplication, restart reconciliation, attachments, and source-scoped cancellation. Real Profile acceptance selects an existing Session, sends a Feishu prompt, observes one visible Harness user row, and confirms the matching turn completes through the existing streaming-card path.

## Consequences

New Feishu prompts appear in Harness exactly where local composer prompts appear and participate in ordinary Session activity, title, and human-message projections. The Session event alone does not distinguish local-composer and paired-Feishu user messages; operational provenance remains in `dsh_lark` storage and is removed only by the plugin's explicit data-clear operation.
