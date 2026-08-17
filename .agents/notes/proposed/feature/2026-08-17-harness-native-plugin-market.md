# Agent Note: Harness-native Plugin Market presentation

Status: proposed

English | [中文](2026-08-17-harness-native-plugin-market.zh.md)

## Problem

Desktop already ships the pinned `dshmarket@1.10.1`, but its card grid uses too much horizontal and vertical space inside the settings panel. The package also allowed its own update route to replace the active manager during the process that was serving the request.

## Proposal

Keep the published package identity, Loader id, settings id, Host routes, and Desktop package runner. An audited pnpm dependency patch changes only the market presentation and the three active-manager protection branches.

- Discover is a one-column list with 40-pixel icons, two-line descriptions, one primary action, and a single overflow menu for details, source, and copy.
- Search and the horizontally scrollable category row stay in a sticky toolbar.
- Discover, Installed, Updates, and Activity are stable primary tabs. Existing Themes, grouping, backup, dialogs, and ordinary package operations remain.
- The patch uses Harness `--dsw-*` tokens and no particles or decorative canvas.

## Integrity and safety boundary

The source baseline is the published `dshmarket@1.10.1` tarball and upstream commit `6970a6f801108c04234eb953ff0f707feffa621a`. The patch contains the reviewed TypeScript/CSS sources, rebuilt Client bundle and source map, and generated Host route output. Tests compare stable semantic markers rather than generated CSS class hashes.

Requests targeting either `dshmarket` or its Loader alias `dsh-market` are rejected with `409 { ok: false, code: "self-protected" }` before filesystem, network, or package-runner work. Other packages continue through the existing runner. Ordinary browser composition remains unchanged without the Desktop patch.

## Alternatives considered

- Reimplement the market as a first-party Desktop feature: rejected because it would duplicate upstream catalog, install, grouping, theme, backup, and recovery behavior and increase update drift.
- Inject presentation-only CSS at runtime: rejected because the required tab structure, overflow actions, semantic test markers, and self-protection cannot be expressed safely as styling alone.
- Fork or vendor the whole package: rejected because a narrow pnpm patch keeps the published package identity, preserves ordinary browser composition, and makes every changed source and generated artifact auditable in one diff.

## Acceptance criteria

- A frozen-lock reinstall must recreate the exact patched dependency.
- Staging must find exactly one `dshmarket@1.10.1` and matching compact markers in source, Client bundle, and source map, plus the Host protection marker.
- Packaged smoke opens the market, switches all four primary tabs, searches, checks horizontal categories and one primary row action, rejects self-update, and exercises an ordinary package operation in an isolated temporary profile.
- Before release, native Intel macOS acceptance still captures light and dark Discover/Installed/Updates/Activity at normal and 200% zoom with no overflow or console errors.

## Risks

- A future `dshmarket` upgrade can invalidate patch hunks or semantic assumptions; upgrading requires a new upstream source lock, regenerated artifacts, and the full acceptance set.
- Catalog packages remain third-party executable code. A clearer market presentation does not replace provenance review or build-script approval.
- The generated Client bundle and source map are intentionally patched alongside source; omitting either can make development and packaged behavior diverge, so staging fails closed on marker incoherence.
