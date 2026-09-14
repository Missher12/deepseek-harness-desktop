# macOS side-copy update acceptance driver

English | [中文](macos-side-copy-update.zh.md)

## Summary

The [driver](macos-side-copy-update.ts) copies explicit artifacts into a private temporary root and records update-adapter failures, shutdown failures, and protected-data changes independently. It never launches an application itself. Its result always states `nativeAcceptance: false`; native acceptance requires the foundation adapter and separate running-process evidence.

## Table of Contents

- [Inputs and isolation](#inputs-and-isolation)
- [Synthetic legacy profile](#synthetic-legacy-profile)
- [Adapter and evidence](#adapter-and-evidence)
- [Offline verification](#offline-verification)
- [Dev Note](#dev-note)

## Inputs and isolation

Supply an old app artifact, its `app.asar` SHA-256, a target DMG and SHA-256, the final source SHA, an Evolution 0.7.0 package directory and archive with archive SHA-256, and explicit synthetic Session bytes. The driver rejects artifacts under `/Applications`, escaping bundle links, absolute bundle links, and invalid Session paths. Relative bundle links remain relative in the disposable copy. Source artifact hashes are checked before and after the adapter operations; the driver does not establish signing, DMG format, full unpacked-package provenance, or archive/package-directory equivalence.

Each run allocates a mode-0700 temporary root. The adapter receives only that run's app, copied DMG, attempt ID, source SHA, and fixture paths. It must use those isolated paths for initial launch and restart. No default reads the user's Session bodies, credentials, or plugin data. Retain the root on completion for inspection; remove only the owned root after the adapter proves all its work has stopped. Preparation errors can leave a partial root and do not count as a completed run.

The [native input consumer](macos-side-copy-native-adapter.ts) validates the foundation [base descriptor](../../../scripts/desktop-base-contract.ts) and its trusted SHA-256 before resolving Mac resources. It checks the candidate ASAR hash, packaged Desktop/core metadata, required files and executable confinement. Supply `DSH_DESKTOP_SMOKE_DESCRIPTOR`, `DSH_DESKTOP_SMOKE_DESCRIPTOR_SHA256`, `DSH_MACOS_CANDIDATE_ASAR_SHA256`, and `DSH_MACOS_SOURCE_SHA`; `DSH_MACOS_REQUIRE_NATIVE=1` rejects missing inputs. With no native request, offline discovery returns no request; partial inputs and invalid flags fail. The input loader alone validates artifacts; `runMacBaseCore` additionally runs the shared packaged smoke and a Mac continuation for historical UI reopening and native directory selection.

## Synthetic legacy profile

The [fixture](macos-legacy-profile-fixture.ts) models the ordered Web bundle tuple `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `dsh-missher-evolution`, live patch reload, a local archive dependency, and a profile-local Evolution 0.7.0 package. Its shared `profiles/node_modules/@deepseek-ai` link targets the disposable old app's unpacked runtime. It adds an empty user patch and preservation sentinels, without fabricating generated Cordis configuration, lockfiles, fallback-cache formats, credentials, or mutable Evolution rules.

The main native scenario uses a verified Desktop 0.5.5 / Harness 0.1.3-alpha.1 source artifact. Desktop 0.5.8 is a separate source scenario. The caller owns version verification and valid historical Session seeds; the fixture does not infer Session formats or claim that synthetic sentinel bytes are executable plugin state. The offline suite uses non-executable synthetic artifacts and never proves Evolution activation or history readability.

Protected inventories include paths, empty directories, and regular-file hashes. Existing entries must remain identical. Newly created generation paths are accepted only through exact `allowedNewProtectedPaths` entries; no wildcard permits deletion or overwrite. Every actual addition appears in the evidence report. Symlinks, redirected ancestors, and hard-linked protected files fail preservation checks.

## Adapter and evidence

`MacosSideCopyAdapter` is a test dependency interface. Foundation supplies `upgrade`, `verifyReady`, and `stopAndVerify`; its real helper and ready protocol remain the only product authority. Adapters must bound waits, consume the real ready receipt, verify actual versions and executable/home/userData paths, and stop all owned processes even when upgrade fails. The driver awaits cleanup before collecting final data evidence, and preserves cleanup failure alongside upgrade or ready failure.

The root-local `side-copy-result.json` is atomically renamed into place after the adapter settles. It records the attempt, final source SHA, input artifact hashes, protected inventories, allowed and actual additions, and separate failure stages. `adapter-completed` means only that the callbacks and preservation checks completed. A callback stub, helper launch success, or successful `open` command cannot certify a native upgrade.

Core verification explicitly uses `scope: 'core'`. `native-base-evidence.json` reports `acceptance: 'core-passed'` and `unverifiedChecks: ['pauseRecovery']`; it does not certify full plugin recovery or an installer transaction. Historical UI evidence reads the official row’s existing `text/plain` drag payload and `aria-selected` state, requires the real fixture Session ID and rendered historical response, and preserved original files and workspace membership. The Mac picker requires one newly observed root-descendant PID with the exact command `osascript` or `/usr/bin/osascript`, then verifies `/usr/bin/osascript` in that PID’s lsof text-image record. It uses System Events only against that verified PID, accepts the native Choose/选择/选取 confirmation labels, and verifies the resulting workspace row. Missing Accessibility permission, failed UI assertions, or remaining owned processes/listeners fail the run. Native verification also requires the exact clean source SHA, actual Intel executable and Info.plist identity. Each root retains reader, settings, historical reader and selected-workspace screenshots alongside hashed receipts.

The optional startup entry accepts `DSH_MACOS_STARTUP_EXECUTABLE` and `DSH_MACOS_STARTUP_FIXTURES` with one or ten independent fixtures. Its elapsed time covers the current core lifecycle and continuation; it is not an old-versus-new performance comparison. The older visual-wrapper entry and expanded CI draft are outside this scoped core entry.

Set `DSH_MACOS_PICKER_MODE=manual` for human-assisted directory selection; the default is `automatic`. `DSH_MACOS_PICKER_TIMEOUT_MS` is accepted only with manual mode and must be an integer from 1000 through 600000 (default 600000). Both native entries resolve this policy explicitly and budget their test deadline for the bounded waits. Automatic input errors never switch to manual mode.

After the application's own Add workspace action opens a newly verified system picker, manual mode writes `checks/mac-picker-awaiting-user.json` and the same JSON line to stdout, including the complete owned target path, window title/PID, scale and deadline. This is an output-only prompt; neither that file nor an external acknowledgement supplies success. Manual mode performs no keyboard input, activation or automatic selection. It waits for the confirmed picker to exit and for a new official workspace ID whose persisted canonical `path` equals the requested physical directory. The source of these fields is the pinned official `workspace/spec.ts` domain (`global.workspaceIds`, `tables.workspaces`); existing matching workspaces and same-basename wrong paths cannot pass. The actual workspace row and composer trial interaction must also pass. Cancellation/adoption failure, wrong paths and timeout reject; the application then follows the same owned shutdown and protected-data verification. The consumer reads only its isolated registry, never the contents of an incorrectly selected directory.

Portable core evidence records `pickerMode`, and its bound Mac continuation records the selected workspace ID and full path. Final verification rereads that official record after shutdown. Old history verification also runs when the Mac continuation fails; failure cannot produce a completion receipt. Manual mode is available for the next frozen native candidate and is not an existing native acceptance result.

## Offline verification

Run the focused suite from the repository root with the repository dependencies available:

```sh
pnpm exec vitest run apps/desktop/tests/macos-side-copy-update.spec.ts
```

The suite creates disposable synthetic sources, exercises the driver through explicit offline callbacks, and removes its own roots after completion. It covers hash rejection, copied-link containment, Session path rejection, ready/cleanup failure, source mutation, data corruption, and explicitly permitted successor files. The packaged core entry is `packaged-smoke.spec.ts`. Supply `DSH_MACOS_CORE_FIXTURES` as a JSON file containing exactly two `{ smokeRoot, legacyFixturePath }` objects ordered 100%, 150%, each prepared by the shared historical fixture producer under a distinct physical root. `DSH_MACOS_DESKTOP_EXECUTABLE` optionally selects the disposable installed executable; both runs invoke that exact packaged executable with the shared scale option. No shell wrapper substitutes for the app.

The [historical performance runner](../../../scripts/macos-desktop-runtime-evidence.ts) accepts only the 0.5.3 baseline and 0.5.5 candidate for its optional comparison. It neither constrains the current Desktop manifest nor supplies current release acceptance; a 0.6.0 candidate is rejected as outside that experiment.

## Dev Note

None.
