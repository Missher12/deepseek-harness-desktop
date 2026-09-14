# DeepSeek Harness Desktop — Project Context

## Product scope

The project has two goals: package official Harness releases for macOS, Windows and Ubuntu, and keep the user's existing plugins fully usable. Desktop owns native lifecycle, installation and updates. Official Harness owns its runtime and standard UI; Enhance, Media, MSE, Memory, Project Ops and the shared Brain component retain their respective responsibilities. See the [component map](README.md#plugins).

The removed right Workbench, its browser bridge, BrowserSkill/Open Design entries and Feishu remain excluded. Historical source is not authorization to restore a removed feature. Media and MSE keep one original core each; their private source and working data are outside this public repository.

## Source and delivery

Starting with 0.6.0, Desktop and plugins have separate maintenance and upgrades. The standard distribution is planned to include the independent Enhance plugin; additional plugins come from their GitHub repositories. Default Enhance delivery remains to be completed without folding its implementation into the base shell.

The development source was imported from validation main at `861921a7c10c8f7fef7793be559af386858436f2`: Desktop 0.6.0 with official Harness 0.1.5-rc.2. The published installer release remains Desktop 0.5.8. Source migration and native release acceptance are separate; the [migration record](docs/desktop-source-migration.md) owns the source identities and outstanding platform results.

The base stage contains official Web and the native shell/update adapters. It derives `desktop-base` from canonical `web`; user plugins belong to the canonical profile and keep separate versions. Preserve existing sessions, configuration and plugin data during compatibility work.

## Immediate work

Complete Settings → Plugins with installed inventory, configuration or usage entries, compatibility state and the existing marketplace. Keep statistics and model helpers in their natural locations. Then check existing plugin functions on the supported Desktop targets, applying only necessary compatibility changes. Current source does not establish that this user path or all platform acceptance has passed.

For subsequent official releases: verify the official release identity, prepare the common desktop packages, check plugins, and publish only through the platform-owned [release procedure](apps/desktop/releasing/README.md). Reuse relevant completed evidence; do not repeat unrelated full suites or expand the feature scope.

## Working rules

The coordinator owns shared changes, integration and final claims. Platform owners work in separate checkouts and validate one final source revision. Each independent plugin owns its implementation and data. Keep machine-local logs, credentials, task transcripts and private paths outside public documentation. Follow [AGENTS.md](AGENTS.md); use [HANDOVER.md](HANDOVER.md) for the immediate sequence.
