# Desktop Browser Layout and Reliability Design

English | [中文](2026-08-30-desktop-browser-layout-reliability-design.zh.md)

## Goal

Make Browser Control usable on complex pages while keeping the conversation, composer, left navigation, and visible Browser workbench independently usable at ordinary desktop widths. The same release must expose meaningful Windows installer progress and retain the existing fail-closed authority model.

## Layout contract

The shell never overlays the utility workbench on top of the conversation. The right workbench first shrinks toward its floor, then the rendered left navigation temporarily concedes to its compact rail without rewriting the saved width. A genuine small-window fallback shows one focused surface instead of stacking panes. Both dividers remain draggable, the Browser workbench may grow to the available viewport, and browser content stays at 100% zoom unless the user explicitly changes it.

The conversation scrollport owns the sticky composer as one measured stack. Prompt-rail hints and the status line remain above or inside that measured stack and cannot paint over the input card.

## Browser snapshot contract

Accessibility walking remains bounded, but hitting the raw tree, semantic text, actionable reference, or JSON budget produces a useful deterministic partial snapshot instead of failing the operation. The walker prioritizes visible actionable controls and keeps the wire result within the existing frame limit; it does not send an unbounded page dump to the model. Cold renderer startup is bounded and retryable, completed loading waits return immediately, navigation waits have a bounded successful fallback, and an initial non-web history entry is treated as no usable history rather than a protected target. A main-owned CDP Overlay marker shows the next click or scroll target without page-script injection, selectors, or renderer-owned authority.

Official Browser Control failure may disable direct shell fallback only for the active operation window. A successful official operation or Browser Stop clears that guard.

## Windows installer contract

The NSIS details area receives explicit, bounded stage messages for extraction, installation, shortcuts, registration, and completion. It never prints user data, absolute private paths, tokens, or browser content.

## Safety and acceptance

Automated acceptance uses a large local Bilibili-shaped fixture and performs no public post, message, or account mutation. Done means: a complex snapshot returns actionable refs under the wire bound; first-use navigation is bounded; wait/back/Stop regressions pass; the assembled shell has no pane or composer overlap at the reported resolutions; Mac packaging installs and launches; Windows packaging and installer smoke pass in the Windows workflow.
