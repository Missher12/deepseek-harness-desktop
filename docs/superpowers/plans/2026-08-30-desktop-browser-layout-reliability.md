# Desktop Browser Layout and Reliability Implementation Plan

English | [中文](2026-08-30-desktop-browser-layout-reliability.zh.md)

## Scope

Implement the approved [design](../specs/2026-08-30-desktop-browser-layout-reliability-design.md) as one bounded desktop repair. Do not add a public-site write acceptance or widen control authority.

## Task 1: Non-overlapping shell geometry

- Update `packages/client/ui-layout/src/client/columns.ts`, `AppFrame.tsx`, stores, and CSS so utility width can grow, the rendered sidebar concedes to its rail, and no desktop utility drawer covers the conversation.
- Add RED then GREEN coverage in `packages/client/ui-layout/tests/columns.client.spec.ts` and `app-frame.client.spec.tsx` for 1336px, ordinary desktop, maximum workbench width, restoration, and both drag handles.
- Update Browser workbench geometry tests and documentation.

## Task 2: Composer and prompt clearance

- Bind prompt-rail bounds to the measured composer stack and make stats a wrapping, bounded flow row.
- Add component/layout regression tests proving tooltips and status content do not enter the composer rectangle.

## Task 3: Complex snapshot and browser lifecycle

- Replace raw-node quota failure with bounded truncation, prioritize actionable candidates, and preserve the existing wire-size cap.
- Add a large local fixture that places required textboxes/buttons after noisy nodes and proves snapshot success with useful refs.
- Keep startup, wait, back, and Browser Stop recovery bounded and add composition regressions for the shipped paths.

## Task 4: Windows installer progress

- Add privacy-safe NSIS detail messages and a source/smoke gate that proves all required stages are present.

## Task 5: Verification and delivery

- Run focused Vitest and TypeScript builds, scoped lint, package/document gates, and assembled UI snapshots.
- Build and install the Mac artifact, launch it with an isolated home, and run a controlled browser fixture smoke.
- Push the Windows build only after local gates pass; require its packaging/installer workflow and public artifact checks before claiming Windows ready.
