# Validation source migration

English | [中文](desktop-source-migration.zh.md)

The Desktop source of record is [Missher12/deepseek-harness-desktop](https://github.com/Missher12/deepseek-harness-desktop). This record describes the 2026-09-14 import from the private validation repository.

## Imported content

| Item | Identity |
| --- | --- |
| Source | `Missher12/deepseek-harness-desktop-validation`, `main` |
| Source commit | `861921a7c10c8f7fef7793be559af386858436f2` |
| Public main before import | `d1e8bd9c6d49f980405888099087f931ddd26d83` |
| Development Desktop | `0.6.0` |
| Pinned official Harness | `0.1.5-rc.2`, `fb2c4b9e698e30edb738bca4cf0618587db7d203` |

The import copies the source main branch's tracked files, including Desktop code, build scripts, platform workflows, tests and their documentation. Product code is unchanged from that snapshot. The public README, Desktop guide and maintenance handover are rewritten for the two-goal scope and current source status.

The private repository retains its history, experimental branches and Actions records. Private Git history and local uncommitted work are not imported. Existing public tags, releases and installer assets remain attached to their original commits.

## Outstanding work

The source's recorded Windows native run and Ubuntu native lifecycle runs failed; the Ubuntu package-build job passed. Those facts do not establish native acceptance. Importing source does not create a new release, update an installed application or complete the plugin settings and marketplace path.

Continue with the [project context](../PROJECT_CONTEXT.md), [handover](../HANDOVER.md) and [release procedure](../apps/desktop/releasing/README.md). Workbench and Feishu remain excluded. Preserve the existing optional plugin functions and resolve compatibility within their owning projects.
