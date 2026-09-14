# Desktop release procedure

English | [中文](README.zh.md)

This procedure publishes an accepted Desktop candidate to [Missher12/deepseek-harness-desktop](https://github.com/Missher12/deepseek-harness-desktop). The coordinator owns integration, the release record and publication. Platform owners build and validate isolated installations from the same final commit. Follow the [Desktop preparation guide](../README.md) for the official runtime inputs and native packaging commands.

## 1. Freeze the candidate

Record the complete Desktop commit, Desktop version, official Harness version and source commit, reviewed official package input digest, and the selected plugin versions, source commits and archive hashes. Check that the integration worktree is clean. Preserve existing release tags and assets.

The base Desktop and optional plugins have separate versions and acceptance records. Keep private Media@Missher and MSE core sources and archives out of public Desktop assets. Public plugin links must resolve to the intended repository and visibility. Compatibility claims must identify the tested plugin combination; package installation alone does not prove activation.

Candidate transport to a native runner follows the project's current authorization. A candidate branch, draft release or uploaded Actions artifact is not a released version. Any source correction after the freeze requires a new final commit and renewed platform acceptance bound to that commit.

## 2. Collect native acceptance

Send the same complete commit to each platform owner. Record actual runner or host identity, run ID and attempt where applicable, original logs, acceptance receipts and package hashes. Preserve failed attempts separately. A successful retry cannot explain a failed attempt whose evidence is unavailable.

| Target | Accepted package | Required native scope |
| --- | --- | --- |
| Intel macOS | DMG | Isolated installation, launch, conversation/history, update and recovery, exact process cleanup, protected data |
| Windows x64 | Setup EXE | Visible NSIS lifecycle, installation, conversation/history, update handoff and cancellation, exact process cleanup, uninstall/data retention |
| Ubuntu 22.04 x64 | deb and AppImage | Each format's installation, sandbox, conversation/history, update authorization/replacement, restart and data retention |
| Ubuntu 24.04 x64 | The same accepted Linux package bytes | Both formats under the system's user-namespace policy, with the same lifecycle and data checks |

Exercise the installed user's previous supported version and configuration in synthetic, isolated fixtures. Preserve existing Session generations and other protected bytes, and verify old history through the new application. Test confirmed faulty-plugin pause and recovery separately from conversation cancellation. An installer handoff, successful HTTP response or running PID does not alone establish that the new application is ready.

The base composition and selected supported plugin combination each require their intended checks. Include enhancement behavior such as projectless input and left turn navigation in combination acceptance. Report unsupported plugin platforms explicitly. Source checks, keyless synthetic model requests, development-stage launches and native installer acceptance remain distinct observations.

## 3. Assemble the accepted bytes

Copy the accepted DMG, EXE, deb and AppImage into a new release directory without rebuilding or repacking them. Compare each file's byte size and SHA-256 with its platform receipt. Also collect the Linux AppImage policy helper from the same final source revision. Record an exact asset inventory, including every checksum and update manifest that will be published.

Generate the four update manifests with [create-desktop-update-manifest.ts](../../../scripts/create-desktop-update-manifest.ts). The arguments are the accepted package path, output path, Desktop version, included Harness version and new release tag. The tag must be `desktop-v<Desktop version>`.

| Package | Additional generator arguments | Output basename |
| --- | --- | --- |
| DMG | None | `deepseek-harness-desktop-update.json` |
| Setup EXE | `--target win32-x64-nsis` | `deepseek-harness-desktop-update-win-x64.json` |
| deb | `--target linux-x64-deb` | `deepseek-harness-desktop-update-linux-x64-deb.json` |
| AppImage | `--target linux-x64-appimage` | `deepseek-harness-desktop-update-linux-x64-appimage.json` |

Run the generator through `pnpm exec tsx scripts/create-desktop-update-manifest.ts` with those literal arguments. It reads the physical package and validates its name, size, digest, version, target and fixed release URL. It does not validate native acceptance. Keep one ASCII/LF `.sha256` sidecar for each installer and the policy helper; each line contains the lowercase hash, two spaces and exact asset basename.

## 4. Publish the recorded inventory

Only after all required native receipts match the final commit and asset bytes may the coordinator update the public main branch, create the new tag and publish the release. Check the live remote refs before changing them. Never move a released tag or replace existing release assets to repair a failed candidate.

Create the new release as a draft, upload exactly the recorded assets without overwrite flags, and compare the server asset names, sizes and available digests against the inventory. Check the tag's resolved commit; a release's branch name or `target_commitish` text alone is insufficient. Publish only after these checks pass. Release notes state the included official version, supported platforms and plugin combinations, update behavior and material limitations.

The [Desktop Release Tooling workflow](../../../.github/workflows/desktop-release.yml) has read-only repository permission and exercises the manifest generator, parser and workflow restrictions. Its success proves only those tooling checks. It neither builds installers nor publishes or authorizes a release.

## 5. Verify public delivery

Re-read the public main branch, resolved tag, release status, release notes and complete asset inventory. Download every recorded asset from its public release URL using a fresh, unauthenticated request, without Authorization, Cookies, netrc or credential-bearing client configuration. Recalculate byte sizes and SHA-256; do not substitute local cache or the authenticated upload response.

Parse the four downloaded update manifests with the application's [release validator](../src/update/release.ts), checking each against the recorded target, versions, package bytes and release URL. Check that every downloaded sidecar names and hashes its intended asset. Verify the public README, About description and plugin links against the delivered release.

Mark the release record complete only when native acceptance, publication and anonymous verification all pass. Keep the final commit, run/attempt identities, asset inventory, receipts and unresolved limitations together. If publication succeeds but public verification fails, report that precise state and retain the failed evidence.
