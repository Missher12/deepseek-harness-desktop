# Reference-Style Plugin Market Design

English | [中文](2026-08-20-reference-plugin-market-design.zh.md)

## Status and confirmed decisions

The provided plugin screenshot is the approved visual reference for the internal Intel macOS application. The Plugin Market content is redesigned around the same hierarchy: title and subtitle, a full-width search field, an installed-plugin icon rail, Public and Personal modes, a compact filter control, and borderless two-column plugin rows grouped under named sections.

Search and categories must operate on the real marketplace registry. Personal means plugins authored or developed locally by the user, not every installed public plugin. Existing install, update, enable/disable, activity, theme, backup, and recovery behavior remains available. This work is internal only: no GitHub publication or Windows release is included.

## Goal

Replace the dense tab-and-card marketplace with a calm, scan-friendly catalog that matches the reference layout while preserving Harness's real plugin lifecycle. The default surface should answer three questions immediately: what is installed, what public plugins are worth exploring, and which locally developed plugins belong to the user.

## Existing constraints

- The live registry snapshot observed on 2026-08-20 contains 1,650 plugins across 20 localized categories; counts remain registry-owned and may change after refresh.
- Registry entries provide name, owner, URL, optional npm spec, category, localized description, stars, added date, and optional screenshots; they do not provide a dedicated icon field.
- The active profile exposes installed package names and specs. Local development installs use `file:` or `link:` specs.
- The current market also owns updates, activity logs, themes, grouping, enable/disable, uninstall, backup, and recovery workflows. A visual redesign must not remove those capabilities.
- The current Settings content width is too narrow for the reference's readable two-column layout.

## Approaches considered

### Full reference structure inside an adaptive Settings surface

The Plugin Market widens the Settings dialog on desktop, adopts the reference hierarchy, groups real registry data into sections, and moves maintenance functions behind the installed-area gear menu. Narrow windows fall back to one column. This is the selected approach because it is visually faithful without introducing a second navigation system.

### CSS-only restyle of the current tabs and cards

This is smaller but preserves the dense tabs, category rail, bordered cards, and narrow content area. It cannot reproduce the supplied hierarchy and is rejected.

### Separate full-page marketplace

A full-page route would offer maximum space but would duplicate Settings navigation and change how users reach plugin management. That architectural expansion is unnecessary for the requested redesign and is rejected.

## Information architecture

The market content renders in this order:

1. `Plugins` title and localized subtitle.
2. One full-width rounded search field.
3. `Installed` heading with a gear action and a horizontally scrollable icon rail.
4. `Public` and `Personal` segmented tabs with a filter action on the trailing edge.
5. A vertically scrolling list of catalog sections.

The old top-level Discover, Installed, Updates, Activity, Themes, and Backup tabs disappear from the primary surface. The gear action opens a management menu or panel containing Installed management, Updates, Activity, Themes, and Backup and recovery. These destinations continue to render the existing functional views.

## Public catalog sections

`Featured` is a derived section containing the highest-starred, non-deprecated public plugins after active search and filter constraints. Remaining sections follow the registry's stable category order and use its localized category names.

In the default catalog, each section renders up to six entries in a two-column, three-row grid. A compact footer previews up to three plugin icons and reports how many additional entries exist. Activating it opens a focused category view using the same row component and bounded pagination. A plugin is not duplicated from `Featured` into its ordinary category in the same overview.

At widths that cannot sustain two readable columns, section grids become one column. When the market is selected, the desktop Settings dialog uses `min(1040px, calc(100vw - 48px))`; other Settings sections keep their current geometry.

## Real search and filtering

The search field filters the actual registry in memory across plugin name, owner, and the active localized description. Matching is case-insensitive and trimmed. Search results retain section grouping, hide empty sections, and update without a network round trip. `useDeferredValue` or an equivalent bounded render path keeps input responsive over the full registry.

The filter control retains the existing real sort and time filters: stars or added date, ascending or descending direction, and publication window. Filtering and search compose before section grouping. Search does not fabricate featured entries, categories, counts, or fallback plugins. With no matches, one localized empty state replaces the section list.

## Installed rail and plugin rows

The installed rail is derived from the active profile's real installed map. Public installed packages use their matching registry identity and owner image where available. Local or unlisted packages use the existing deterministic color-and-initial fallback. The rail is bounded and horizontally scrollable; selecting an icon opens its detail or installed-management view.

Catalog rows are borderless and compact: a 40-pixel icon, one flexible copy column, and one trailing action. The copy column contains a single-line name and a single-line localized description. A public plugin that is not installed shows the existing real Install action in an outlined pill. Installed entries show an overflow menu. Pending operations replace the action with compact progress without moving the row hierarchy.

## Personal plugins

Personal contains installed plugin dependencies whose specs start with `file:` or `link:`. This is the existing durable signal for a locally authored or linked development plugin. Public registry packages, ordinary npm dependencies, GitHub installs, and merely unlisted packages are not silently labeled personal.

The first delivery lists and manages those local plugins through the same row component and existing installed operations. It does not create a visual plugin source editor or infer authorship from repository ownership. When there are no local plugins, the tab shows a localized explanation instead of fake examples.

## Loading and failure states

The first registry read renders a stable structural skeleton matching the title, installed rail, tabs, section headings, and two-column rows. Cached data may paint immediately and refresh in the background. A failed registry refresh preserves any cached catalog and shows a compact retry state; without cache, the section area shows a localized failure state. Install and maintenance failures continue to use the existing safe dialogs, progress, cancellation, rollback, and log-export behavior.

## Implementation boundary

The Desktop-only `dshmarket@1.10.1` patch remains the integration boundary. Pure grouping and personal-classification helpers live beside the existing market-data helpers and receive unit coverage. `MarketSection` owns composition and state, while a focused section renderer and row component prevent the already-large component from accumulating more duplicated JSX. The generated market client artifact, source patch, pnpm patch hash, staging checks, and packaged smoke expectations remain synchronized.

No new credential access, raw filesystem bridge, public registry mutation, or automatic plugin publishing is introduced. The existing same-origin market routes remain authoritative for real operations.

## Verification

Tests cover:

- real search over name, owner, and localized description;
- Featured derivation, stable category order, no overview duplicates, six-item limits, and remainder counts;
- `file:` and `link:` personal classification without misclassifying public or ordinary installed plugins;
- installed rail identity and fallback behavior;
- public/personal switching, gear destinations, filter composition, empty states, and install/overflow actions;
- readable two-column desktop geometry and single-column narrow fallback;
- no horizontal overflow and stable loading skeleton dimensions;
- synchronization of patched source and built client artifacts;
- an isolated packaged Intel macOS smoke with a screenshot of the redesigned market.

The final application is installed only after focused unit and browser tests, type checking, linting, desktop packaging, packaged smoke, exact installed-bundle comparison, and launch verification pass.

## Acceptance criteria

1. The market matches the supplied hierarchy and visual density rather than the previous tab-and-card layout.
2. Search visibly filters real registry entries across all required fields.
3. Public plugins are grouped into real localized sections with Featured first and bounded two-column previews.
4. Personal shows only locally developed `file:` or `link:` plugins.
5. Installed icons, Install buttons, overflow menus, filtering, and maintenance destinations operate on real state.
6. Existing update, activity, theme, group, backup, recovery, and safety behavior remains reachable.
7. The Intel x86_64 application is backed up, installed to `/Applications/DeepSeek Harness.app`, launched, and verified without changing user data under `~/.dsh`.

## Out of scope

A visual plugin code editor, automatic plugin generation, publishing personal plugins to a registry, private cloud registries, authorship inference, Windows packaging, GitHub publication, and public release artifacts are outside this change.
