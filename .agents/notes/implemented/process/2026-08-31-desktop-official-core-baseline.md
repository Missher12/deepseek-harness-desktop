# Agent Note: Desktop integrates official core from a recorded baseline

Status: implemented

English | [中文](2026-08-31-desktop-official-core-baseline.zh.md)

## Problem

The Desktop repository and the official Harness repository have unrelated Git histories even though the Desktop tree embeds official Harness source. A direct merge treats the complete official tree as unrelated content, while a diff from an arbitrary old commit reports thousands of conflicts that do not describe the embedded source. Either path can silently discard Desktop control, packaging, or client behavior while appearing to complete an upstream update.

## Decision

Each Desktop core update identifies the exact official commit already embedded in the Desktop source and the exact official target commit. The integrator computes one three-way source delta between those official commits and applies it to the Desktop release branch, then resolves only the conflicts against the current package owners. The release context records both official identities and the resulting Desktop source commit so a later update never guesses its ancestor.

Official package moves are authoritative. Desktop-owned behavior follows the new package owner instead of retaining deleted compatibility packages: Session operations live under the Session Controller, workspace archive and restore live under the Workspace Controller, settings documents live under the Settings Controller, and Client contributions use the current Slot registry and Remote services. Desktop-only Browser Control, Computer Use, installers, managed extensions, layout behavior, and privilege restrictions remain explicit additions on top of that source.

Desktop Client replacements also mirror the transitive runtime injections required by their official owners. A replacement that uses the shared model directory, for example, declares both `remote` and `remote.session`; otherwise Cordis correctly leaves that entry inactive and the Slot registry elects a lower-priority fallback.

One Desktop source commit owns every platform build for a release. macOS qualification produces that commit first; the Windows task consumes the same commit and version rather than rebuilding from an independently resolved source tree. Package installation, generated paths, dependency policy, Host and Client aggregate type checks, focused behavior tests, documentation checks, and packaged application smoke tests run locally with the lockfile in offline mode before a tag is published.

## Testing

Conflict-marker and unmerged-index checks reject an incomplete integration. Generated path, dependency, package-invariant, Cordis, configuration, documentation, and translation checks reject stale projections. Aggregate Host and Client builds prove that deleted package owners have no surviving imports, while Desktop tests and packaged smokes exercise the preserved native control, installer paths, and activated Client replacement seats. Platform workflows build from the tagged source commit and publish platform-specific assets under the same Desktop release.

## Alternatives considered

**Merge the official branch directly.** Git cannot infer the shared source lineage from unrelated repository histories, so the merge presents unrelated files as additions and conflicts. It was rejected because conflict volume ceases to identify semantic overlap and makes accidental feature loss difficult to review.

**Replace the Desktop tree with the official target and re-copy selected Desktop directories.** This produces a smaller initial conflict list, but the selection itself becomes an undocumented allowlist. It was rejected because cross-package extensions, tests, generated catalogs, package references, and security restrictions can be omitted without a conflict.

**Maintain separate macOS and Windows integration branches.** This lets each platform resolve native code independently. It was rejected because platform assets could then share a version while containing different Harness core and Client behavior; only native qualification differs, not the source release identity.

## Consequences

An official update requires an exact embedded baseline and deliberate migration of every Desktop addition whose owner moved. This costs more review than copying the official tree, but the conflict set remains meaningful and every platform release is traceable to one source commit. Offline-first verification limits dependency traffic and prevents a release from depending on an unrecorded network resolution.
