# Agent Note: Lark runtime footer uses exact Harness events

Status: implemented

English | [中文](2026-08-26-lark-runtime-footer.zh.md)

## Problem

The Lark turn card streamed visible text and retained elapsed time plus a combined token count, but it did not show the Harness model ID or provider. The selected Session already persists the request route, and each assistant message identifies the route that actually produced it.

## Decision

`TurnProjection` carries only non-secret runtime facts: provider, model ID, optional reasoning effort, elapsed time, and aggregate Harness usage. A new turn is provisionally seeded from the selected live Session's latest durable request header. A `request/header` event updates the route before dispatch when model selection changes, and an `assistant/message` event is the final authority for provider and model. Matching assistant routes retain the reasoning effort from the request header because assistant message sources do not repeat it.

The card follows the OpenClaw-style two-line footer: status, elapsed time, model ID, provider, and reasoning effort on the primary line; input/output arrows, the retained combined Token count, and cache read/write counters on the detail line. Reasoning content, request prompts, adapter configuration, credentials, and raw events remain excluded.

## Alternatives considered

**Read only the latest Session header.** Rejected because a model switch can occur after turn start, and the header is provisional until the request is assembled.

**Read only the assistant message source.** Rejected because the model ID would remain absent during the streamed request and first visible chunks.

**Copy the whole request header into the card projection.** Rejected because it contains system and tool schema material that the paired-owner card does not need.

## Verification

Projection tests require seed preservation, request-header replacement, assistant-source final authority, usage retention, and reasoning-content exclusion. Card tests require one stable message, monotonic streamed text, exact model/provider/effort labels, elapsed time, input/output arrows, combined Token, cache read/write counters, and the existing bounded fallback.

## Consequences

The footer can identify the actual responding model without adding model-visible context or changing request routing. Initial placeholder metadata can reflect the prior durable route for a brief interval, but the request-header event corrects a changed selection before model output and the assistant message corrects the final route. Projection and card tests cover seed preservation, route changes, final authority, token details, cache details, and exclusion of reasoning text.
