# Agent Note: Mac side-copy evidence separates adapters from native acceptance

Status: implemented

English | [中文](2026-09-13-macos-side-copy-update-evidence.zh.md)

## Problem

An updater can start a helper without completing application replacement or restarting against the intended runtime home. An old profile can also continue resolving packages from a retained application backup, so a successful window alone does not prove migration independence. Tests that reuse daily installations or private Session content cannot safely exercise these failures.

## Decision

The [Mac driver](../../../../apps/desktop/tests/macos-side-copy-update.ts) owns a private disposable artifact copy and explicit synthetic profile inputs. Native update, ready verification, and quiescent shutdown are injected test dependencies; they do not define another product helper or ready protocol. The local result always carries `nativeAcceptance: false`, including when all callbacks complete.

The driver binds source artifact hashes and the final source SHA, preserves relative bundle links when copying, and rejects absolute or escaping links. Protected data checks retain every original path and byte while permitting only exact, predeclared additions for successor generations. Cleanup, ready, source-integrity, and data-preservation failures are recorded independently. Evidence roots remain available for inspection instead of being deleted by a success path.

The [native input consumer](../../../../apps/desktop/tests/macos-side-copy-native-adapter.ts) uses the shared base descriptor validator, checks its trusted digest and the candidate ASAR, maps abstract resource paths to Contents/Resources, and rejects redirected required files. Missing required native inputs fail instead of becoming a skipped acceptance run. The separate historical performance tool remains scoped to its original version pair rather than constraining the current product manifest.

The packaged Mac consumer runs the shared base lifecycle and a separate historical UI/native-directory continuation. It uses explicit core receipt scope, retains pause/recovery as unverified, binds both 100% and 150% runs to one actual executable with separate historical fixtures, and drains owned processes on UI failures. A clean final source revision and actual native execution remain prerequisites for acceptance; offline consumer tests do not establish native success.

Mac picker discovery treats the observed command name and executable image as separate facts. Only one new root descendant with an exact supported command is considered, and its PID-scoped lsof record must identify the system osascript image before UI automation starts. Ambiguous candidates, mismatched images and inspection failures remain failures; native confirmation supports the observed Chinese label alongside the existing labels.

Manual picker interaction is an explicit bounded consumer mode. The application still opens its own verified native chooser; human input is accepted only through a new official workspace record with the exact requested canonical path after picker exit. Output-only pending records and user acknowledgements cannot complete a check. Final Mac evidence retains the interaction mode and rechecks the durable workspace path; cancellation, timeout and continuation errors preserve shutdown and historical-data verification.

## Alternatives considered

**Updating the daily installation.** This would couple test failures to user data and running tasks. The driver accepts explicit artifact inputs and operates on a new private copy instead.

**Equating helper launch with upgrade success.** Launch completion cannot establish the restarted application's versions, paths, or Host readiness. Those checks belong to the foundation adapter and independent native evidence.

**Requiring an identical whole directory after migration.** Valid successor generations add files. Explicit permitted additions preserve the old bytes without treating arbitrary new paths or overwritten generations as harmless.

## Consequences

The [offline suite](../../../../apps/desktop/tests/macos-side-copy-update.spec.ts) can exercise copying, path rejection, preservation, and failure collection without launching Electron. Its synthetic package and Session bytes are not evidence of plugin activation, format migration, or native installation. Full native acceptance still depends on the foundation protocol, verified package origins, isolated restart, and actual lifecycle observations.

The fixture deliberately does not manufacture a lockfile, generated Cordis graph, fallback-cache format, or Evolution algorithm state. Their owners supply valid runtime fixtures for native acceptance. The independent [driver reference](../../../../apps/desktop/tests/macos-side-copy-update.md) describes input and evidence limits.
