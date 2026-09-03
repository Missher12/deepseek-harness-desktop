# DeepSeek Harness 0.3.2 Codex-style Add Menu

English | [中文](2026-08-21-macos-codex-add-menu-design.zh.md)

## Goal

Replace the composer's plain `+` command list with the compact Codex-style “Add” menu approved on 2026-08-21. Keep all existing command, skill, attachment, keyboard, and accessibility behavior intact; only the launcher organization and presentation change.

The shared Web composer receives the feature, but this task builds, installs, and publishes only the Intel macOS Desktop 0.3.2 artifact.

## User-visible structure

The menu is a compact white popover anchored above the composer `+` button.

1. **Add**
   - **Files and folders**: opens the existing `@` reference candidate flow and inserts the selected file or folder reference.
   - **Add image**: opens a native browser file chooser restricted to the image formats already accepted by the composer; selected images use the existing validation, preview, removal, and submission path.
   - **Goal**: enters the existing `/goal` flow so the user can describe the persistent goal.
   - **Plan mode**: invokes the existing `/plan` behavior.
2. **Plugins**
   - Dynamically lists only skills or commands that the current session can actually invoke.
   - Each row shows an icon, name, and one-line description. Long descriptions truncate instead of widening the popover.
   - The list scrolls inside the existing height cap when more entries are available.

Marketplace-only UI plugins are not listed as callable actions. Showing a plugin that cannot be invoked from chat would create a dead control.

## Interaction and data flow

- The `+` button opens a dedicated multi-source launcher through the existing session-owned input-trigger controller.
- Fixed Add actions and the installed-skill source appear in one menu state, so keyboard highlight, `ArrowUp`/`ArrowDown`, `Enter`, `Escape`, outside-click dismissal, and textarea focus retention remain on the current pipeline.
- Files/folders hand off to the existing reference source rather than introducing a second file browser.
- Image choice hands selected `File` objects to the existing `intakeImages` path. Format, count, per-file size, and total-size errors therefore keep the current localized toast behavior.
- Goal and Plan reuse existing commands; the menu does not create parallel goal or plan state.
- Skill discovery reuses the current session skill catalog and remains capability-filtered for subagents and agent presets.

## Presentation

- Compact popover matching the approved reference: 12px section labels, 32px rows, restrained 7px row radius, subtle border/shadow, and the current Harness theme tokens.
- Selected/hovered rows use the existing neutral interactive fill; no gradients, particle effects, or oversized cards.
- Primary and secondary copy stay on one line, with the description dimmed.
- Light and dark themes remain token-driven. The menu must not hard-code a permanently white surface outside the light theme.
- Existing generic typed `/` and `@` suggestion menus keep their current behavior; the Codex-style organization applies to the programmatic `+` launcher.

## Failure handling

- If one dynamic source fails, its group shows the existing loading/failure-safe state without blocking fixed Add actions.
- Missing attachment or reference capabilities hide or disable the corresponding action rather than presenting a dead row.
- File-picker cancellation is a no-op.
- A command or skill invalidated between display and click follows the current stale-pick no-op behavior.

## Acceptance

- Clicking `+` renders the approved Add/Plugins hierarchy.
- Files/folders opens the existing reference selection and inserts a valid reference.
- Add image accepts a valid image, shows the existing preview, and rejects unsupported files through existing copy.
- Goal and Plan reach their current real command flows.
- Installed callable skills are visible and selectable; non-callable marketplace pages are not misrepresented.
- Mouse and keyboard selection both work, textarea focus is preserved, and the menu closes on `Escape` or outside click.
- Existing typed `/` and `@` menus, send/stop, reasoning effort, session messaging, marketplace, usage, workbench, and updater behavior remain unchanged.
- Focused unit tests, relevant Web/Desktop suites, and the packaged Intel macOS smoke pass before publishing 0.3.2.
