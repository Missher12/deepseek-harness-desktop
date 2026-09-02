# Agent Note: Recover exact legacy packaged module proxies during Desktop upgrade

Status: implemented

English | [中文](2026-09-02-recover-legacy-packaged-module-proxies.zh.md)

## Problem

Packaged Desktop 0.4.10 and 0.4.11 materialized `$DSH_HOME/profiles/node_modules` fallbacks as real ESM proxy directories because external profile plugins could not follow links into the packaged `app.asar` filesystem. Desktop 0.5.0 uses ordinary installation links and treats every real fallback entry as user-owned. An existing 0.4.x home therefore failed in `healProfilesModuleFallback` before the Harness child started, while native smokes using fresh temporary homes stayed green.

## Decision

`healProfilesModuleFallback` recognizes a legacy proxy only when the package name, manifest key order and serialization, ESM exports, canonical `pathToFileURL` targets, generated `entry-N.js` bytes, and complete directory file list match the historical generator. Every target must enter a packaged `app.asar` or `snapshot` path. A mismatch, extra field, extra file, non-canonical URL, or unreadable entry leaves the real directory unchanged and raises the existing fail-loud error.

A recognized proxy is renamed atomically into the real directory `$DSH_HOME/recovery/legacy-module-fallback` before the current installation link is created. The recovery name combines a content digest with a random suffix; the preserved manifest and entry bytes remain available for inspection or manual restoration. The recovery parents must themselves be real directories. Concurrent launches may lose the rename or link-creation race only when the other process has already moved the proxy or created the identical link.

The packaged Desktop smoke seeds an exact `@deepseek-ai/dsh-desktop` proxy beside ordinary profile and cold Session bytes in a temporary `DSH_HOME`. It accepts startup only after the proxy is preserved in recovery, the current link exists, unrelated bytes remain identical, and the owned process tree exits completely.

## Alternatives considered

**Delete every directory carrying `dsh.moduleFallback.targets`.** The marker alone does not prove ownership, and deletion would make a false positive irreversible. Exact historical bytes plus recoverable rename keep the ordinary real-directory refusal intact.

**Require users to repair the directory manually.** The failure occurs before the Harness child starts and the Desktop error is intentionally generic, so affected upgrades cannot reach Settings or an in-app repair action.

**Continue writing the legacy proxy format.** This would retain packaging-specific target URLs as active state and make future healing compare obsolete exports instead of converging every installation on current links.

**Copy the directory before replacing it.** Copy-then-delete permits partial backups and widens the crash window. A same-home rename preserves the original directory entry atomically.

## Consequences

Exact 0.4.x generated proxies migrate once and no longer block Desktop startup. Recovery directories are retained until the user removes them; the runtime does not prune evidence from an upgrade. Modified or corrupt proxies still fail closed and require manual inspection. Fresh homes and existing correct links keep their prior behavior, while unit tests and native packaged smokes cover the upgrade path on macOS and Windows.
