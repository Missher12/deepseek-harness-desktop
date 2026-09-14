---
description: "Use native window menus and choose close behavior with the official Harness Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-shell

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Use native menus to start a session, open Settings, or reach the official session search. Choose whether closing the window keeps Desktop running or quits the application. This package requires the Electron preload; ordinary browser sessions remain unchanged.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The [Desktop base patch](../../../apps/desktop/base.cordis.patch.yml) mounts this plugin beside the separate [System Update plugin](../ui-settings-system-update/README.md). It is a Cordis plugin, not a profile-installable bundle. The package has no configuration fields; the native preload supplies window presentation and persisted close behavior.

The native recovery row opens a separate Electron window for plugin compatibility and System Update, including when the Web Host cannot start. It sends no plugin path or validation callback from the browser.

The General settings row reads and writes only `closeBehavior`. Native responses and broadcasts determine the displayed value; the row does not change it optimistically. Loading disables edits, failures expose localized retry copy, and disposal invalidates pending responses. Pricing, usage statistics, model settings, and instruction policies are outside this package.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [browser entry](src/client/index.ts) uses the official Cordis `Context`, locale service, Slots, and `uiWorkspace`. Components derive their owner and locale props from the official types; `InjectFace` derives callback and framework-bound observable props. The Node entry subscribes to the official launcher’s `appReady` service and announces successful Host startup for the native supervisor; disposal cancels a pending announcement. Electron owns native window lifecycle and preference storage.

The restricted `window.dshDesktop` face enables a 38 px drag strip for `hidden-inset` windows. Native `new-session` calls `uiWorkspace.startSession()`. Native `open-settings` uses a priority `-100` contribution to `settings.trigger`: its localized icon and label retain only the documented surrounding button reached from the mounted component ref. Removing the contribution restores the default trigger; the official shell retains settings visibility.

Native `open-command-menu` resolves the current `workspace.search.sessions.aria` translation and clicks only one uniquely matching enabled button. The adapter returns `false` for a missing, disabled, or ambiguous target, and native dispatch emits a diagnostic. It neither copies search state nor depends on private Desktop command attributes. Disposal removes subscriptions and the owned stylesheet, clears the trigger reference, and restores prior body attributes.

No runtime invariant installer is published: this package projects one native preference source and owns presentation effects without an independently observable relationship to assert.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Desktop composition scope](../../../apps/desktop/README.md#composition-scope) — base and full selection.
- [Web client Slots](../../../docs/subsystems/slots.md) — registration and component props.
- [Base composition decision](../../../.agents/notes/implemented/architecture/2026-09-13-opt-in-official-desktop-base.md) — official runtime ownership and verification.

<a id="model-experience"></a>
## Model Experience

None, as this package handles native window presentation, menu navigation and a close preference without assembling a model request.

#### KV Cache effect

None; this package does not select a model, assemble prompts, or send provider requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- **Complete native bridge required** — an absent or incomplete preload face leaves the plugin inactive.
- **Fixed official search adapter** — the pinned official client has no public `openSearch` method. Changes to its search label or rendered button require revalidation against the installed official UI.
- **Native acceptance remains separate** — jsdom verifies command targeting, preference ordering and cleanup; it does not establish real Electron menu behavior, titlebar geometry, installers, release readiness or cross-platform acceptance.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
