# Agent Note: Built-in reading presentation

Status: implemented

English | [中文](2026-09-07-native-reading-presentation.zh.md)

## Problem

A single-line reasoning preview hides the source structure of long tasks. Folding every terminal Turn can hide unsuccessful work, and hiding selected text interrupts reading.

## Decision

Chat owns the presentation inside its existing Assistant renderer. A neutral reasoning card retains one literal Text node; prefix appends use Text.appendData so a browser selection keeps its offsets. The card follows at most two computed line heights every 800ms. Wheel, touch, viewport focus and selection pause following; resuming is explicit. Expanding changes the same viewport, preserving the text and reading position. Completed history, background documents and reduced-motion views do not auto-scroll. Historical cards own no live follow timer or document motion listener.

Native Markdown remains the body renderer. Newly mounted streaming blocks receive a brief opacity transition; received text is never held in a second typewriter queue. The native Tool, attachment, approval and error renderers keep their ownership and source order.

Compact mode folds only a completed Turn with an eligible final-answer boundary and complete history. Cancelled, failed, blocked, interrupted, max-token and unknown outcomes keep process evidence visible. A live selection defers hiding until it clears; a focused descendant keeps its disclosure open. Stable searchable wrappers preserve browser find and mounted renderer state.

The reading behavior is informed by [dsh-better-display](https://github.com/aa2246740/dsh-better-display). This implementation belongs to native Chat and adds no external loader, model instructions or executable answer cards.

## Alternatives considered

A second conversation projection would duplicate native Tool and Markdown behavior and couple the Desktop to another plugin loader. Replacing the entire reasoning Text value on each chunk would invalidate selection offsets. A simulated typing queue would delay text that the model has already delivered.

## Consequences

Display preferences and local reading gestures stay outside the Session log. Unit tests cover terminal outcomes, selection, following, reduced motion and disposal. The assembled browser scenario drives a held model stream through the real composer and records final Markdown output; platform packaging and native acceptance remain separate requirements.
