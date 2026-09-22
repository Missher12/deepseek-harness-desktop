# Agent Note: Make the PTC expanded golden's scroll state explicit

Status: implemented

English | [中文](2026-09-22-ptc-scroll-state.zh.md)

## Problem

The PTC expanded ARIA golden captured the conversation after opening nested rows without declaring the conversation scroll position. Layout growth and the follow-scroll observer could therefore leave the capture either at the bottom or slightly above it, changing only the unrelated `Back to bottom` control.

## Decision

The PTC capture uses `captureExpandedTurnProcessAria` with `scrollToBottom: true`. The shared helper writes the conversation to its floor and waits for both the geometry and absence of the `Back to bottom` control before capturing. The golden consequently covers the nested PTC presentation without depending on transient scroll chrome.

## Alternatives considered

**Refresh the golden again.** Rejected because another refresh would preserve an incidental scroll state rather than define the scenario's input.

**Retry the browser test.** Rejected because retries would hide the timing-dependent state and would not prove the ARIA capture is deterministic.

**Remove the control from normalization.** Rejected because the control is user-visible and other scroll scenarios must continue to assert it.

## Consequences

The PTC test now proves its intended nested rows after establishing one explicit reader position. This changes no product behavior; scroll-away behavior remains covered by the dedicated chat-scroll scenarios.
