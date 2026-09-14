# Agent Note: Opt-in Desktop base over an independently built official runtime

Status: implemented

English | [中文](2026-09-13-opt-in-official-desktop-base.zh.md)

## Problem

Desktop enhancements and an official Harness runtime can share a version string while carrying different source, packages and client behavior. Disabling visible enhancement rows does not establish official runtime provenance or remove their executable dependencies. A base candidate also needs an explicit selection rule so it cannot silently replace an existing Desktop composition or migrate user data.

## Decision

The [composition resolver](../../../../apps/desktop/src/harness/composition.ts) selects `base` only when an installed `desktop-composition.json` declares the supported schema, kind, official source and Harness version. Absence selects `full`; malformed, incompatible or missing base inputs fail startup. The base uses a separate `desktop-base` profile initialized from the official `web` template when absent. Existing profiles and product data receive no automatic migration.

The official input is pinned to source `fb2c4b9e698e30edb738bca4cf0618587db7d203` and Harness `0.1.5-rc.2`. The S2 isolated build receipt records a clean source tree and 275 package tarballs; a separately installed runtime supplies the base input. The [runtime inventory](../../../../scripts/desktop-base-runtime.ts) records physical file sizes, SHA-256 values and internal symlink targets. Source provenance is established by the isolated build owner; a hash inventory alone does not authenticate the source.

The [base stager](../../../../scripts/stage-desktop-base.ts) verifies the complete input inventory, copies it into a new stage and verifies the copy before adding shell-owned code. It refuses an existing output directory. The [base patch](../../../../apps/desktop/base.cordis.patch.yml) adds only the native-shell and System Update clients; the complete official Web dependency graph remains available. These adapters are separately identified additions, not modifications to official package bytes.

The stage writes `official-runtime/desktop-native.json` to declare resolution dependencies for the two adapters. The [native main](../../../../apps/desktop/src/main.ts) resolves `dsh-app-boot` from the installed official runtime and calls its `healProfilesModuleFallback` with that manifest as the install anchor. This uses the official resolution API without importing the full composition's cached helper or altering an official package manifest. The native main also consumes exact official copies of the atomic-write and home-path utilities.

The [native-shell client](../../../../packages/client/ui-desktop-shell/README.md) contributes window presentation, bounded menu adapters and only `closeBehavior`; the separate [System Update client](../../../../packages/client/ui-settings-system-update/README.md) retains native update operations. Official Cordis `Context`, Slots, locale and `InjectFace` types define client integration. Desktop pricing, statistics, personalization, model-policy and workbench enhancements remain outside `base`.

## Alternatives considered

**Hide enhancements in the forked Web client.** Rejected because visibility does not prove official executable provenance. The independent runtime makes source identity and added native code separately reviewable.

**Prune official UI packages to obtain a smaller shell.** Rejected because official feature dependencies can require those packages before the client becomes ready. Base retains the official Web graph and confines customization to two additive clients.

**Select base by default or reinterpret existing profiles.** Rejected because either changes an installed composition without explicit selection. Descriptor opt-in preserves `full` and keeps existing profile/data migration outside S2.

## Consequences

Official source, runtime inventory and shell additions have separate owners and receipts. Inventory verification rejects missing, changed, added or escaping runtime files before assembly. The installed resolver validates descriptor identity, version and path containment; it does not rehash the full runtime at every launch. Rebuilding the official input or changing an adapter requires fresh assembly evidence.

S2 provides the opt-in base implementation and focused checks for descriptor selection, runtime integrity, staging, native-client behavior and disposal. These checks do not establish installers, publication, or Mac/Windows/Linux native acceptance. A real menu target and window geometry still require the assembled official client running inside Electron; an installer or release conclusion requires its own bound artifact and native evidence.

The [platform-specific update decision](2026-09-09-platform-specific-desktop-updates.md) and [startup readiness decision](2026-08-18-overlapped-desktop-startup.md) retain their independent ownership and verification requirements. This optional composition does not supersede their lifecycle or installation guarantees.
