# @deepseek-ai/dsh-reasoning-effort

English | [中文](README.zh.md)

A removable Harness-native replacement for the single model-selection seat. It keeps HanaAyane's pinned Canvas reasoning-effort effect and prefers a popup below the composer. Models, real submitted values, and current selections come from the active Host `ModelDirectory`; the stable six-stop presentation scale maps safely onto each exact model capability.

## Behavior

- The priority `-100` entry shadows the native priority `0` model control only while this plugin is active.
- The popup uses a portal, prefers an eight-pixel gap below the trigger, flips above near the lower edge, and constrains itself to the visible viewport when neither side fully fits.
- Canvas streaks, pixel radiation, waves, and glow retain the upstream drawing algorithm; reduced-motion mode stops continuous animation without removing the control.
- The optional character thumb is off for absent or corrupt settings and becomes profile-persistent only after an explicit opt-in.
- With the character off, the ordinary 28-pixel thumb reserves its radius at both endpoints, so the minimum and maximum selections stay inside the track.
- Keyboard, pointer, touch, Escape focus return, outside-click close, theme switching, zoom, and live Host directory refresh remain supported.
- Addressed subagent sessions stay hidden. Every adjustable model receives the stable `Low / Medium / High / XHigh / Max / Ultra` six-stop ladder; each visual stop maps to the strongest Host-advertised effort that does not exceed it, and stops above the model limit converge on that real limit (for example, Max and Ultra both submit High on a High-only model). The slider and collapsed trigger retain the selected visual label, so choosing Ultra continues to read Ultra even when the provider receives High or Max; the separate model-limit line still reports the strongest advertised capability. Only a model with no positive reasoning capability hides the slider; an advertised Off remains reachable from the Low end.

## Installation and fallback

DeepSeek Harness Desktop mounts this workspace package from its immutable Desktop patch. A standalone profile can use the package's `cordis.patch.yml`, but it must first disable or remove the original `dsh-reasoning-effort` package: both packages compete for `conversation.input.model` and must never be enabled together. Desktop staging rejects a composition that contains both identities.

Disabling or uninstalling this package and reloading the profile releases its priority `-100` entry, so Harness elects the native priority `0` model selector again. This fallback does not rewrite model-provider configuration, session logs, or other plugin data. A render-time component crash also abdicates the replacement seat and lets the native entry return.

Module resolution, missing required services, and plugin `apply` failures occur before a React seat exists. Harness therefore refuses to activate that Web graph and reports the failed or pending entry on its loading surface instead of claiming a native-seat fallback. The Desktop stage separately refuses missing Host, Client, license, notice, or sprite artifacts before packaging.

## Compatibility and provenance

This fork targets the DeepSeek Harness `0.1.0-rc.8` workspace contract. Its `workspace:^` peers describe that verified source boundary; they do not claim compatibility with the original plugin's `rc.6` dependency set.

The retained Canvas implementation and `chibi-runner-strip.png` come from [`HanaAyane/dsh-reasoning-effort`](https://github.com/HanaAyane/dsh-reasoning-effort) `v0.6.0` at commit `f94622b46078ac8c064f91bdc10ab27e8cf32270`. The complete MIT text, `Copyright (c) 2026 HanaAyane`, source URL, commit, and sprite attribution remain in `LICENSE`, package-local `THIRD_PARTY_NOTICES.md`, and the Desktop artifact's root `THIRD_PARTY_NOTICES.md`.

## Preference and data boundary

The Host half owns one profile-scoped `chibiThumb` boolean plus at most 64 visual positions keyed by the exact session/provider/model route, and one exact loopback preference endpoint authenticated by a generation-scoped capability. The bounded map contains no prompt or response text. It exposes no generic settings access, enables no CORS, and accepts only the two narrow patch shapes it owns. This makes an Ultra visual choice survive control remounts, session switching, random Desktop ports, and application restarts while the real Host effort remains the mapped supported value. Disabling the plugin does not modify sessions or provider settings and does not promise to erase these inert local preferences; re-enabling may reuse them.

## Model Experience

### Selected reasoning effort

#### What the model sees

The plugin contributes no prompt, tool, or hidden message. The six stops are a stable presentation scale; the existing model-directory command receives only the mapped `reasoningEffort` that the exact Host model catalog actually advertises. The Host snapshots that ordinary selection at the next request boundary, and the plugin never disguises a visual label such as Ultra as a protocol value the model does not accept.

#### Token effect

None of its own: the control adds no prompt tokens. A provider may produce different reasoning or output for the selected effort, but that behavior belongs to the selected model and adapter.

#### KV Cache effect

The plugin does not rewrite conversation history, so it creates no cache-prefix change by itself. Whether changing request-level reasoning configuration reuses a provider cache is provider-specific and is not promised here.

### Invariant ownership

No invariant companion is published because reasoning strength mapping is validated by pure functions.

## Known Limitations and Deferred Work

- Compatibility is verified only against the repository's `0.1.0-rc.8` contract; a Harness upgrade requires a fresh peer, service, staged-profile, and visual review.
- The bounded profile-scoped preferences are not an uninstall scrubber; removing the plugin may leave the inert character opt-in and visual route positions for a later reinstall.
- Native-seat fallback covers a replacement component that reached the slot and then crashed. Pre-registration failures instead keep the Web graph unactivated and require the reported module, peer, service, or `apply` problem to be fixed.
