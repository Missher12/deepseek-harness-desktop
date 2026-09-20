# Agent Note: Package the community Desktop distribution

Status: implemented

English | [中文](2026-09-20-community-desktop-packaging.zh.md)

## Problem

A community distribution needs installable applications on macOS, Windows and Ubuntu while retaining one upstream application and independently installed user plugins. Official signing credentials and Linux desktop packaging are not available to this distribution.

## Decision

The wrappers in [desktop-packaging](../../../../desktop-packaging/) consume the official source and its package preparation stages. Electron, the private Host and Harness retain one version. Platform wrappers supply the shared icon and local signing choices; they do not add a second chat interface or plugin composition. The Host requests a loopback port allocated by the operating system.

Linux adds a target-specific runtime lock while retaining the existing macOS and Windows payload selections. Native verification uses disposable profiles without external plugins and exercises the installed application. Ubuntu 24.04 consumes the same installer bytes built on Ubuntu 22.04.

Community macOS artifacts use ad-hoc signatures without notarization, and Windows artifacts use the official unsigned mode. These entry points are separate from the production signing and update qualification described by the [official packaging decision](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md). The [shared Web wrapper decision](../architecture/2026-09-10-desktop-web-wrapper.md) continues to own application behavior and plugin management.

## Alternatives considered

**Import the former custom desktop and its enhancement UI.** This restores an additional product interface and composition that must be adapted for every upstream release. Independent optional plugins retain their own compatibility work.

**Disable the Chromium sandbox for AppImage.** The pinned builder adds that flag by default. The community configuration overrides that behavior because the renderer must retain its sandbox.

**Use one successful platform build as evidence for all installers.** Platform loaders, native dependencies, installer behavior and process cleanup differ. Each target needs native evidence bound to the same source and artifact bytes.

## Consequences

The distribution maintains packaging and target-specific dependencies while upstream owns the application. A package build alone does not establish native usability or third-party plugin compatibility. Community signatures do not establish the official production signing guarantees; installer release notes identify the signing status and measured verification scope.
