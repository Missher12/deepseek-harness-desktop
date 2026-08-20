# @deepseek-ai/dsh-reasoning-effort

English | [中文](README.zh.md)

A removable Harness-native replacement for the single model-selection seat. It keeps HanaAyane's pinned Canvas reasoning-effort effect, prefers a popup below the composer, and reads every model, effort label, submitted value, and current selection from the active Host `ModelDirectory`.

## Behavior

- The priority `-100` entry shadows the native priority `0` model control only while this plugin is active.
- The popup uses a portal, prefers an eight-pixel gap below the trigger, flips above near the lower edge, and constrains itself to the visible viewport when neither side fully fits.
- Canvas streaks, pixel radiation, waves, and glow retain the upstream drawing algorithm; reduced-motion mode stops continuous animation without removing the control.
- The optional character thumb is off for absent or corrupt settings and becomes profile-persistent only after an explicit opt-in.
- With the character off, the ordinary 28-pixel thumb reserves its radius at both endpoints, so the minimum and maximum selections stay inside the track.
- Keyboard, pointer, touch, Escape focus return, outside-click close, theme switching, zoom, and live Host directory refresh remain supported.
- Addressed subagent sessions stay hidden, and models with fewer than two Host-advertised efforts keep ordinary model selection without a meaningless slider.

## Installation and fallback

DeepSeek Harness Desktop mounts this workspace package from its immutable Desktop patch. A standalone profile can use the package's `cordis.patch.yml`, but it must first disable or remove the original `dsh-reasoning-effort` package: both packages compete for `conversation.input.model` and must never be enabled together. Desktop staging rejects a composition that contains both identities.

Disabling or uninstalling this package and reloading the profile releases its priority `-100` entry, so Harness elects the native priority `0` model selector again. This fallback does not rewrite model-provider configuration, session logs, or other plugin data. A render-time component crash also abdicates the replacement seat and lets the native entry return.

Module resolution, missing required services, and plugin `apply` failures occur before a React seat exists. Harness therefore refuses to activate that Web graph and reports the failed or pending entry on its loading surface instead of claiming a native-seat fallback. The Desktop stage separately refuses missing Host, Client, license, notice, or sprite artifacts before packaging.

## Compatibility and provenance

This fork targets the DeepSeek Harness `0.1.0-rc.8` workspace contract. Its `workspace:^` peers describe that verified source boundary; they do not claim compatibility with the original plugin's `rc.6` dependency set.

The retained Canvas implementation and `chibi-runner-strip.png` come from [`HanaAyane/dsh-reasoning-effort`](https://github.com/HanaAyane/dsh-reasoning-effort) `v0.6.0` at commit `f94622b46078ac8c064f91bdc10ab27e8cf32270`. The complete MIT text, `Copyright (c) 2026 HanaAyane`, source URL, commit, and sprite attribution remain in `LICENSE`, package-local `THIRD_PARTY_NOTICES.md`, and the Desktop artifact's root `THIRD_PARTY_NOTICES.md`.

## Preference and data boundary

The Host half owns one profile-scoped `chibiThumb` boolean and one exact loopback preference route authenticated by a generation-scoped capability. It exposes no generic settings access and enables no CORS. Disabling the plugin does not modify sessions or provider settings and does not promise to erase the harmless stored opt-in; re-enabling may reuse it.

## Model Experience

### Selected reasoning effort

#### What the model sees

The plugin contributes no prompt, tool, or hidden message. It routes the person's Host-advertised `reasoningEffort` selection through the existing model-directory command; the Host snapshots that ordinary selection at the next request boundary.

#### Token effect

None of its own: the control adds no prompt tokens. A provider may produce different reasoning or output for the selected effort, but that behavior belongs to the selected model and adapter.

#### KV Cache effect

The plugin does not rewrite conversation history, so it creates no cache-prefix change by itself. Whether changing request-level reasoning configuration reuses a provider cache is provider-specific and is not promised here.

## Known Limitations and Deferred Work

- Compatibility is verified only against the repository's `0.1.0-rc.8` contract; a Harness upgrade requires a fresh peer, service, staged-profile, and visual review.
- The profile-scoped character preference is intentionally small but is not an uninstall scrubber; removing the plugin may leave that inert boolean for a later reinstall.
- Native-seat fallback covers a replacement component that reached the slot and then crashed. Pre-registration failures instead keep the Web graph unactivated and require the reported module, peer, service, or `apply` problem to be fixed.
