# Agent Note: Docked Desktop Workbench Navigation

Status: implemented

English | [中文](2026-09-03-docked-desktop-workbench-navigation.zh.md)

## Problem

The Desktop Workbench already occupied the layout system's fixed, resizable utility column, but its four modes were horizontal tabs. At the 320px minimum width the tabs competed for one row, the selected mode was not restored after a renderer restart, and an imitation of reference shortcut capsules would falsely advertise global shortcuts the product does not have.

## Decision

The existing `layout.utility` surface remains the only Workbench container. Inside it, a narrow vertical launcher and a scrollable mode body form one two-column panel. The launcher order is Review, Terminal, Browser, Files; each entry has a real product icon, an ellipsized label, and a low-contrast selected fill. No portal, dialog, menu, popover, or Side Chat surface is introduced.

The launcher is an ARIA vertical tablist with manual activation. Up and Down wrap roving focus, Home and End reach the boundaries, and Enter or Space activates the focused tab. The selected tab and its tabpanel carry reciprocal `aria-controls` and `aria-labelledby` identities. Escape closes the same utility column. No shortcut capsule is rendered because no global Workbench-mode shortcut exists.

`dsh.desktop-workbench.mode.v1` stores only one member of the closed Workbench mode roster. A missing or invalid value falls back to the existing Terminal default. Restoring the preference changes neither `open` nor `sessionId`: each Session still requires an explicit open action. Selecting or explicitly opening a mode updates the preference; `dsh.desktop-workbench.width.v1` and its 320–720px clamp remain unchanged.

## Alternatives considered

**Open a mode picker popover and render content elsewhere.** Rejected because it duplicates the navigation surface and breaks the fixed-column ownership already provided by the layout service.

**Add reference-looking shortcut capsules without global handlers.** Rejected because visible shortcut claims must be backed by product behavior and tests.

**Persist the panel's open state with the mode.** Rejected because a presentation preference must not automatically open a utility surface for another or newly created Session.

## Verification

Client tests pin the vertical order, absence of duplicate overlay roles and fake shortcut markup, reciprocal tab/panel identity, roving focus, manual activation, Escape close, valid-mode restoration, invalid-mode fallback, no automatic open, width clamping, and first-open width application. CSS tests pin the bounded launcher column, ellipsis, selected token, and scrollable content body. Existing Files, Review, Terminal, Browser, HTTP, and invariant tests continue to own the mode implementations and Host boundary.

## Consequences

The recent mode is renderer-local presentation state, while the current Session and layout service remain the authority for whether the Workbench is open. The launcher intentionally has no global one-keystroke mode selection until a future change supplies real handlers and cross-platform tests.
