# Agent Note: Adaptive reasoning-effort plugin

Status: proposed

English | [中文](2026-08-17-adaptive-reasoning-effort-plugin.zh.md)

## Problem

The Desktop application needs the richer reasoning-effort selector requested by the user without reintroducing a core UI fork that is difficult to carry across upstream Harness updates. The original community package targets a different release-candidate contract, places its popup without the Desktop's viewport guarantees, enables character art by default, and cannot safely coexist with another occupant of the same single model slot.

## Proposal

Maintain `@deepseek-ai/dsh-reasoning-effort` as one removable dual-face workspace plugin. The Client half occupies `conversation.input.model` at priority `-100`, reads the model and efforts only from `ModelDirectory`, retains the pinned upstream Canvas algorithm, prefers a down-first portal, and defaults the character thumb off. The Host half owns only the profile-scoped character preference and its capability-fenced loopback route.

Desktop adds one immutable patch row after the ordinary Web composition and depends on the package through `workspace:^`. Disabling or removing that row releases the seat to the native priority `0` selector; no core model-selection package is changed.

## Compatibility and conflict boundary

The verified boundary is Harness `0.1.0-rc.5`. The original [`HanaAyane/dsh-reasoning-effort`](https://github.com/HanaAyane/dsh-reasoning-effort) package and this fork must not be enabled together because both target the same single seat. Desktop staging parses its immutable patch before deletion or deployment and requires exactly one canonical fork row; it refuses the original identity, duplicate rows, or an omitted fork.

Required Cordis injection makes missing Host or Client services remain pending rather than partially activating. The Web boot sweep refuses settlement for a missing module, pending service, or failed `apply`. A component that registered successfully but later crashes follows the existing slot-abdication path and restores the native entry. These are separate failure paths and are documented separately.

## Packaging and attribution

The package derives from upstream `v0.6.0` commit `f94622b46078ac8c064f91bdc10ab27e8cf32270`. Its complete MIT license, author attribution, source URL, Canvas implementation, and sprite are retained. Desktop staging requires the package's Host bundle, Client bundle, `LICENSE`, package-local `THIRD_PARTY_NOTICES.md`, and built sprite. The generated root `THIRD_PARTY_NOTICES.md` records the same source, author, version, and commit so the attribution survives the Electron artifact boundary.

## Data and security boundary

Only the `chibiThumb` boolean is profile-persistent. The exact route accepts the active loopback Host and Origin plus a generation-scoped capability, enables no CORS, and does not expand generic settings access. The plugin never rewrites sessions, model-provider configuration, credentials, or Electron preload behavior.

## Verification status

Package behavior, popup placement, Host preference fencing, Canvas provenance, Desktop dependency closure, immutable-patch conflict rejection, required package artifacts, boot refusal evidence, and generated notices are automated. Real staged-Host fallback and light, dark, 200% zoom, and reduced-motion screenshots remain release acceptance; they must not be inferred from unit or build success.

## Alternatives considered

**Fork the Harness core UI.** This would make the selector inseparable from the application and increase drift on every upstream update, so the user chose a removable plugin instead.

**Install the upstream package unchanged.** The upstream package targets a different release-candidate contract, has different placement guarantees and defaults, and can conflict with the Desktop's single model slot, so the fork keeps the effect while adapting the integration boundary.

**Replace the Canvas effect.** A new effect would be easier to restyle, but the user explicitly asked for the upstream visual behavior, so the pinned algorithm and sprite remain attributed third-party source.

## Acceptance criteria

The Desktop build contains exactly one canonical fork row and all required Host, Client, license, notice, and sprite artifacts. The selector reads live model capabilities, prefers a downward popup, keeps the character thumb off by default, persists only that preference, and yields to the native selector when its registered component abdicates. Automated tests and documentation gates pass, and a temporary `DSH_HOME` staged-Host run plus light, dark, 200% zoom, and reduced-motion screenshots confirm the real application behavior before release.

## Risks

The verified boundary is a release candidate and may require adaptation when Harness changes its slot or model contracts. Missing required services intentionally stop plugin registration instead of silently degrading, while a post-registration render failure relies on the shared slot fallback. The retained Canvas code and sprite carry third-party license obligations. Real staged-Host and visual acceptance is still pending and must remain explicit until performed.
