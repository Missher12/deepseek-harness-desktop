# Agent Note: Desktop release tooling and accepted artifact promotion

Status: implemented

English | [中文](2026-09-13-desktop-release-tooling-and-promotion.zh.md)

## Problem

Rebuilding installers during publication separates published bytes from the installers that passed native acceptance. A publication job that requires only macOS and Windows cannot establish Ubuntu acceptance or the completeness of four platform-specific update manifests. An overwrite option also permits a retry to replace an existing asset without preserving its identity.

## Decision

The [Desktop release workflow](../../../../.github/workflows/desktop-release.yml) validates release tools with read-only repository permission. It runs the existing manifest generator and application parser tests and checks its own restricted responsibilities. Its successful status is tooling evidence, not native acceptance or publication authority.

The coordinator publishes original accepted installers following the [Desktop release procedure](../../../../apps/desktop/releasing/README.md). The release record binds one final source commit to native macOS, Windows and Ubuntu receipts, the selected plugin combination, and each asset's exact size and SHA-256. The four update manifests derive from those accepted package bytes. Existing released assets and tags are immutable; anonymous downloads verify the completed public transfer.

## Alternatives considered

**Rebuild and publish in one workflow.** A second build is not the accepted artifact, and a green build cannot substitute for the platform lifecycle receipts. Keeping that workflow would also retain a publication path that omits Ubuntu.

**Introduce a general artifact promotion service.** The platform owners already produce concrete receipts and the coordinator owns their review. Adding a new transport and receipt aggregation protocol before it has actual platform inputs would duplicate that ownership and enlarge this migration.

## Consequences

Publication remains an explicit coordinator operation with a recorded inventory. The read-only workflow provides useful reproducible checks without an implicit release side effect. The coordinator must retain and inspect the native evidence and complete anonymous verification; tooling success alone cannot enforce or prove those human-reviewed obligations.
