---
description: "Check running Desktop and Harness versions and operate verified Mac, Windows, or Linux update packages."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-system-update

English | [中文](README.zh.md)

## Summary

System Update shows the running Desktop and Harness versions and the native system's update status in Settings. This Desktop-only client package renders the narrow `window.dshDesktop` state and invokes fixed check, download, download-cancellation, and installation actions owned by the Electron main process.

The package never selects a repository, network URL, destination path, checksum, or executable command. Official Harness tags are informational; a validated manifest matching the native platform and package format enables the Desktop package actions.

The page presents a status card and exactly two running-version rows for Desktop and its included core. An unchecked state never claims to be current; prerelease core versions are marked explicitly. Accessible progress shows only observed percentages and byte counts, with a validated payload basename; unknown percentages remain indeterminate. Download cancellation is available only during download or verification. Failures remain visible with optional sanitized details, and Desktop and Harness have separate release-note links.

Before the native status arrives, the UI shows a loading state, not an unsupported-platform result. A status-read failure shows bounded localized copy and a retry that calls only `getUpdateStatus`; checking, downloading, and installing remain unavailable until status is confirmed. Transport error details are not displayed.

On Intel macOS, selecting “Restart and install” prepares the protected update helper and then quits Desktop; no additional native confirmation is shown. Windows x64 offers a visible Setup wizard after native confirmation. Linux x64 .deb and AppImage packages offer only “Reveal installation package”; Desktop stays running and the action remains repeatable. Cancelling Windows native confirmation is not an error, and a handoff or reveal never changes the displayed running versions or claims installation completed.

## Table of Contents

- [Model Experience](#model-experience)
- [Invariant ownership](#invariant-ownership)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Invariant ownership

No invariant companion is published because the preload validates update snapshots and the renderer only projects that state.


## Model Experience

None, as this package only presents update state and invokes fixed Electron-owned operations without assembling prompts, selecting models or sending provider requests.

#### KV Cache effect

None; the package never participates in a model request or changes its cache behavior.

## Known Limitations and Deferred Work

- **Complete native bridge required** — the section is absent in ordinary browsers and whenever any of the six update operations is missing. Detecting, unrecognized, and unsupported native targets disable update actions; the UI never infers a platform from the browser.
- **Fixed release channel** — users cannot select a repository, mirror, asset, checksum, destination, or installer command from this package.
- **External installation is not observed** — a successful native handoff is not installation success, and cancellation of an external Setup wizard or package manager is not inferred. Only a newly running application's reported versions establish its installed version.
- **Linux installation is manual** — guidance requires quitting Desktop before installation, a package manager for .deb, and a user-chosen stable or versioned AppImage location. The existing AppImage policy helper supports ASCII paths and path-specific AppArmor rules; moving a package can require repeating its policy step. The updater changes neither execution permissions nor sandbox/AppArmor policy.
- **Integrity is not signing** — a manifest and matching SHA-256 validate package integrity, not a publisher signature or notarization. Signing remains a release-infrastructure responsibility.

### Dev Note

None.
