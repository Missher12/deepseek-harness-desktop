# DeepSeek Harness Desktop — Handover

## Current state

Validation main's committed Desktop 0.6.0 source is now maintained in this repository. Its official runtime is pinned to Harness 0.1.5-rc.2. [docs/desktop-source-migration.md](docs/desktop-source-migration.md) records the exact source and the prior public main. Existing Desktop 0.5.8 releases and assets remain unchanged. This handover does not certify a new installer or a complete plugin integration.

## Continue in this order

1. Verify the selected checkout, source revision and actual running application before making changes.
2. Complete Settings → Plugins and the existing marketplace: installed plugins must be visible, configurable and usable; install/update outcomes must appear in the same inventory.
3. For the 0.6.0 standard distribution, supply Enhance as an independent default plugin; obtain other plugins from their GitHub repositories. Preserve each retained feature and its natural entry. Enhance owns the piano, highlighted statistics footer and personal helpers. Media, MSE, Memory and Project Ops retain their original functions; Brain coordinates shared recall.
4. Check the official desktop baseline and existing plugins, repair only actual compatibility gaps, and record platform-specific unresolved items.
5. Use one final source revision for the native owners' packages and acceptance. Follow [the release procedure](apps/desktop/releasing/README.md) before publishing new installers.

## Keep excluded

Do not restore the right Workbench, its native browser bridge, BrowserSkill/Open Design entries or Feishu. Local experiments and retained old code do not change this scope. Do not import local unpublished candidates into a release merely because their build or fixture checks passed.

## Evidence and data

The imported source has outstanding Windows and Ubuntu native failures. Those checks need scoped diagnosis when functional work resumes; repository migration does not rerun them or mark them passed. Keep failed evidence and reuse relevant passing checks without restarting a broad validation campaign.

Preserve user sessions, project membership, plugin configuration, Memory data, MSE state and Media results. Keep credentials, private paths, personal transcripts and local acceptance artifacts out of the public repository. The [project context](PROJECT_CONTEXT.md) and [README](README.md) define the current maintenance scope.
