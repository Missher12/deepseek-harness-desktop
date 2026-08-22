# Session Stop, Close Behavior, and Billing Stats Design

English | [中文](2026-08-23-session-stop-close-and-billing-stats-design.zh.md)

**Date:** 2026-08-23

**Status:** Approved for implementation

**Target:** DeepSeek Harness Desktop for Intel macOS and Windows x64

## Goal and Scope

This iteration has three features only: make peer-session collaboration explicitly stoppable; let the user choose whether closing the main window keeps the app running or quits; and split the footer into stable performance and financial statistics. The ChatGPT product switcher is cancelled.

The features remain Desktop increments. Ordinary Web composition is unchanged, `~/.dsh` is neither migrated nor copied, API keys never cross into the renderer, and estimates are never presented as provider invoices.

## Hard Stop for Session Collaboration

Receipts remain authoritative for delivery, recovery, reply capability, and notification state. The first `send_message_to_session` creates a collaboration chain and `reply_to_session` inherits it. When an Agent continues after a reply, it must pass the exact previous delivery ID as a continuation so that the send remains part of the same stoppable chain rather than creating an untracked root.

The plugin adds `stop_session_collaboration` and a same-origin capability-protected stop route. The caller must be one of the two chain participants. The Host walks from the delivery ID to the root receipt, records the stop time on the root, settles replyable or waitable receipts in that chain as `aborted / collaboration-stopped`, revokes later reply capability, and immediately settles exact waits. Repeated stops are idempotent. Forged, cross-session, deleted, and unknown delivery IDs are rejected before inbox, Session, or durable-state mutation.

A stopped chain cannot wake either Agent through reply or continuation. A later user-requested task sent with an exact Session ID starts a new chain rather than permanently blocking the pair. The system prompt requires one substantive result for one task, no reply to pure acknowledgements or closing messages, and no new chain after a stop without a new user instruction. Natural-language classification is never a security decision.

The ordinary Harness chat timeline remains. An outgoing relay row gains one compact **Stop collaboration** action and becomes **Stopped** after success. The legacy drawer, standalone communication trigger, and custom card system remain unmounted. A recipient can also ask its Agent in the ordinary composer to stop the current delivery.

## Window Close Behavior

The General Settings section receives a Desktop-only **When closing the window** row:

- **Keep running in background:** macOS hides the main window and remains reachable from the Dock. Windows hides the window and retains a system tray icon with **Show DeepSeek Harness** and **Quit**. The Harness child remains running.
- **Quit the application:** closing the main window invokes the existing bounded shutdown, stops the owned Harness process tree and random loopback listener, then exits.

Defaults preserve existing platform behavior: keep running on macOS and quit on Windows. The choice is atomically stored in a dedicated Electron `userData` JSON preference file, never in `~/.dsh`. Cmd+Q, Ctrl+Q, application-menu Quit, and tray Quit always perform a real quit regardless of the close-button preference.

The same General Settings contribution adds an **Enable peak/off-peak estimates** switch, enabled by default. Turning it off hides **Last turn est.**, **Session est.**, and the current pricing tier together while retaining the exact provider **Available balance**. This is not a presentation-only switch: if the provider later removes tiered pricing, stale rules must not continue producing hidden but incorrect amounts. A new fixed-price or replacement policy can be enabled only after a Desktop update ships it.

The preload exposes only get/set IPC for a closed enum and boolean. The main process validates the trusted main frame and exact origin. Corrupt or unknown preferences fall back to the platform default; a failed write retains the previous value and returns a bounded error to Settings.

## Effective Footer Statistics

Existing performance facts continue to use whole-log projections so paging, loading older messages, and compaction cannot move them. The footer becomes at most two compact rows:

1. The performance row keeps turns, steps, LLM/tool time, TTFT, throughput, cache hit, and input/output tokens.
2. The financial row renders available groups in order: `Last turn est. ¥… · Session est. ¥… | Available balance ¥… | Weekday peak / Weekday off-peak / Weekend off-peak`.

A new `latestTurnBilling` projection deduplicates provider usage chunks and final assistant usage by turn/step, accumulates cache-hit, cache-miss, cache-write, and output tokens, and records the provider/model actually used by that turn. Streaming chunks update only projection state. The view publishes only on the matching `turn/end`, preventing footer rerenders on every stream frame. Failed or aborted turns settle reported usage at `turn/end`; turns with no provider usage do not fabricate zero cost.

Money appears only when the latest turn or whole session proves a single supported official DeepSeek model. Last-turn cost uses the latest completed turn usage; session cost retains its cumulative estimate. The existing same-origin read-only `/user/balance` bridge supplies the provider's available balance. The UI never subtracts local estimates and calls the result an account balance.

Embedded prices match the official page as of 2026-08-23: `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` share Flash prices, while `deepseek-v4-pro` uses Pro prices. Beijing-time weekday 09:00–12:00 and 14:00–18:00 windows are peak; from 2026-08-23, Saturdays and Sundays are off-peak all day. The financial row recomputes the current tier every minute and exposes cache-hit, cache-miss, and output prices per million tokens in a tooltip. Custom providers, unknown models, and mixed-model usage render no cost or tier.

Every amount remains marked as an estimate because it comes from model-reported usage and an embedded official price table, not invoice reconciliation. A later Desktop release must recheck the changeable official pricing page.

## Data and Interfaces

- Receipts gain optional continuation-parent and stopped-at fields; old receipts remain readable.
- Model tool results continue to hide reply tokens and add only stable stop status/error codes.
- Session Messenger Client transport gains stop; HTTP stays loopback same-origin, generation-capability protected, bounded JSON, and exact-source authorized.
- Desktop preferences contain only a version, `closeBehavior: keep-running | quit`, and `tieredPricingEstimates: boolean`.
- `latestTurnBilling` publishes only turn, four token buckets, and a `none / single / mixed` billing identity, with no message body or credential.

## Acceptance Criteria

- A→B→A continuation remains one chain. After either participant stops it, reply, continuation, and exact wait return `collaboration-stopped` without wake, injection, or message creation.
- Stopping another chain, a forged delivery, an unrelated session, or an unknown receipt rejects with zero side effects; an explicit new user send can create an independent chain.
- Close preference persists across restart. Mac hides or quits; Windows keeps a tray lifecycle or quits. Every explicit Quit path exits and cleans up the child process.
- Last-turn cost appears only after `turn/end` and does not rerender during streaming. Paging, compaction, reload, and checkpoint restore preserve settled data.
- Every weekend hour is weekend off-peak. Both weekday peak windows and their minute boundaries are correct. All three official V4 model prices match the official page.
- Disabling tiered estimates removes last-turn/session amounts and the tier together while exact available balance remains; the choice persists across restart.
- Missing official DeepSeek credentials, balance failures, unknown models, and mixed models hide only unavailable groups and expose no zero balance, false amount, or credential.
- macOS runs shared tests and isolated packaged smoke. Windows shared tests must pass, while native tray/close lifecycle acceptance runs in Windows CI and is never inferred from macOS.

## Out of Scope

ChatGPT switching or embedding, group chat, cross-device messaging, permanent peer blocking, arbitrary-provider price scraping, invoice reconciliation, auto recharge, API-key storage changes, Apple Silicon artifacts, and a Release publication are outside this iteration.
