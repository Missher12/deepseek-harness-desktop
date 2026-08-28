# Desktop Browser and Computer Control Settings Design

English | [中文](2026-08-28-desktop-control-settings-design.zh.md)

## Goal

Redesign the complete **Browser & Computer Control** settings module as one compact, readable list while fixing the status model that currently labels both capabilities unavailable when only native computer status is unavailable. The module must distinguish whether a capability exists, whether the user enabled it, whether macOS granted the required permissions, and whether the latest refresh succeeded.

## Scope

- Redesign only the Browser & Computer Control settings module and its active-control capsule. Other settings sections keep their current layout.
- Keep Browser Control and Computer Control independently available and independently enabled.
- Keep every authority decision in Electron main. The renderer receives display-only state and sends closed setting intents; sessions, leases, refs, coordinates, approval tokens, and native identifiers remain private.
- Preserve native confirmation before enabling either capability, adding an allowed application, or changing the emergency shortcut.
- Target the macOS 0.4.3 release first. This change does not add or alter Windows native behavior.

## Status Model

The single aggregate `supported` field is replaced by explicit capability and refresh state:

- `browser.availability` and `computer.availability` are `available`, `unavailable`, or `unknown`. An installed production adapter plus a valid supported status is available; an absent or explicitly unsupported adapter is unavailable; a first status read that fails is unknown rather than unavailable.
- `browser.enabled` and `computer.enabled` report persisted user policy. Disabled but supported is displayed as **Available · Not enabled**, never **Unavailable**.
- `permissions.screenViewing` and `permissions.assistiveControl` remain independent macOS states: `granted`, `denied`, or `unknown`.
- `refresh.status` and `refresh.apps` independently use the closed union `ready | checking | { failed, message }`. A failed branch includes a bounded generic message and a Retry intent; it never exposes native errors, paths, sessions, or page content.

Computer status and application enumeration settle independently. A list failure keeps the latest valid application list and does not change Computer Control availability or permissions. A status failure keeps the latest valid native status for the lifetime of the authority, marks only `refresh.status` as failed, and offers Retry. If there is no valid prior status, Computer Control alone is unknown with unknown permissions. Browser Control remains governed by its own adapter state.

The Electron-main authority builds a frozen, strictly validated snapshot. The preload and client validators reject unknown fields, custom prototypes, coercible values, and authority-bearing extensions.

## Module Layout

The approved compact-list presentation contains these regions in order:

1. **Header** — title, one-line explanation, and a summary such as **2 capabilities available**. A refresh failure adds a small inline Retry action without replacing valid capability state.
2. **Capabilities** — one row for Browser Control and one for Computer Control. Each row contains an icon, name, concise description, availability text, enablement text, and switch. The switch is disabled only when that specific capability is unsupported, a mutation is pending, or stopping makes expansion unsafe.
3. **macOS permissions** — two compact status rows for Screen Viewing and Assistive Control. Permission guidance appears only for denied or unknown states and explains that Harness never changes OS permissions automatically.
4. **Authorized applications** — the current ordinary-application allowlist. Empty, failed-refresh, and populated states remain visually distinct. Application changes continue to require native confirmation.
5. **Emergency Stop** — the configured shortcut and its edit control. The Stop behavior remains approval-free and available whenever control is active or cleanup is pending.
6. **Current control** — idle state when nothing is active; otherwise agent, application, current action, and a prominent Stop button. The existing global capsule remains a compact projection of the same authoritative state.

Rows use the existing Desktop color, typography, border, and focus tokens. Status meaning is communicated by text and icon as well as color. On narrow widths, row metadata and controls wrap beneath the label without horizontal scrolling. Keyboard focus follows the visual order; switches and buttons retain visible focus and descriptive accessible names.

## Data Flow and Mutations

`ComputerControlUiAuthority` reads three independent sources: coordinator adapter availability, native computer status, and native application enumeration. It caches only the latest validated display snapshot in memory; settings remain owned by `ControlSettingsStore`.

The preload bridge keeps its existing zero-authority shape. Renderer bridge operations remain the closed set for browser enablement, computer enablement, application allowlisting, emergency shortcut, Stop, and Retry. Retry triggers a fresh main-owned status/list read and carries no target or session data.

Each setting mutation is serialized. The UI shows only the affected control as pending, ignores duplicate submission, and replaces its state with the authoritative snapshot returned by main. A rejected confirmation or failed write restores the prior value and shows a bounded inline error; it does not optimistically persist.

## Authorization Diagnostics

Computer Control uses three independent decisions: macOS permission, the persisted Computer Control switch and application allowlist, and a short-lived Electron-native task lease. The ordinary Harness `ask` or `never` tool-approval policy never grants, suppresses, or persists that Desktop lease. The settings module states this distinction beside the application list.

The wire error roster carries safe reasons for `CONTROL_DISABLED`, `TARGET_NOT_AUTHORIZED`, and `APPROVAL_DENIED`. Electron emits them only at the decision it owns: before native approval when the Computer Control switch is off or no requested application remains in the allowlist, and after the native challenge is cancelled. `PERMISSION_DENIED` remains the operating-system permission result; `POLICY_DENIED` remains reserved for a sensitive or otherwise protected target. The tool maps each code to bounded corrective guidance and never exposes raw helper text, application identifiers, window titles, or approval material.

When Computer Control is available and enabled but no application is allowed, the application section displays a prominent **Select at least one application** state. Enumerating an application does not authorize it. Selecting an application still requires the existing main-owned settings confirmation; the next task-scoped operation then opens the separate **Allow Desktop control?** challenge. Application allowlisting persists, while the task lease expires on turn completion, Stop, session or lifecycle teardown, five minutes idle, or twenty minutes total.

## Failure Behavior

- Provider absence or an explicitly unsupported adapter marks only that capability unavailable.
- Disabled Computer Control, an empty effective application allowlist, native approval cancellation, missing operating-system permission, and a protected target produce distinct safe diagnostics.
- A status timeout, enumeration failure, malformed response, or rejected IPC snapshot fails closed and produces a retryable display error without discarding unrelated valid state.
- Stop remains idempotent. While cleanup is pending, enablement and allowlist expansion stay disabled; a cleanup failure keeps the Stop surface visible with a retryable error.
- No renderer or model-visible message may include raw helper stderr, window titles, page text, absolute paths, lease identifiers, refs, or approval material.

## Verification

- Type and validator tests reject the old aggregate shape and every unknown, prototype-bearing, coercible, or authority-bearing field.
- Authority tests prove Browser Control support does not depend on native Computer status, and that supported-but-disabled renders as available and not enabled.
- Failure tests independently cover status failure, list failure, retained last-valid state, first-load failure, Retry, mutation rejection, and Stop cleanup failure.
- Component tests cover the full compact module, all capability combinations, permission states, empty and populated applications, pending mutations, active control, Stop, narrow layout, keyboard operation, and visible non-color status text.
- Protocol, coordinator, provider, and tool tests prove the three safe authorization errors survive the owned IPC path, an empty allowlist never opens the native challenge, an allowed application does open it, and ordinary Harness `ask` or `never` policy is not consulted.
- A focused macOS acceptance starts with no allowed application, observes the corrective message without a native challenge, allows Chrome in the settings module, approves the next task challenge, and completes `computer_snapshot`, `computer_focus`, and one harmless `computer_click` against fresh snapshot state.
- A packaged macOS smoke starts with an isolated settings home and proves both installed adapters report available while both default switches report not enabled. The installed app then enables each capability through native confirmation and refreshes without showing the aggregate unavailable state.
- Existing coordinator, preload, menu/tray Stop, helper, Browser Control, Computer Control, settings persistence, and translation-pairing suites remain green.
