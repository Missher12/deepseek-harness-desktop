# Intel Mac two-stage boot progress design

English | [中文](2026-08-20-macos-two-stage-boot-progress-design.zh.md)

## Goal

Make startup progress unmistakable without presenting invented percentages. Use the approved Codex-like minimal direction with the official DeepSeek whale icon, and keep the change isolated to the Intel Mac desktop surface.

## Scope

The startup experience has two truthful phases:

1. The kernel-local Electron page shows an indeterminate four-pixel bar while the native shell checks ownership and starts the local Harness runtime.
2. The web boot page switches to a determinate four-pixel bar after the Harness URL is available. It derives its percentage from active client entries divided by the complete boot roster.

The ordinary browser surface and non-macOS desktop surfaces retain their current boot presentation.

## Visual design

- Use the official rounded DeepSeek whale icon, centered above a compact `DeepSeek Harness` wordmark.
- Replace the existing grid, scan line, corner ornaments, rail, and abstract mark with one restrained radial blue glow on a near-black field.
- Use a five-pixel, maximum 300-pixel track with a monotonic blue-to-cyan fill and low-intensity glow.
- Place one quiet human-readable subtitle above the track. The local phase reads `正在准备你的工作区`; it does not display a numeric percentage.
- The plugin phase shows the current activity at the leading edge and the derived percentage at the trailing edge. Accessible text retains `正在加载组件 {active}/{total}` even when the visible copy is shorter.
- Keep the application title bar and surrounding native window visually unchanged.
- At 100%, retain the completed bar only until the application renderer replaces the boot surface. Do not add an artificial delay.

## Components and data flow

### Local startup page

`apps/desktop/renderer/loading-macos.html` remains self-contained and network-free. It uses the packaged local icon asset, and its progress bar is explicitly indeterminate through ARIA and animation. No timer-generated percentage is allowed.

### Client boot page

`packages/client/web/src/boot-page.ts` already owns the boot roster and active-entry set. It will expose a macOS desktop-only linear progress element and update:

- `aria-valuemin=0`, `aria-valuemax=100`, and the current `aria-valuenow`;
- fill width as a clamped integer percentage;
- active and total counts in the visible status text.

The existing circular progress presentation remains unchanged for other surfaces. Platform selection is derived from the existing `surface=desktop` query and the macOS user agent; it does not add IPC or a new native permission. The Mac-only web presentation mirrors the centered local page so the navigation between phases does not visibly change visual language.

## Failure and edge cases

- Zero boot entries render 0% without division errors.
- Active entries can only increase the displayed percentage; duplicate state notifications do not over-count.
- Plugin failure replaces the progress presentation with the existing failure report.
- Reduced-motion mode removes sweeping motion while preserving the visible track and determinate width.
- Narrow windows keep status, percentage, and track within a 320-pixel viewport.

## Testing

Implementation follows red-green-refactor:

1. Extend renderer-page tests to require the visible four-pixel indeterminate Mac track and status label.
2. Extend `BootPage` tests to require the macOS desktop linear progress semantics, counts, monotonic percentage, and failure replacement.
3. Prove the new tests fail before production edits.
4. Run the focused renderer and web boot suites, the 368-test feature matrix, production build, packaged Electron smoke, and `hdiutil verify`.
5. Install the resulting Intel x64 app and verify startup visually without changing `~/.dsh`.

## Acceptance criteria

- The official whale icon, compact centered wordmark, and five-pixel progress bar are immediately visible on native Mac startup.
- The local-runtime phase never claims a fabricated percentage.
- The plugin phase reports real roster progress and reaches 100% when all entries activate.
- Existing failure visibility, CSP restrictions, reduced-motion behavior, system update, session communication, Usage Insights, reasoning controls, and Plugin Market behavior remain intact.
- The final app remains Intel x86_64 and uses a random loopback port without opening a browser.

## Non-goals

- No Windows or ordinary browser redesign.
- No new IPC channel or progress telemetry.
- No background updater behavior changes.
- No artificial startup delay solely to showcase the animation.
