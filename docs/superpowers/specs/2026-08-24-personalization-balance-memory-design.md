# Personalization, Live Billing, and Memory Integration Design

English | [中文](2026-08-24-personalization-balance-memory-design.zh.md)

**Date:** 2026-08-24

**Status:** Approved for implementation

**Target:** DeepSeek Harness Desktop 0.3.6 on Intel macOS and Windows x64

## Goal

Desktop 0.3.6 adds one global Personalization page, makes the composer billing facts truthful and time-aware, and ships `dsh-missher-memory` as a discoverable built-in plugin. The implementation preserves the Harness plugin boundary: personalization reuses the canonical global instruction file, memory stays independently installable and upgradeable, and billing remains an optional DeepSeek-only capability.

## Billing Facts

The statistics strip uses spaces around every separator and presents session activity and billing as readable groups. When supported DeepSeek usage exists, the billing group shows the current-turn estimate, session estimate, exact account balance, and the active Beijing pricing period. A balance transport failure shows `Balance unavailable`; it never fabricates a zero or subtracts estimates from an assumed starting balance.

The Host obtains the exact balance from DeepSeek's documented `/user/balance` response and exposes only the validated currency and total through the existing capability-gated same-origin bridge. The bridge attaches when the Web Server service becomes available, even when the LLM plugin starts first, and detaches with its owning lifecycle.

Pricing uses one Beijing-time snapshot for the estimate and period label. Weekday peak periods are 09:00–12:00 and 14:00–18:00; weekday remaining hours and all weekend hours are off-peak. A minute-aligned Client clock refreshes the label and estimate at boundaries without depending on an unrelated chat render. Unsupported or mixed billing models keep the established honest fallback rather than claiming a known cost.

## Global Personalization

Settings gains a first-class `Personalization` page. It contains a custom-instructions editor, a reply-style selector, bounded status text, and a Save action that is disabled while unchanged. The page explains that changes apply to all chats from the next model step and that project instructions may add more specific context.

The feature edits one Desktop-owned marked block in the canonical `$DSH_HOME/AGENTS.md`; the existing agent-instructions package remains the only model-visible loader. Content outside the marked block is preserved byte-for-byte. A revision token prevents stale writes, and writes replace the file atomically. The Host rejects NUL bytes, over-limit content, a writable symlink target, and any path other than the fixed global instruction file. Parent and file permissions remain user-private where the platform supports POSIX modes.

The reply-style selector compiles a short explicit rule into the same managed block. It is not an independent hidden prompt. Removing both custom instructions and a non-default style removes only the managed block and leaves manually maintained instructions intact.

## Built-in Memory Plugin

Desktop depends on the canonical distributable of `dsh-missher-memory`, adds it to the app-owned composition, and exposes it through the ordinary plugin settings and marketplace surfaces. The standalone repository publishes the same version as a GitHub Release asset with a checksum and the `dsh-plugin` discovery topic, so a profile-installed newer version can shadow the bundled fallback without changing the Desktop composition contract.

The plugin defaults capture and recall on for newly bound projects. Existing project rows keep their saved choices. Default-on does not weaken the safety boundary: an unbound project returns and records nothing, recall remains project-scoped and top-level-only, capture produces review candidates rather than approved memory, sensitive material is rejected, and failures do not block the model request. Users can disable either behavior in the plugin's own settings.

## Composition and Upgrade Behavior

The bundled plugin is available without a separate terminal installation. Marketplace installation is still transactional, and profile-local packages take module-resolution precedence over the bundled copy. Removing a marketplace-installed update therefore falls back to the Desktop copy instead of removing the app-owned row. A future Desktop update may raise the fallback version, while the standalone plugin keeps its own release cadence.

The 0.3.6 source version is shared across macOS and Windows. Native packages are produced only from the same verified commit. Platform packaging changes do not fork feature behavior, configuration defaults, or localized strings.

## Failure, Privacy, and Recovery

Personalization and memory never expose credentials or arbitrary local files to the Client. A failed personalization save leaves the previous file intact and presents a retryable error. A missing or invalid DeepSeek balance response affects only the balance label. A memory database failure fails open for the chat request and remains visible in plugin diagnostics.

Rollback removes the app-owned memory row and package dependency, or removes the managed personalization block, without deleting user-authored global instructions, plugin state, project data, or `$DSH_HOME`. Native uninstall continues to preserve user data.

## Verification

Focused tests cover late Web Server injection, balance validation, price-boundary clock transitions, visible separator spacing, unavailable-balance copy, managed-block parsing and atomic revision writes, symlink and size rejection, reply-style rendering, new-project memory defaults, existing-project preservation, and bundle composition.

Browser acceptance covers the Personalization page in light and dark themes, unchanged/save/error states, narrow Settings layout, keyboard navigation, and the statistics strip before and after a pricing boundary. Plugin acceptance installs and updates the published package in an isolated profile and proves that the app-owned fallback remains loadable.

Intel macOS and Windows x64 packaged smoke use isolated runtime homes. Each native package must launch the real Harness UI, load the built-in memory plugin, save and reload personalization, fetch or truthfully fail the optional balance, exit without orphan processes, and preserve its isolated data through uninstall or replacement.

## Out of Scope

Automatic approval of memory candidates, cross-project recall before explicit binding, arbitrary file editing, invoice reconciliation, non-DeepSeek price estimation, cloud synchronization of personalization, and destructive migration of existing memory settings are outside this delivery.
