# Agent Note: Contained desktop extension controls at narrow widths

Status: implemented

English | [中文](2026-08-18-contained-desktop-extension-controls.zh.md)

## Problem

The optional character thumb and the ordinary circular reasoning thumb share one progress coordinate, but the ordinary 28-pixel thumb previously placed its center at the track's zero and one-hundred-percent endpoints. Turning the character off therefore let half of the circular thumb leave the track. The embedded Plugin Market had a related containment error: category pills could shrink and wrap, while plugin rows responded to the browser viewport instead of the 564-pixel Settings content container.

The reasoning Client build also relied on a copied sprite reaching `lib/assets` before a parallel bundle resolved the emitted JavaScript import. The copy and bundle had no ordering relation, so a clean whole-repository build could fail even though the attributed source asset existed.

## Decision

[`dsh-reasoning-effort`](../../../../packages/extensions/reasoning-effort/README.md) clamps the ordinary thumb center between its 14-pixel radius and the track width minus that radius. The optional character keeps its separate smaller endpoint allowance, and turning it off changes only the thumb presentation.

The pinned `dshmarket@1.10.1` source patch makes the market root an inline-size query container. Category pills never shrink or wrap and remain reachable through horizontal scrolling; the search field fills the toolbar. At 620 pixels or narrower, plugin actions occupy a second grid row and metadata may wrap, independent of the outer browser viewport.

The reasoning package's build config resolves the exact emitted sprite import to the package's attributed source asset. The package still copies that asset into `lib/assets` for distribution and notice verification, but Client bundling does not depend on the copy finishing first.

## Verification

Package-shape tests pin both thumb endpoint math and source-asset resolution. Market layout tests pin the container query, non-shrinking one-line categories, full-width search, and action reflow; artifact tests require the patched source, generated bundle, source map, integrity, and Host protection to remain coherent.

The Intel macOS packaged application is also exercised at the real 564-pixel Settings width. Its ordinary Max thumb remains within the track, all category pills retain `flex-shrink: 0` and `white-space: nowrap`, the category strip overflows horizontally, and the primary action begins below the plugin copy. An initially observed full-smoke failure was not an acknowledgement write: the preserved failed artifact contained only the selected Session's delayed `permission/preset`, `sandbox/mode`, and `approval/policy` restoration records. The fixture now seeds those current policy records before its final `session/end-seed`, and the smoke waits for protected files to settle both before and after copy and acknowledgement actions. Three consecutive packaged runs then passed with every Session log, workspace record, and messenger receipt file byte-identical across those actions.

## Alternatives considered

**Clip the thumb or category contents.** Clipping would hide the symptom while reducing the thumb silhouette or making categories unreachable. Reserving the thumb radius and retaining scrollable pills preserves the complete controls.

**Keep a viewport media query.** The Desktop window can be wide while Settings gives the market a narrow nested column, so viewport width cannot represent the layout constraint that causes the crowding.

**Order the sprite copy before every Client bundle.** A repository-wide build-order dependency is broader than this package needs and remains easy to break. Resolving the exact attributed asset from source removes the race while retaining the shipped copy.

## Consequences

The ordinary thumb leaves only its radius-sized travel allowance at both endpoints, category navigation may require horizontal scrolling, and narrow plugin cards use one extra row for their action. No effort value, character preference, market operation, protected-package rule, or plugin catalog feature changes. The additional exact asset resolver makes clean parallel builds deterministic without changing the distributed sprite or its attribution.
