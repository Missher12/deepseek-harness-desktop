# DeepSeek Harness Desktop

English | [中文](README.zh.md)

Desktop 0.6.0 prepares the official Harness base composition through the root `desktop:stage` command. The app owns one loopback-only Harness child process on an operating-system-assigned port and renders the official Web client inside a hardened Electron window. This source version is not a public release or a three-platform acceptance claim.

Release collection and publication follow the [platform release guide](releasing/README.md).

<a id="composition-scope"></a>
## Composition scope

The base composition preserves the complete official Web dependency graph and adds only [native window controls and close behavior](../../packages/client/ui-desktop-shell/README.md) and [System Update](../../packages/client/ui-settings-system-update/README.md). It derives the managed `desktop-base` profile from canonical `web`, preserving the canonical configuration, installed plugin sources and product data. An absent canonical profile is initialized through the official Web template. Pricing, statistics, personalization and model helpers belong to optional plugins. The removed Workbench and its native browser bridge remain excluded.

Preparation binds a clean official checkout at `fb2c4b9e698e30edb738bca4cf0618587db7d203`, Harness `0.1.5-rc.2`, and all 275 tarball identities to a trusted descriptor SHA-256. Installed runtime identity separately binds the input descriptor, physical file inventory and native OS/architecture. A matching version string or a runtime copied from another OS does not satisfy these checks. The [reproducible-input decision](../../.agents/notes/implemented/architecture/2026-09-13-reproducible-desktop-base-inputs.md) owns the source, installation and audit rules.

<a id="prepare-the-base-stage"></a>
## Prepare the base stage

Run from the repository root on native Intel macOS, Windows x64 or Linux x64 with the checkout's dependencies installed. Supply the clean official source, its independently reviewed tarball descriptor and the trusted SHA-256 of that descriptor. The following shell example uses placeholders for those owned input locations:

```bash
pnpm run desktop:stage \
  --official-source /path/to/official-source \
  --packages /path/to/official-packages \
  --descriptor /path/to/official-inputs.json \
  --descriptor-sha256 '<trusted-descriptor-sha256>' \
  --runtime /path/to/local-official-runtime
```

Use the same arguments on Windows, with native paths and the command on one line or PowerShell continuation syntax. [`prepare-desktop-base.ts`](../../scripts/prepare-desktop-base.ts) selects the pinned `pnpm@11.7.0` JavaScript executor without a shell, verifies or prepares the local runtime, prepares the independent update-helper runtime, builds the native clients and main process, and assembles the stage. These instructions specify the current preparation entry; they do not claim a completed installer run.

An existing runtime with a matching local installation receipt is verified read-only. An audited S2 runtime uses the additional pair `--runtime-audit /path/to/runtime-audit.json --runtime-audit-sha256 <trusted-audit-sha256>`. The external audit binds the official input descriptor, runtime inventory, current platform/architecture and hashed native evidence. Import does not install into, rewrite or add a receipt inside the immutable runtime. A missing or incompatible receipt fails instead of silently rebuilding an accepted core.

The helper is an independent Node `24.17.0` executable. `--helper-runtime /path/to/helper-runtime` selects a prepared directory; `--helper-cache /path/to/download-cache` selects the fixed-release download cache. An existing helper is verified read-only. Formal preparation requires its recorded native `--version` probe; unpacking a foreign-platform archive or an injected test probe does not meet that requirement.

The default output is `apps/desktop/.stage`. `--stage /path/to/dsh-desktop-stage` selects a new stage directory. Preparation refuses an existing stage and preserves it; use its packaging command or select another output. The stage includes `base-smoke.json`, the base composition descriptor, the official runtime and separately identified native adapters. The packaged `official-runtime`, base patch and composition descriptor remain physical under `app.asar.unpacked` so profile resolution can create real filesystem links; the independent helper is copied to the `desktop-helper` resource directory.

`--build-official` explicitly runs the pinned source's official build and tarball-pack commands. It requires new package and descriptor outputs, then passes their result through the same verification. Use it only for a deliberately requested new official build; reuse reviewed input receipts for an already accepted core. For example:

```bash
pnpm run desktop:stage --build-official \
  --official-source /path/to/clean-official-source \
  --packages /path/to/new-official-packages \
  --descriptor /path/to/new-official-inputs.json \
  --runtime /path/to/new-local-runtime \
  --stage /path/to/new/dsh-desktop-stage
```

For the default `.stage`, invoke the matching native package script after preparation: `pnpm --filter @deepseek-ai/dsh-desktop run pack:dir` or `pack:dmg` on Intel macOS, `pack:setup` on Windows x64, and `pack:linux` on Linux x64. A custom `--stage` also requires the packaging invocation to select that directory. Do not replace this base stage with the full dependency or enhancement inventory. `desktop:full:stage:built` is the explicit historical full staging entry; a descriptor-less installed full application retains its existing launch selection.

Windows `pack:win-dir` and `pack:setup` share the [Windows builder entry](../../scripts/windows-desktop-builder.ts). It retains `electron-builder.windows-derived.json` beside the original stage configuration and excludes it from the package. An existing derived file is preserved and rejected; another invocation requires a freshly prepared stage. The [packaging decision](../../.agents/notes/implemented/architecture/2026-09-13-reproducible-desktop-base-inputs.md#packaged-file-selection-and-permissions) explains the file filters and installed metadata permissions.

## Plugin compatibility and recovery

General Settings provides **Plugin compatibility and recovery** in a separate native window; the startup failure page reaches the same controls and System Update without loading the failing Web graph. Choices take effect after an explicit native restart confirmation, which stops active generations and tools. Canonical `web` remains the CLI plugin installation target. Desktop owns only its derived `desktop-base` profile and `.desktop-compatibility` state under the same Harness home; original Session generations, configuration, package source and data are not deleted.

User enablement and compatibility health are separate. Attributable Bundle YAML failures require distinct observations before automatic pause; `DSH_DESKTOP_PLUGIN_FAILURE_CONFIRMATIONS` explicitly configures the native threshold from 1 to 64, default 2. A persisted threshold mismatch requires resolving the configuration while Desktop is closed. Network, authentication, rate-limit, timeout, cancellation and unknown core failures do not pause a Bundle. Restoration checks the currently installed package and an actual candidate Host before consuming a process-local validation receipt; it preserves a manual disabled choice.

The derived profile uses `startup` patch reload and records the canonical preference. Relative inserted plugin names are anchored at their original patch path using official loaders. Unsafe dynamic references, conflicting root or preset references, malformed global inputs and foreign derived directories enter native recovery instead of silently dropping user configuration. Package-manager commands continue to target `--profile web`; editing `desktop-base` directly is unsupported. The [profile recovery decision](../../.agents/notes/implemented/architecture/2026-09-13-desktop-profile-recovery.md) states the scope and evidence limits.

## Linux and verification limits

The Linux `.deb` declares `python3` among its dependencies. Update availability still requires native capability preflight. Missing AppImage capabilities do not authorize automatic replacement; the verified-package and manual-install behavior remains subject to the [native update implementation](src/update/). A prepared helper or stage does not establish Linux update or installation acceptance.

## Plugin entries

From 0.6.0, the planned standard distribution pairs the base Desktop with the independent Enhance plugin. Other plugins are obtained from their GitHub projects. The base stage retains its minimal composition; default plugin provisioning is a separate delivery task and is not established by this source migration.

The current integration target is Settings → Plugins, with an installed list and the existing marketplace. Every installed user plugin must be visible with its version, compatibility status and configuration or usage entry. Statistics and model helpers retain their ordinary feature entries. This path is still being completed; see the [component map](../../README.md#plugins).

## Published packages and source status

Use [Releases](https://github.com/Missher12/deepseek-harness-desktop/releases) for accepted installers. The imported development source is Desktop 0.6.0; the published release is 0.5.8. A copied source tree, prepared stage or isolated fixture is not a completed installation or update. The [migration record](../../docs/desktop-source-migration.md) separates those states.

<a id="icon-provenance"></a>
## Icon provenance

Application and tray assets are maintained under [assets](assets/). Preserve their existing attribution and the repository [license](../../LICENSE).

## Dev Note

The validation source and platform workflows were moved into the main repository without a new installer release. Existing Windows and Ubuntu native failures remain open; this migration does not rerun or certify them. Earlier full-composition descriptions remain available in Git history and do not define the base product.
