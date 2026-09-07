---
description: "Check installed Desktop and Harness versions and apply verified Mac updates."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-system-update

English | [中文](README.zh.md)

## Summary

This Desktop-only client package contributes the System Update section to Settings. It renders the narrow `window.dshDesktop` update state and invokes only fixed check, download, and install operations owned by the Electron main process.

The package never selects a repository, network URL, destination path, checksum, or executable command. Official Harness tags are informational; only a validated Intel macOS Desktop release manifest can enable download and installation.

The page presents a status card and separate installed Desktop/core rows. An unchecked state never claims to be current; prerelease core versions are marked explicitly. Download progress is accessible, operation failures remain visible with optional details, and release notes have separate Desktop and Harness links.

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

- **Intel macOS Desktop only** — the section is hidden when the verified Electron preload bridge is absent, including ordinary browsers and the current Windows Desktop build.
- **Fixed release channel** — users cannot select a repository, mirror, asset, checksum, destination, or installer command from this package.
- **Unsigned artifacts** — code signing and notarization remain release-infrastructure work; the Electron main process still requires an exact manifest, SHA-256 match, and compatible x86_64 bundle before installation.

### Dev Note

None.
