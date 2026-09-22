# Agent Note: Prove Windows writer-lock contention after exclusive-create denial

Status: implemented

English | [中文](2026-09-22-windows-lock-probe.zh.md)

## Problem

The Windows Desktop Setup lane failed the module-fallback writer-lock test when an exclusive `wx` create returned `EPERM`. The existing probe accepted only an `EPERM` from `lstat` before asking the parent directory whether the exact lock entry existed; Windows can report another transient sharing-denial code while that metadata probe is blocked. The failure log did not preserve the probe's secondary error code, so the exact runner dialect remains unconfirmed.

## Decision

`withFileLock` treats `EACCES`, `EBUSY`, and `EPERM` from the Windows lock-path metadata probe as transient only when the parent directory listing proves the exact `<filename>.lock` entry exists. An absent entry, an unreadable parent, and every POSIX path retain the original exclusive-create error. Focused tests cover the added probe codes alongside existing positive and negative `EPERM` cases.

## Alternatives considered

**Retry every Windows `EPERM` without proof.** Rejected because an unrelated permission failure could be converted into lock contention and hide its cause.

**Treat every metadata error as contention.** Rejected because only the documented transient Windows denial codes are eligible, and the exact directory entry must still be observed.

**Skip the Windows lock test.** Rejected because the test is the behavior contract that prevents module-fallback publication before the shared writer lock is released.

## Consequences

Windows can continue a cooperative lock wait when its metadata probe is transiently denied, while permanent permission failures still surface as the original error. POSIX behavior and stale-lock handling are unchanged. The next Windows CI run must observe whether the runner failure is eliminated; a pass will validate the repair but will not retroactively identify the unrecorded probe code.
