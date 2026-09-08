# Desktop 0.5.6 handover

Status: shared implementation validated; native navigation fixture corrected and rehearsed; final native artifacts pending.

## Workspace and scope

Root: `/Users/missher/Documents/ChatGPT/deepseek-harness-desktop-055`, branch `codex/desktop-0.5.6-commander`. Released baseline: `c0b92b1fcc5a6481eb219a8b5e5510980e99bf78`. Desktop target 0.5.6; Harness remains 0.1.3-alpha.1. Root is the only shared-source writer. The model names in the user report were examples.

The implementation covers incremental tight-list Markdown rendering; revision-keyed client-module startup composition; cooperative cold-history cloning; persistent current-session statistics and loading dock; lighter border-l4 outlines; model projection and selection-operation ownership independent of catalog refreshes.

## Verification and limits

GUI: 313 files, 4236 passed and one pre-existing skip. Focused final parser/model/modules/observation suite: 280 passed; non-exempt selected list/observation source coverage is 100%. Desktop/query/version integration: 149 passed. Native helper unit suites: 40 passed. Final full build passed. The full browser lane passed 90 files and failed seven due to intentionally added empty-statistics text; those seven pass in refresh mode with only eleven added placeholder lines. Read-only replay also passes all 23 runnable tests, with one existing skip.

Headless Chromium list streaming frame p95: 33.4 to 16.7 ms on a fixed synthetic fixture. Three alternating fresh-profile embedded-Node startup pairs: ready median 2911 to 2150 ms, with only the candidate client-module host half substituted. The installed application was not edited. These are scoped experiments, not a universal native FPS or launch-time promise.

Long-history clone yielding improves responsiveness but not total duration; parsing/preparation can still block. No permanent Windows whole-window freeze was reproduced. No external model API was called or credential configured.

Documentation: 31 initial doc-sync gates passed; corrected translation-pairing and Agent Note format now also pass. Initial full-lint findings were confined to touched files; targeted corrected checks pass. Exact commands/results are in `.artifacts/desktop-056-*.log` and the shared taskbook is `.artifacts/desktop-0.5.6-task.md`.

Candidate `45853c1ee979ae3b9d917f83d22e15a8a72b3db9` passed the entire Mac native run `34226552460`, including mounted 100%/150% checks and all 36 evidence-file hashes. Windows run `34226556593` passed the shared packaged smoke but stopped in its separate 150% relaunch: the script read a collapsed Workspace before initial Session selection, then clicked after automatic expansion and closed it. A fresh-context DPR-1.5 browser test gates the initial Session list response and reproduces that interleaving. The Windows-owner proposal waits for the existing visible, enabled composer before reading group state, then reuses the shared Session navigation helper. That correction and the complete browser rehearsal pass locally; product code is unchanged. Both platforms must bind the next final artifacts to a new shared SHA. No 0.5.6 tag or Release has been created.

## Platform ownership and next steps

Mac task: `019ffbac-ff3a-7be0-920c-d6bffb1ffcfc`, branch `codex/desktop-0.5.6-mac`, isolated `.worktrees/desktop-056-mac`. Windows task: `019ffc50-8691-7172-a4a7-255199a58fd1`, branch `codex/desktop-0.5.6-windows`, isolated `.worktrees/desktop-056-windows`. Both acknowledged the baseline and supplied diagnosis/review. Mac native file writes from its task encountered scope restrictions; root integrated the shared smoke. Peer worktrees and the installed 0.5.5 app remain intact.

Candidate `ddea0b637ae45cdae215abacbbdd30c20ce52b1d` passed both platform builds and the first durable model switch, then both native runs failed because the smoke expected a same-named project for an Ungrouped Session. Mac run: `34223080078`; Windows run: `34223084008`. No 0.5.6 Release was created. The shared navigation helper now selects visible rows or expands the actual project/Ungrouped bucket. The seed now includes step/start and step/end so statistics reflect complete turns. A local assembled browser rehearsal uses the actual Desktop patch and the exact native helpers; grouped/ungrouped navigation, four route switches, durable readback, 30-to-1-to-30 statistics and four light/dark resting/focused captures pass. The helper unit rerun passes 21 tests with two native-only skips. Product code is unchanged by this correction.

Commit the inspected correction and record one new final SHA. Send that SHA to both fixed tasks; only the commander dispatches validation workflows. macOS workflow id 352101571; Windows workflow id 333831949. Native checks must bind artifacts to the exact same SHA. The user previously authorized a validation-branch push; tag/public Release still wait for both native results. The installer-only scope does not merge main. Installer-only scope remains authorized; do not reintroduce missing API-secret requirements.

The native smoke now also switches routes four times in an existing conversation, verifies durable model/selection events, leaves/returns to the session and restores native-thinker/high. A separate helper checks 30-turn and 1-turn statistics plus actual light/dark 1px resting and 2px focused outlines, restoring the theme. Neither path sends a model request; the existing tripwire remains strict.

After both platform owners report exact-SHA native acceptance, verify names, sizes, SHA-256, update metadata and anonymous downloads before announcing dual-platform delivery. Any later source fix requires a new shared SHA and invalidates both earlier native artifacts. Keep 0.5.5 available until delivery is complete.
