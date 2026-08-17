# Plugin Marketplace Presentation Plugin Design

English | [中文](2026-08-17-plugin-market-presentation-design.zh.md)

**Date:** 2026-08-17

**Status:** Proposed

**Target:** Independently replaceable build of `dshmarket@1.10.1`; this delivery targets Intel macOS Desktop only

## Goal

The plugin marketplace uses a compact store list suited to an 800-pixel Settings window and an approximately 564-pixel content area. The existing `dshmarket` Host remains responsible for installation, update, enablement, disablement, removal, diagnostics, backup, rollback on failure, and source warnings.

This design does not override the existing marketplace through runtime CSS, DOM queries, or hashed class names. `dshmarket@1.10.1` exposes neither a stable appearance API nor child slots, and a second plugin cannot wrap its `settings.section` under the same `market` id. The artifact therefore uses a traceable replacement build of `dshmarket`, changes only Client presentation code, and retains exactly one marketplace Loader and one Settings-page registration.

## Package and Upgrade Responsibilities

- The replacement build pins the `dshmarket@1.10.1` npm tarball with integrity `sha512-8AWM8RT2tttJsozTBm6mAfI+cNpCIbeBdP9IoydJdHlH/+x72aNqmv3AWdbNfKDDwkkqM2Ce/XRDhha9HG0Q5Q==` and upstream commit `6970a6f801108c04234eb953ff0f707feffa621a`, and preserves its license, third-party notices, package-name compatibility requirements, and upstream link.
- Desktop composition changes only the marketplace-plugin source to the replacement build; Harness core packages, Electron preload, and the `desktopProfiles` and `desktopPnpm` services do not change.
- Host routes, request fields, catalog validation, the package-operation lock, rollback, hot-mount decisions, and security confirmations accept no presentation-layer changes.
- Each upstream update reapplies the isolated Client patch and runs Host behavior-equivalence tests. If the patch cannot apply cleanly, Desktop retains the verified version and does not download or inject a patch at startup.
- Desktop preserves the dependency key, Loader id, Settings id, and active-market self-protection expected by `dshmarket`; the replacement and original cannot mount together. The pinned Host patch rejects update, disablement, and removal when the target package is `dshmarket`, while every other package operation retains the upstream behavior.

## Information Architecture

Settings navigation retains one Plugin Marketplace entry. The top of the content area presents the title, refresh action, `Discover / Installed / Updates / Activity` segmented tabs, search field, filter entry, and a single horizontally scrollable row of high-frequency categories in that order.

The plugin catalog uses a list instead of a two-column card grid. Each row contains a 40-pixel icon, name, author and version, a description of at most two lines, a small number of tags, status, and one primary action. Install, update, or re-enable is the only primary button; source, details, copy package name, and low-frequency actions move into the overflow menu.

Installed state, update count, catalog source and membership state, and failure state use text and icons together rather than color alone. Catalog membership identifies which configured live, cache, or snapshot catalog supplied an entry; it does not claim a package signature, verified publisher identity, or security endorsement. Search results, empty state, offline snapshot, load failure, and operations in progress occupy stable regions so the toolbar and list do not jump.

## Visuals and Interaction

- The UI uses Harness `--dsw-alias-*` theme variables and official UI primitives without creating an independent color system.
- The toolbar remains visible while the catalog scrolls; categories scroll horizontally, and the filter panel contains low-frequency categories.
- Segmented tabs use `tablist`, `tab`, and `aria-selected`; search, filter, overflow menus, and repeated action buttons include the plugin name in their accessible names.
- Keyboard order follows title actions, tabs, search, filter, categories, list items, and primary actions; focus never enters a hidden tab panel or closed menu.
- `prefers-reduced-motion` disables decorative animation. At 200% zoom and in narrow windows, the interface uses a single-column list without horizontal page scrolling.

## Security and Failure

The presentation plugin adds no free-form field for package specifications, commands, paths, registries, or executables. The Host continues to resolve catalog membership and command targets again, and pnpm continues to block unapproved build scripts by default.

Installation confirmation continues to show the source, version, third-party-code warning, and build-script state. Operation failures preserve the existing bounded log, cancellation, rollback, and retry semantics. The plugin UI must not read or display credentials, session content, workspace content, or Electron user data.

The replacement build never mounts alongside the original marketplace. Duplicate Loader, Host route, or Settings-page ids may throw before the marketplace Client can render, so composition preflight and a temporary staged-profile startup test reject those conflicts before enablement; if either protection is bypassed, the Harness boot diagnostic is the only reliable error surface. A successfully mounted marketplace can display later Host and Client version mismatches or missing Desktop services and refuses to change package state; Harness session and model functions remain available.

## Verification and Acceptance

- Upstream marketplace business tests continue to cover search, filtering, pagination, installation, update, enablement, disablement, removal, diagnostics, backup, restore, confirmation, and rollback on failure.
- New component tests cover list information hierarchy, a single primary action, the overflow menu, status text, empty state, offline snapshot, load failure, and the operation lock.
- Browser acceptance uses a real 800-pixel Settings window and an approximately 564-pixel content area, covering light and dark themes, long English labels, 320-pixel reflow, 200% zoom, keyboard focus, and reduced motion.
- Assembly and preflight tests prove that Desktop mounts exactly one marketplace plugin, ordinary Web composition does not mount the Desktop marketplace, collisions fail before package mutation, self-update, self-disablement, and self-removal remain blocked, and every other Host route and package-runner operation retains its upstream authority.
- Mac staged-artifact and packaged-smoke tests verify the replacement marketplace's Host, Client, Desktop adapter, pnpm entry, third-party notices, random port, and exit cleanup; this delivery does not modify or publish Windows artifacts.

## Out of Scope

Rewriting the catalog service, allowing installation from arbitrary GitHub repositories, publisher accounts, ratings and reviews, a CDN, telemetry, Electron permissions, Harness core Settings slots, Windows packaging, and automatic upstream-marketplace upgrades are outside this design.
