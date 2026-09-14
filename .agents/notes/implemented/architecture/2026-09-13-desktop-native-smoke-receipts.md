# Agent Note: Desktop native smoke evidence

Status: implemented

English | [中文](2026-09-13-desktop-native-smoke-receipts.zh.md)

## Problem

Core chat evidence does not establish plugin recovery. Installed package identity, historical compatibility and owned resource cleanup require separate observations.

## Decision

The [base smoke driver](../../../../apps/desktop/tests/packaged-base-smoke.ts) records the launched package, official runtime inventory, actual legacy data and owned process cleanup. Its [verifier](../../../../scripts/verify-desktop-base-smoke.ts) rejects development stages and incomplete continuation checks as formal package acceptance. Evidence remains bound to the tested bytes; a later source or package change needs matching acceptance.

## Platform baselines

The [shared descriptor](../../../../scripts/desktop-base-contract.ts) pins released Desktop 0.5.5 for Mac and Windows, and released 0.5.7 for Linux, where no 0.5.5 asset exists. Legacy fixtures require the old production application to generate and reopen data through its public APIs. Synthetic plugin probes are labelled as substitutes and cannot prove independent plugin algorithm compatibility. Existing committed Session generations remain byte-checked.

Direct AppImage acceptance records the external image, native executable, kernel mount and complete required runtime files while mounted. It copies those files into a private evidence directory before exit because the runtime mount disappears. Subsequent verification checks both the external image and the copies; the copies are never launched as substitutes for a direct AppImage run. A mount source that cannot be tied to the exact image is rejected pending native evidence.

The [Linux core continuation](../../../../apps/desktop/tests/linux-core-native.ts) reopens the historical Session in the installed application and verifies its official sidebar identity, selected state and original message body. Direct AppImage continuation checks the fresh mount against the recorded required bytes. It rechecks every declared protected file and includes its processes and ports in the core cleanup evidence before verification and uninstall. Plugin recovery remains unrun in this scope.

## Alternatives considered

Version-only checks do not establish installed-byte identity. Treating core chat as recovery evidence omits the recovery sequence. Starting copied or extracted UI files cannot prove a direct AppImage launch. The verifier therefore requires the corresponding package and native observations.

## Consequences

The default full scope requires a separate Bundle failure, pause, CLI change and validated restore sequence. Formal recovery records require an actual native confirmation click. Intercepted dialogs remain development evidence. Native legacy reopening and every owned process and port closing are checked separately; a marker file or a unit-test result cannot replace these observations.

Process discovery failure leaves native quiescence unknown even when the root exits. Settings and canonical profile restoration require a complete observed tree to stop; empty PID inventories cannot authorize restoration. Picker automation waits for its actual child close after errors or deadlines. Display-scale runs pass a fixed 100% or 150% argument directly to the same executable and record native scale, arguments and renderer DPR.

AppImage recovery rebinds each new UI mount to the original external package and required byte inventory. A separately owned read-only mount supplies the public CLI between UI launches. Its actual Linux process identity and mount namespace are checked, and its release joins final cleanup before a passed recovery receipt is emitted. Evidence snapshots are not executed.

Explicit `scope: "core"` in the completion and verification APIs, or `--scope core` in the verification CLI, requires native old-history reopening, chat, restart, cleanup and protected data while allowing only `pauseRecovery: not-run`. It reports `core-passed`, and the CLI names recovery in `unverifiedChecks`; this does not certify plugin recovery. A recovery attempt marker or scenario file prevents excluding that phase. Executed recovery checks still require complete evidence and actual process and port cleanup, and failed or unknown checks remain failures.

The shared startup wait uses the controlled fixture's explicit welcome and credential expectations. A painted composer cannot finish the wait while an expected notice is still loading. The official welcome step precedes DeepSeek credential onboarding; restored keyless fixtures use the normal Continue and Configure later buttons, with viewport hit tests and detached-dialog waits. Unknown dialogs remain blocking, and an inert or masked composer cannot pass its trial interaction. These clicks use the public UI; the smoke driver does not write acknowledgement keys or credentials. Source ordering and unit sequencing checks do not establish that a conditional credential dialog appeared in a native run.
