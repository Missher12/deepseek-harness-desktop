# Agent Note: Persistent directories for Desktop Sessions without a project

Status: implemented

English | [中文](2026-09-12-desktop-no-project-directories.zh.md)

## Problem

A Desktop Session without a registered project inherits the application launch directory. Generated files from unrelated conversations can mix, and the launch directory varies across platforms and installation methods.

## Decision

The Desktop composition configures the [Session Controller](../../../../packages/api/session-controller/README.md) with `noProjectDirectory: deepseek-temp`. A new ordinary Session without a Workspace or explicit cwd creates a directory named after its Session ID beneath that parent in the Host user directory. The existing Session header records cwd; tools continue to resolve relative paths through that recorded working directory. The same policy runs on macOS, Windows and Linux.

Existing Session adoption uses the recorded cwd before allocating a directory. Explicit Workspace/cwd and fork operations retain their locations. Session deletion removes history while preserving generated files. New directory IDs must be lowercase portable path components, exclude Windows device names and fit within 128 characters. Symbolic links and junctions at the Session directory are rejected. Filesystem failures remain visible and do not fall back to the application launch directory.

This policy complements the [project Session storage layout](../architecture/2026-07-24-project-session-directories.md) and [Harness home resolver](../architecture/2026-07-24-single-harness-home-resolver.md). Those decisions continue to own log storage and Harness configuration; generated work is separate from both. Neither existing decision is superseded.

## Alternatives considered

**One shared temporary directory.** Rejected because unrelated Sessions can overwrite equally named output files and ownership remains unclear.

**Move existing Session files during upgrade.** Rejected because historical prompts, absolute references and explicit workspaces depend on their recorded locations.

**Assign directories only in the Client selector.** Rejected because other Session creation entry points would retain the inconsistent default and each platform could diverge.

## Consequences

Generated work survives application restarts and Session-history deletion. Users remove unwanted folders themselves. The default output location does not restrict explicitly permitted absolute paths or replace the existing filesystem permission policy. Directory creation and Session publication are separate operations, so a failed Agent composition can leave an empty folder. Controller tests cover separate outputs, adoption, explicit projects, concurrent creation, deletion retention and filesystem failures. Packaged native verification remains necessary on each operating system.

The Client excludes blank Sessions whose cwd matches a registered Workspace when resolving **No project**. Session creation can become visible before the Workspace membership update; both observations are needed to avoid adopting a project Session during that interval. The packaged acceptance also copies a V2 log without opening it through the test persistence provider, waits for the running product to publish V3, checks the original bytes, and exercises five real write-tool turns across isolated, reopened, project and migrated Sessions.

Portable native receipts contain only Session directory leaf names, preservation outcomes, migration versions and hashes. All three packaging pipelines use one validator before retaining those receipts; absolute Host paths are excluded.
