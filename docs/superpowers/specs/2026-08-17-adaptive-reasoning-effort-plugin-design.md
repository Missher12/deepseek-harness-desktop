# Adaptive Reasoning-Effort Slider Plugin Design

English | [中文](2026-08-17-adaptive-reasoning-effort-plugin-design.zh.md)

**Date:** 2026-08-17

**Status:** Proposed

**Target:** Standalone DeepSeek Harness Web Profile plugin; this delivery targets Intel macOS Desktop only

## Goal

The plugin derives from [HanaAyane/dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort) `v0.6.0` at commit `f94622b46078ac8c064f91bdc10ab27e8cf32270`. It preserves the upstream model and reasoning-effort control, Canvas particles, drag feedback, and light and dark themes, while changing only the popup placement rules and disabling the character thumb by default.

Users can install, disable, and remove the plugin independently. The plugin does not modify Harness core packages, Electron preload, existing Host routes, session data, or the model directory. Its Host companion owns and disposes only a narrow preference route described below.

## Source and Compatibility Responsibilities

- The fork preserves the complete MIT License, `Copyright (c) 2026 HanaAyane`, the source link, and third-party asset attribution, and includes them in both the source package and the Desktop artifact's `THIRD_PARTY_NOTICES.md`.
- The fork accepts only differences directly related to adaptive placement, default settings, compatibility checks, and verification; it does not redraw the particle effect.
- The installation guide states that the original plugin and this fork must not be enabled together, preventing both plugins from competing for the same `conversation.input.model` slot.
- The plugin declares and pins a verified Harness peer-version range. The current Desktop baseline is `0.1.0-rc.5`, so the upstream plugin's unverified `rc.6` peer declaration cannot be reused directly. Both the pre-installation compatibility check and staged-profile load test must pass before the package can be enabled.

The current `conversation.input.model` slot is single-instance: the native control registers at priority `0`, while this plugin retains the upstream priority `-100`, shadows the native control while enabled, and releases the seat so the native control returns when disabled. If the replacement control crashes during render, the current slot boundary abdicates that entry and elects the native control; this verified seat-level fallback is part of acceptance.

React seat-level fallback cannot run when module download, dependency resolution, or plugin `apply` fails before component registration, so the product must not claim that every incompatibility recovers automatically. Version gating, pre-installation checks, a temporary-profile startup smoke test, and an explicit refusal to enable prevent these failures. Diagnostics retain the plugin version, Harness version, and missing service, but contain no credentials or session content.

## Models and Reasoning Efforts

The plugin continues to read models, `reasoning.efforts`, the default effort, and the current selection from the active session's `ModelDirectory`. The number, order, display labels, and submitted values come entirely from the Host; the plugin does not invent `low`, `max`, or any other effort.

The control refreshes the directory when opened. Immediately before committing a drag selection, it reads the latest directory again and invokes the directory selection method only if the target effort still exists. If the Host rejects the selection, the slider returns to the accepted effort and reports the failure through a visible Harness error; the failure does not change the session's model selection.

When the current model has no reasoning capability or fewer than two available efforts, the control retains model selection but does not render a meaningless slider. Addressed subagent sessions continue to follow Harness's native model-selection restrictions.

## Popup Placement

The popup renders through a portal into the stable overlay root and prefers a position 8 pixels below its trigger whenever it opens. Measurement uses `visualViewport`, the trigger's `getBoundingClientRect()`, and the popup's actual rectangle rather than an assumed window height, and avoids clipping by input-bar ancestors with overflow or transforms.

The popup remains below when it fits there completely. It flips above when space below is insufficient and space above can contain it completely. If neither side fits, it uses the side with more available height, caps the popup height, and scrolls its content; the popup always remains within the visible viewport.

Horizontal placement starts aligned to the trigger and clamps to safe margins on both sides of `visualViewport`. While open, the plugin observes window and `visualViewport` size and scrolling, ancestor scrolling in the capture phase, and trigger and popup size through `ResizeObserver`. It removes every listener when closed. Minor measurement changes during dragging do not repeatedly flip the popup; repositioning occurs only when the current side cannot retain the minimum usable area.

The portal does not change interaction ownership: the trigger retains `aria-expanded` and its popup relationship, Escape returns focus to the trigger, the Tab sequence remains continuous, clicks inside the trigger or popup do not invoke outside-close, and clicks elsewhere close the popup.

## Visuals and Settings

- Particle streaks, pixel radiation, waves, and glow come from the upstream Canvas 2D draw calls and `requestAnimationFrame`; the implementation does not replace them with CSS dots, DOM particles, or this repository's former WebGL effect.
- The character thumb remains off on first installation, when the setting is absent, and when the setting is corrupt. After an explicit opt-in, the preference is stored in profile-scoped Host settings rather than random-loopback-port-isolated `localStorage`, so it survives Desktop restarts.
- Harness theme variables remain the color source, and switching among light, dark, and system themes requires no reload.
- `prefers-reduced-motion` stops non-essential animation without hiding efforts, status, or actionable controls.
- Keyboard arrow keys, Home, End, focus styling, ARIA values, touch dragging, and pointer dragging remain equivalent.

The Host companion injects `settings` and `webServer`, owns one plugin-specific settings namespace, and exposes only the character-thumb boolean through exact GET and PUT routes. A per-generation capability injected into the same-origin index authenticates the Client half; the route accepts only the exact active loopback origin, enables no CORS, validates the JSON body and size, and is removed with the plugin. This route does not expand ApiProxy's settings allowlist or grant generic settings access.

## Failure and Uninstallation

Activation preflight validates the exact Host and Client service contracts before the replacement component registers. After preflight, both plugin halves use required injection rather than waiting indefinitely on a permanently missing service. A missing verified service or slot declaration keeps that version disabled; an entry that loaded successfully but cannot render falls back through the current slot-abdication mechanism. The two paths are tested separately and are not described as the same fallback.

Disabling or uninstalling the plugin removes its slot, settings entry, styles, event listeners, `ResizeObserver`, animation frames, and Canvas resources. Uninstallation does not modify model-provider configuration, session logs, or other plugin data.

Fallback guarantees only that native model selection and Host-advertised efforts remain available. It does not guarantee that the native control continues to show this plugin's Canvas particles, character art, or down-first popup. Enhanced visuals exist only while the plugin is loaded successfully.

## Verification and Acceptance

- Unit tests cover original Host efforts, directory refresh, accepted selection, Host rejection, fewer than two efforts, missing dependencies, and duplicate-plugin detection.
- Component tests cover down-first placement, bottom-edge flipping, both sides constrained, viewport zoom, popup-size changes, placement stability while dragging, keyboard operation, and touch operation.
- Visual and drawing tests prove that particle streaks, pixel radiation, and glow originate from Canvas draw calls. They also cover the character being off on first use and with absent or corrupt settings, persistence after explicit opt-in across random-port restarts, light and dark themes, reduced motion, and 200% zoom.
- Assembled Web Profile tests prove that the plugin can be disabled independently, that the native model selector returns after disablement, and that Harness still starts normally.
- Fault injection separately covers native-seat fallback after component render crashes and installation refusal for module, peer, missing-service, and `apply` failures; neither test class substitutes for the other.
- Mac Desktop acceptance uses a temporary `DSH_HOME` to verify installation, startup, a random port, a real model directory, plugin removal, and complete process cleanup; this delivery does not modify or publish Windows artifacts.

## Out of Scope

Redesigning particles, adding custom reasoning efforts, modifying model-provider configuration, changing Harness core slots, automatically installing the original plugin, Windows packaging, and application auto-update are outside this design.
