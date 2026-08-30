---
description: "Desktop-only active-profile and packaged-pnpm services for trusted DSH plugin managers"
kind: "package-reference"
---

# `@deepseek-ai/dsh-host-desktop-plugin-runtime`

English | [中文](README.zh.md)

## Summary

This private Host package publishes the two structural services consumed by a trusted plugin manager in DeepSeek Harness Desktop: immutable `desktopProfiles.current` identity and serialized `desktopPnpm.runPlugin()` package operations.

It is mounted only by the Desktop application's private patch. Ordinary Web profiles do not receive these services. Package operations re-enter the packaged `dsh plugin` command, so profile initialization, caller-relative path anchoring, and `dsh.profile.bundles` reconciliation remain owned by the upstream CLI.

The service resolves the packaged pnpm JavaScript entry without PATH lookup, rejects unsafe arguments and caller directories, runs through the managed subprocess service, and cancels the complete operation tree during teardown. The subprocess boundary supplies the credential-scrubbed ambient environment; only the active `DSH_HOME`, packaged pnpm entry, Electron Node mode, and non-interactive flag are added explicitly.

## Table of Contents

- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="dev-note"></a>
## Dev Note

None.

<a id="model-experience"></a>
## Model Experience

None, as this package manages Host-side plugin packages and never assembles or sends a model request.

#### KV Cache effect

None; package-management operations do not alter provider request payloads or caching.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One fixed profile** — the current Desktop shell exposes only the active `web` profile per generation and does not implement profile switching.
- **Trusted-manager policy boundary** — package target policy remains the responsibility of the trusted manager; the bundled Desktop composition uses curated `dshmarket` routes rather than a generic renderer bridge.
