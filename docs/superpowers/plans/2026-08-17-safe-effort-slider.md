# Safe Effort Slider Implementation Plan

English | [中文](2026-08-17-safe-effort-slider.zh.md)

**Goal:** Replace the effort submenu's plain list with one accessible, particle-backed slider that commits only Host-advertised effort identifiers.

**Architecture:** Keep model data and mutations in `ModelSelect.tsx`; add a pure presentation component plus CSS under the same package. Preserve the existing menu nesting and `ModelDirectory.select()` path. Use CSS particles and transforms rather than a new rendering dependency.

**Tech stack:** React 18, TypeScript, CSS Modules, Vitest, Testing Library.

## Task 1: Specify the effort contract

- [ ] Add failing tests in `packages/client/ui-model-selection/tests/effort-slider.client.spec.tsx` for ordered advertised stops, `max` → `ULTRACODE`, unknown labels, Arrow/Home/End behavior, busy state, and reduced-motion-safe markup.
- [ ] Add a failing integration assertion in `packages/client/ui-model-selection/tests/model-select.client.spec.tsx` proving DeepSeek's `off/high/max` input never submits `low` or `medium`.
- [ ] Run the two focused test files and record the expected RED failures.

## Task 2: Build the presentation component

- [ ] Add `packages/client/ui-model-selection/src/client/EffortSlider.tsx` with a controlled value, advertised rows, disabled state, and exact commit callback.
- [ ] Add keyboard, click, and pointer-to-nearest-stop handling without synthesizing identifiers.
- [ ] Add semantic slider attributes, stop labels, a static fallback layer, and decorative particle elements hidden from assistive technology.
- [ ] Add the particle track, energy states, light/dark tokens, focus ring, compact layout, and reduced-motion rules to `ModelSelect.module.css`.
- [ ] Run the focused component tests until GREEN.

## Task 3: Integrate with model selection

- [ ] Replace only the Effort submenu body in `packages/client/ui-model-selection/src/client/ModelSelect.tsx`.
- [ ] Preserve the existing pending-selection lock, optimistic model state, error handling, menu anchoring, and provider/model rows.
- [ ] Update package locales only where accessible wording needs a new label.
- [ ] Run all `ui-model-selection` tests and the package typecheck/lint path.

## Task 4: Verify the assembled UI

- [ ] Build the Web client and open the real Desktop composition under a temporary `DSH_HOME`.
- [ ] Verify the control at compact and wide window sizes, keyboard focus, light/dark theme, reduced motion, and no console errors.
- [ ] Capture a screenshot for review and record verification in `PROJECT_CONTEXT.md`.
