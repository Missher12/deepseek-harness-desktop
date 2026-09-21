# Agent Note: Reasoning at full length in the reading flow

Status: implemented

English | [中文](2026-09-22-reasoning-full-length-reading.zh.md)

## Problem

Reasoning was delivered through two independent disclosure controls. `ReasoningRow` owned a fixed-height scrollport with a mask, an expand/collapse button, an arrow, and a follow-latest control. Above it, the Turn process disclosure hid every row in its range, including reasoning-bearing Assistant rows, and the final-step answer's own reasoning was hidden separately. A reader therefore had to open one control and then scroll a second scrollport to read a thought the model had already delivered in full, and the transcript's own follow-tail behaviour fought the inner scroller's.

## Decision

Reasoning is literal text in the main reading flow. `ReasoningRow` renders a static heading and one growing body: no button, no chevron, no `role="region"` scrollport, no `max-height`, no mask, no truncation, no inner scroll, and no follow control. The transcript's scrollport is the only reading scroll, and its existing follow-tail logic keeps respecting reader input.

The Turn process disclosure no longer covers reasoning. `TURN_PROCESS_MEMBER_KINDS` names the kinds the process range may fold — `assistant-step`, `tool-call`, `context` — and it gates the seat's member test in place of the previous "everything not independent" test, which had admitted prompt, error, and tail rows whose anchors fell inside the range. A row whose Assistant data carries reasoning is additionally never covered, so a reasoning-bearing answer, or a process row that mixes reasoning with prose, stays visible whether or not the disclosure is open. A Turn then has a disclosure only when `processPresentation.hasExternalProcess` is true, which stops the process control from appearing over a Turn whose only process evidence is reasoning. `TurnProcessSpec.inlineReasoning` remains a recorded fact on the wire and in the log; it no longer decides disposition.

While a block is the streaming tail, `useRevealedText` paints a progressively growing prefix. The full received text rides `data-reasoning-full` from the first frame, so the DOM never carries a partial thought as the block's whole content. Frames are scheduled with `requestAnimationFrame` and stepped by elapsed time, so the revealed rate is the same at 60, 120, and 240 Hz; the hook never counts frames or assumes a fixed interval.

## Reveal budget

`REVEAL_CLUSTERS_PER_SECOND` is 240. `CATCH_UP_CLUSTERS` equals it, so the reveal owes the model at most about one second of typing before it owes the reader the whole chunk: a backlog larger than the budget is painted in a single frame, and a backlog pending past `BACKLOG_CHASE_MS` (300ms) is caught up regardless of size. A chunk that extends the previous text keeps the painted count, so a streaming append continues the reveal; a chunk that replaces it restarts, because the count described a prefix of the text it was measured against. Grapheme boundaries come from `Intl.Segmenter`, so a family emoji, a combining mark, or a CRLF never splits across a partial cluster.

Paused and terminal states show everything received: a finished, stopped, errored, backgrounded, or reduced-motion block returns the text itself, and a block that resumes after a pause shows what arrived while it was away without replaying it. The hook schedules no frame when nothing is pending.

## Alternatives considered

**Keep the disclosure and default it open.** The reader asked for the button to be gone, not merely reset. A default-open disclosure still costs a control, a chevron, and a state to reopen after every history load, and it re-hides the text on the next Turn close.

**Let the space stay folded and reveal it on browser find.** `useSearchableHidden` already made folded process rows findable, which is why folding was survivable for tool rows. It is not survivable for reasoning: find reveals a match, it does not make a thought readable in sequence, and the request was full text at all times.

**A higher `max-height` on the existing scrollport.** Any cap re-introduces the second scroller and the mask, and the transcript already scrolls. The cap was the defect, not its value.

**Reveal by `setInterval` at 4ms or 8ms.** A timer cannot express a refresh rate. Under a 240 Hz display an 8ms timer is a 125 Hz reveal, and under a backgrounded or throttled tab it keeps firing work nobody can see. Frames with an elapsed-time step give one rate on every display and stop when the display stops.

**Per-character DOM nodes.** They make selection, copy, and `textContent` unstable and multiply the node count per chunk. One appended `Text` node keeps `Range` endpoints and collapse-free selection, which the component already relied on.

## Consequences

A Turn whose only process evidence is reasoning now has no process control at all, so `message.turnProcess.thoughtForAWhile` no longer has a reachable surface and six `message.reasoning.*` locale keys were deleted. Reasoning text that previously required two disclosures is now in the reading flow, which lengthens a compact transcript: `[data-turn-process-member]` still marks the reasoning-bearing row as a process-range member for layout, but its `hidden` attribute stays off. The [ChatView suite](../../../../packages/client/ui-chat/tests/chat-view.client.spec.tsx) covers the fold boundary in compact mode, [reasoning-row](../../../../packages/client/ui-chat/tests/reasoning-row.client.spec.tsx) covers full-length reading, selection, and the absent controls, and [reasoning-stream](../../../../packages/client/ui-chat/tests/reasoning-stream.client.spec.tsx) covers the reveal rate, the burst budget, grapheme boundaries, pause, and resume. The refresh-rate claim rests on the elapsed-time step and a fake-clock test; 120 and 240 Hz were not observed on hardware.

## Related

- [Reasoning admission and the prompt carrier budget](2026-09-22-image-admission-envelope.md)
