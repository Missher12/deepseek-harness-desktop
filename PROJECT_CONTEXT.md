# DeepSeek Harness Desktop — Project Context

## Current 0.5.7 checkpoint — 2026-09-09

Implemented shared changes: the statistics row retains every metric from the first step and displays known timing before step closure; local exact-model-ID presets fill missing fields without credentials or HTTP, preserve manual changes and discard late results; reasoning defaults to the highest supported level while explicit choices remain authoritative. Desktop metadata is 0.5.7, Harness remains 0.1.3-alpha.1. Linux staging, PNG window icon, sandboxed Playwright launch and the platform package entry are integrated with Ubuntu-owner commits. Nothing has been tagged or released as 0.5.7.

Validation: the first full GUI run passed 4238 tests with 4 skips; its two old statistics expectations were corrected and the two affected suites passed 50 tests. Model adapter/discovery tests passed 191 tests, the complete pi-ai adapter and LLM topology suites had already passed, the preset editor passed 9 tests (including a reproduced late-result adapter-switch regression) and the final discovery suite passed 39. Final official build, client contracts typecheck and full lint passed. The first full browser replay passed 76 files and failed 22 on changed statistics/default-effort output, with dependent fixture-consumption failures after early assertions. The reviewed golden changes are limited to statistics, the preset hint and the initial Max selection. All 22 affected browser files then passed read-only replay: 77 passed, 1 skipped. Generated catalogs and doc typechecking passed. The latest doc-quick run passed 14 gates; its two stale generated-document translation records were corrected, and the full 1234-pair translation check passed. The final model-editor guard also passed owning typecheck and package bundle rebuild. No live provider calls were made.

Local preset lookup measured 9.64 ms for the first lookup including index creation; ten batches of 1000 lookups measured median 35.73 ms and nearest-rank p95 58.69 ms. This is an in-process microbenchmark, not native application startup. No 0.5.7 native startup performance improvement is established. Mac-owner research is saved at /Users/missher/.codex/visualizations/2026/08/13/019ffbac-ff3a-7be0-920c-d6bffb1ffcfc/desktop-057-mac-startup-handoff.md and identifies the missing interaction-ready measurement.

Release blocker: both fixed Mac and Windows tasks acknowledged locally, but their host scopes still point to the retired checkout. Their own reports confirm that the new worktrees are outside writable roots, Mac process inspection is denied, and cross-task reply tools fail with `MCP tool call requires approval, but approval policy is never`. The app read/wait tools incorrectly exposed these turns as empty; a bounded read of their current task records recovered the ACKs and blocker. Do not alter task settings behind the host, write through alternate paths, replace these owners with subagents, or bypass their restrictions. The current commander tools provide no task-permission setter. Restore legitimate workspace/execution permissions before their implementation/native acceptance. Corresponding formal release steps are stopped.

Ubuntu native preflight passed in full: run 34257033770, source 6ea59a79fdd97e7ab559f0d6d6d8affc0ba5a1e8. The same .deb and AppImage bytes passed Ubuntu 22.04 and 24.04 installation, kernel renderer isolation, WM_CLASS, controlled loopback model interaction, complete process cleanup and data-preserving removal. Ubuntu 24.04 kept the system user-namespace restriction at 1; its exact-path AppImage policy also installed and removed successfully. Commander independently verified the four native/sandbox receipts and both lifecycle records; copied evidence is in .artifacts/ubuntu-native-preflight-6ea59a79. These packages still contain 0.5.6 core and are preflight evidence, not final shared 0.5.7 acceptance. Wayland is untested. All Linux implementation commits have been consumed; the Ubuntu task is waiting for the final common SHA.

Shared implementation checkpoint: 9104be331118c0bf61e7607420e197e855bee072 on codex/desktop-0.5.7-commander; local commit only, no final release revision locked. Final model-editor browser replay passed 11 tests after the adapter-change guard. .artifacts/desktop-057-shared-evidence.json records the validation logs and remaining work. Keep 0.5.6 available. Windows installation progress and measured multi-scenario startup optimization remain pending with their fixed owners; restore their legitimate host permissions, complete those tasks, then build and accept all three platforms at one final SHA before publishing formal 0.5.7 together.

## Active Desktop 0.5.7 work — 2026-09-09

The user authorized autonomous completion of multi-scenario startup optimization, Ubuntu 22.04/24.04 x64 .deb/AppImage, visible Windows installation progress, statistics during the first model steps, and exact-model-ID defaults with the highest supported reasoning effort. Preserve manual model overrides. Mac, Windows and Ubuntu must ship together as one formal 0.5.7 release from one final SHA after all native acceptance passes. Baseline: formal 0.5.6 at `0243c6b17803e6714caa28b5ed6636efd5c25483`.

Commander task `01a077a6-7d10-7783-9d81-35d87c2c97b5` owns shared source in `.worktrees/desktop-057-commander`. Fixed native owners: Mac `019ffbac-ff3a-7be0-920c-d6bffb1ffcfc` in `desktop-057-mac`; Windows `019ffc50-8691-7172-a4a7-255199a58fd1` in `desktop-057-windows`; Ubuntu `01a081c3-fca2-79d1-9669-191c9446c159` in `desktop-057-ubuntu`. Branches are `codex/desktop-0.5.7-<role>`. The common taskbook is `/Users/missher/Documents/ChatGPT/deepseek-harness-desktop-055/.artifacts/desktop-0.5.7-task.md`. All three tasks have received it. No owner may modify another worktree or independently publish.

Do not stop installed Harness/Desktop instances or touch MSE/Hermes/plugins. Use owned disposable profiles. Do not request API secrets or make paid external model calls for offline acceptance. Earlier sections below describe prior work and are historical.

## Desktop 0.5.6 performance and interaction — 2026-09-08

Desktop 0.5.5 is publicly released at tag `desktop-v0.5.5`, exact SHA `c0b92b1fcc5a6481eb219a8b5e5510980e99bf78`; both native packages and all five anonymous release downloads passed their recorded checks. The user now requests Desktop 0.5.6: smoother streaming text, faster cold startup and ordinary use, a lighter input outline, a persistent statistics row beneath the composer, and model switching that does not freeze the application. Harness stays at 0.1.3-alpha.1. The user declined repository API-secret configuration for the installer-only delivery scope; credentials and general CI results remain untouched.

The commander is the sole shared-source writer on `codex/desktop-0.5.6-commander` in this checkout. The dedicated Mac and Windows tasks acknowledged clean new worktrees `.worktrees/desktop-056-mac` and `.worktrees/desktop-056-windows`, both at the exact released baseline, on `codex/desktop-0.5.6-mac` and `codex/desktop-0.5.6-windows`. Mac traces startup; Windows traces model-selection freezes; the commander owns rendering, statistics, styling and integration. The shared taskbook is `.artifacts/desktop-0.5.6-task.md`. Development proceeds through measurement, targeted fixes and same-SHA native acceptance; the existing installed app and 0.5.5 assets remain available while the new candidate is developed.

Implemented 0.5.6 candidate: persistent current-session statistics and loading dock, border-l4 resting outlines, a guarded tight-list incremental parser, independent model-selection operation state, cooperative cloning of cold history, and revision-keyed client-module composition reuse. The reported DeepSeek-to-GLM switch was only an example; no fix is provider-name-specific.

Evidence so far: GUI 313 files / 4,236 passed / one existing skip; session-query and Desktop/workflow metadata 149 passed; client-module tests 82 passed. Tight-list Chromium streaming frame p95 improved from 33.4 ms to 16.7 ms on a fixed synthetic fixture; this is not a native FPS guarantee. Six alternating fresh-profile embedded-Node experiments changed only the client-module host half, with ready medians 2,911 to 2,150 ms and no remaining child processes/listeners. Long-history cloning reduces continuous Host blocking, not total restoration time; no permanent whole-window Windows freeze has been reproduced. Baseline installed app is unchanged.

Independent Mac review found no cache-invalidation blocker; Windows review and candidate probes found no new observation ownership/revision/cancellation blocker. The final full build passed. The complete browser lane passed 90 files and initially failed seven on intentional empty-statistics output; the seven affected files pass after reviewing all eleven one-line expected-output changes, and the read-only replay also passes 23 tests with one existing skip. Documentation passed 31/33 gates initially and both corrected note-format/pairing gates now pass. Full lint findings were confined to changed code and corrected with targeted reruns. Expanded native smoke adds repeated cross-provider selection, durable selection reads, current-session statistics and real light/dark resting/focused outline checks; helper tests pass 40/40. The candidate is ready for a final SHA lock and native handoff; neither platform yet has a 0.5.6 native artifact. Platform tasks are preparing bounded smoke proposals; the commander remains the only shared-source writer. Public release awaits both platforms at one final SHA and asset verification.

The first native candidate `ddea0b637ae45cdae215abacbbdd30c20ce52b1d` built on both platforms but stopped in the new navigation smoke: it treated an Ungrouped Session as a same-named Workspace. The corrected test selects the actual row/group; seed step boundaries now enable full statistics assertions. A browser rehearsal over the real Desktop composition passes the exact model-switch and composer helpers, including collapsed project/Ungrouped navigation, four cross-provider changes, durable selection, 30/1/30 statistics and light/dark resting/focused outlines. No product source changed in this correction. Both native runs must restart at the next shared SHA; 0.5.6 remains unpublished.

Candidate `45853c1ee979ae3b9d917f83d22e15a8a72b3db9` passed the entire Mac native run `34226552460`, including mounted 100%/150% checks and all 36 evidence-file hashes. Windows run `34226556593` passed the shared packaged smoke but stopped in its separate 150% relaunch: the script read a collapsed Workspace before initial Session selection, then clicked after automatic expansion and closed it. A fresh-context DPR-1.5 browser test gates the initial Session list response and reproduces that interleaving. The Windows-owner proposal waits for the existing visible, enabled composer before reading group state, then reuses the shared Session navigation helper. That correction and the complete browser rehearsal pass locally; product code is unchanged. Both platforms must bind the next final artifacts to a new shared SHA. No 0.5.6 tag or Release has been created.

## Desktop input contrast close-out — 2026-09-08

The final requested UI scope is visible input outlines and readable placeholder text on both Mac and Windows. The coordinator owns the shared CSS. Desktop input cards retain their soft shadow while drawing a one-pixel theme-aware outline; focus uses a two-pixel business-color ring. The workspace-picker card keeps its dashed outline. Placeholder and ghost-hint text use the secondary label color. These strokes do not change the input layout dimensions. Shared Input primitives follow the same Desktop contrast treatment.

A complete build and the existing elevation-style checks pass. A temporary probe of the actual assembled web application captures both Desktop chrome modes, light and dark themes, and idle/focus states; the Mac owner accepts the three key views. This is browser evidence and does not replace the final platform artifacts. Mac candidate `b58eef3d78d56f852248eceec864f54b9b623988` has been installed and starts successfully with the old bundle preserved; the contrast repair requires the next candidate. Local receipts and current run details are in `.artifacts/20260908-install-and-windows-task.md`.

Windows Search displays the complete application result while its result-region UIA descendants remain unavailable to the existing observation. A separate bounded diagnostic uses the actual Search keyboard launch and verifies the new process path, creation time, window ownership and startup readiness. Its workflow stays on a diagnostic branch and cannot enter the product candidate. Native packaging waits for the integrated final revision. The user requests both-platform completion after this repair, with no additional optimization scope.

The user additionally reports that clicking a piano-rail mark does nothing. A partial history head selects a synthetic process controller as its loaded anchor even though that seat is hidden. The shared navigation projection now excludes the controller while retaining user-message priority and the first loaded content fallback. The focused counterexample fails before the change; 102 related tests and a real pointer scenario across both Desktop chrome modes and narrow layout pass. Both platform packaged smokes now perform the same pointer landing assertion. No event, stored data or public API changes.

## Mac delivery takes priority — 2026-09-08

The user now requests the Mac package first; Windows Search diagnosis is paused and does not block delivery of the accepted Mac DMG. The commander owns the two-file sidebar repair: synchronize the narrow-layout toggle state before browser input with a layout effect, and cover the first real button click immediately after the collapsed layout commits. The original effect fails the controlled Chromium case; the repair and existing delayed-ResizeObserver case both pass, including after a complete build. Mac review finds no source blocker. A fresh Intel Mac packaged run must accept this revision before the DMG is delivered.

The full GUI attempt records 4213 passes, five timeouts in four unchanged files and one skip; those four files pass all 71 tests in a focused run without changing deadlines. Full web replay stops after an unchanged directory-picker fixture creates or selects a directory under the real Home location and cascades through workspace-management cases. This is not a passing full-suite report. The two owning browser regressions pass against the fresh build. Current run records and diagnostic evidence remain in `.artifacts/5cc0ce05-handover.md`.

Windows at `5cc0ce05716218bad637dd1ec790edec7e158c39` passes the renderer 150-percent containment check, then fails the Shell Search observation. A separate published-0.5.3 diagnostic confirms complete query and stable foreground but does not identify the missing result provider. The diagnostic branch is not a release candidate and must not be merged. Required real-API CI still lacks the external repository secret. Main, tags, public Release and the installed application remain unchanged; this stage delivers the Mac artifact first.

## Constructor geometry and Windows CI follow-up — 2026-09-08

Candidate `d70eccc82865d1bd724f647377b724a4a44940e8` passes Intel Mac native run `34187463921`; independent download verifies the DMG at 184161135 bytes and SHA-256 `1599397de4f539f1341305528f2291b184de6d277d861028fc143ba383885f5e`. The Mac owner verifies all 26 evidence files and reviews all 20 screenshots. Windows native run `34187463939` fails with bounds `(1,1,684,482)` against a `(0,0,683,480)` work area. The original requested rectangle is `(1,1,681,478)`. Exact-version Electron/Chromium source arithmetic reproduces the observed growth through constructor size, center and repeated position conversions; it is source evidence, not a native intermediate-step trace.

The commander applies the original full fitted rectangle once after Windows construction, before state writers and visibility. Existing inward rounding space, display selection and strict native containment remain unchanged. Windows releases only a minimum axis whose fitted dimension is at or below its normal 900/620 limit; larger axes retain their normal minimum. This avoids the separate non-client minimum-size conversion clamp. The dedicated Windows task reviews the conversion chain and owns final Windows execution. macOS construction remains unchanged, but both platforms require fresh acceptance at the final source revision.

Windows coverage also reports a Desktop invalid-cache rewrite still reading the creation cut after a five-second poll and Inspector startup receiving `EACCES`. The Desktop fixture awaits the two actual mandatory write promises, preserving its source-log and backup assertions; all 40 cache tests pass locally. Inspector advances nonzero candidates past Windows access-denied port conflicts while preserving other errors and port-zero behavior. A focused Windows error-policy counterexample fails before the repair, 23 related tests pass afterward, and two concurrent independent fixture processes each pass four tests. The original log lacks the starting port, so the specific exclusive-binding or reservation source remains unproven. The host fixture now reports that starting port on failure and owns only its occupied socket; the Worker binds its own next port atomically.

Required real-API checks still lack `DEEPSEEK_API_KEY_EXTERNAL`; no local credentials are read or uploaded. Main, tags, public Release and installed application remain unchanged. Repair validation and exact evidence are recorded in `.artifacts/d70eccc8-handover.md`; the previous Mac pass does not establish acceptance of the next source revision.

## Fractional Windows geometry follow-up — 2026-09-08

Candidate `28f3940d176ee5e6b209017dd6e5d2d12821a222` passes Intel Mac native run `34184655687`; its independently downloaded DMG matches the manifest and sidecar. Windows run `34184655733` builds Setup and passes the visible installer, then reads a 684-DIP native window against a 683-DIP work area at 150% scaling. The strict containment assertion stops later lifecycle acceptance. The native client screenshot and DIP bounds alone do not establish DWM visible-frame overflow.

The commander reserves inward rounding space only for Windows fractional display scaling. Saved-window display selection uses the original work areas before fitting; minimum checks accept already-fitted small windows, preserving secondary-display placement across restarts. Constructor minimums consume the same fitted dimensions. Controlled edge-rounding and secondary-restore regressions fail before their corresponding changes; macOS, integer scaling and normal-screen centering remain covered. This is a scoped correction to the existing work-area change, with strict native assertions retained and both dedicated platform tasks reviewing the same patch. A new final source revision requires fresh same-SHA native evidence on both platforms.

The separate Windows CI fork exit does not reproduce in one diagnostic rerun at the unchanged candidate: all 67 tests pass with one existing platform skip. Its cause remains unclassified; the rerun is not evidence of a source repair or runner fault. Windows coverage passes. Required real-API wheel preflights still lack the repository Actions secret; no local credentials are read or uploaded. Main, tags, public Release and the installed application remain unchanged. Current evidence and exact artifact hashes are recorded in `.artifacts/28f3940d-handover.md`.

## Work-area and native evidence follow-up — 2026-09-08

Candidate `71f6769fe3a66c39e24b819f2e263e3de52f5764` passes Mac native run `34179938012`, Windows native run `34179938007`, and all ordinary CI jobs. Independently downloaded DMG and Setup hashes match their sidecars and run records. Required wheel real-API preflights remain blocked by the missing repository Actions secret `DEEPSEEK_API_KEY_EXTERNAL`; no local credentials are read or uploaded. Manual review finds the Windows 150% initial window outside the screen and incomplete Start/Search screenshots, so automated success does not constitute full visual acceptance.

The commander owns the shared work-area fix and applies the dedicated Windows task's capture recommendations in the commander tree only. Default and fallback bounds fit the primary work area; valid saved windows use the largest eligible visible intersection and move inward; constructor minimums cannot exceed the fitted size. Six targeted counterexamples fail before the fix, and a separate multi-display counterexample prevents first-match placement. First-run packaged checks precede any explicit viewport. Windows 150% acceptance records actual narrow-screen geometry and responsive rail hiding before the independent wide-view rail interaction. The shell capture checks physical visible-frame containment and a complete, uniquely actionable foreground Search result.

Mac and Windows tasks ACK the shared baseline and retain clean isolated worktrees. Local focused tests, documentation and build checks are in progress before a single validation-branch push. New source changes require new same-SHA native runs and artifacts; the downloaded `71f6769f` packages remain previous candidates. Main, tags, public Release and the installed application remain unchanged. Detailed evidence is in `.artifacts/71f6769f-handover.md` and the work-area follow-up logs.

## UI readiness and Windows fixture follow-up — 2026-09-08

Candidate `3803e8d3eeb88b55ddf0ca672ab75082e8cdc205` passes Linux coverage, including the original Python pressure case, and Windows' unchanged Desktop upgrade fixture. Its native workflows fail later UI assertions: Mac run `34124464738` measures a 628-to-680 transcript-width change at 150%, and Windows run `34124464755` reads the current Turn marker before its layout callback. General CI `34124465013` also reports one reference-menu breadcrumb failure, one npm temporary-directory cleanup `EPERM`, and one archived-cache rewrite poll timeout. Neither native run is accepted for publication.

A real Chromium counterexample gates AppFrame's ResizeObserver and reproduces the same 628-to-680 change without mouse input. The shared native helper now waits for the narrow breakpoint's collapsed sidebar before re-expanding and measuring; the strict drag-width assertion remains intact. Windows waits for the current marker inside the existing visibility budget. Pending reference candidates expose `aria-disabled`, and browser interactions wait for enabled options before drilling. The two affected browser files pass all seven cases; MenuView and controller checks pass 96 cases.

The npm benchmark awaits bounded asynchronous removal after child and registry closure; persistent cleanup errors still fail. The archived-cache fixture observes exactly the two automatic production writes, keeps create followed immediately by append, awaits their durability, then checks the original document contents. This replaces a disk-latency poll with the actual completion boundary and exposes write rejection directly. The ordinary Desktop upgrade fixture remains unchanged. All 18 owning benchmark/cache fixture checks pass locally; that is macOS evidence, not Windows acceptance. The same new final SHA still requires fresh Intel Mac and Windows native workflows, complete CI and the missing external-key preflights before main, tag or public Release.

## Ordered checkpoint and bounded metering follow-up — 2026-09-07

Candidate `757d4658173489310bfdec46878cb7b2424095ce` passes the Mac and Windows native workflows (`34117961357` and `34117961464`) and the complete browser/artifact lane. General CI exposes one Linux Python output-pressure timeout and one Windows projection-cache upgrade assertion; both coverage reports otherwise measure every included source at 100%. The real-API preflights remain blocked by the unconfigured `DEEPSEEK_API_KEY_EXTERNAL` repository secret.

The Python child stops counting escapes once a byte lower bound proves overflow. Exact within-budget accounting and the original large-pressure limits stay intact; 277 owning tests pass with two existing platform skips, and the keyless Python PTC profile replays successfully. A controlled Cordis/JSON regression proves that reversed log-flush completion can let a creation checkpoint overwrite a newer one. The shared cache captures state and reserves per-session order before its durability wait, drains accepted writes on disposal and allows unrelated sessions to progress. All 40 cache tests pass with 100% coverage of the changed service. The ordinary Windows upgrade fixture passes locally unchanged; the precise cause of its CI timeout remains subject to the next full Windows CI run. Both platforms must rebuild and accept the new follow-up SHA before publication; the successful 757 artifacts cannot stand in for that candidate.

The Mac owner independently checks 57,821 small metering inputs and finds no budget mismatch; the Windows owner finds no blocking issue in the cache ordering and teardown review. Full lint, duplication and the Cordis inspection replay pass. Documentation checks pass 32 leaves initially; regenerating the source-derived Cordis catalog then passes the remaining leaf, with translation pairing and links rechecked. The original pressure test and immediately appended upgrade fixture keep their existing budgets and behavior.

## Validation follow-up — 2026-09-07

Validation branch `codex/desktop-0.5.5-commander` and PR 34 published candidate `1c4d570c71e197b5134e3f48aa6873c8cd556933`. Mac run `34112657520` and Windows run `34112657489` pass host ABI recovery and packaged-byte protection, then fail the reader fixture's unexpected-request check. The Mac owner reproduced the automatic title request being mistaken for the main reader request through the actual title service and PiAI adapter. Windows also passes its baseline and candidate cold/warm startup samples and visible installer checks; later Quit, DPI and uninstall acceptance remains incomplete. No public 0.5.5 Release exists.

The follow-up admits exactly one main reader request and one precisely identified auxiliary title while retaining the tripwire. Browser tests pin the recorded time zone, exercise the new reasoning disclosure and narrow live card, and keep aborted process evidence visible. ARIA goldens follow actual replayed output, including removed Memory navigation. Cold-history checks read persistence without starting an Agent. The generic-file scenario uses `poem.bin` because text extensions now enter document extraction; its recording changes only that filename and matching paths, retaining model prose, usage, headers and exact stream timing. An Inspector test waits for the Client transport before emitting Console events through its independent Worker channel. Windows fixtures compare the complete canonical path and trigger a portable read error; deletion coverage checks write-claim release when POSIX parent-directory sync fails. The dedicated platform tasks supply text patches and native evidence; the commander remains the only integration writer. Repository live-API jobs still require the unconfigured `DEEPSEEK_API_KEY_EXTERNAL` secret. Every source change requires fresh Mac and Windows native acceptance on one new full SHA before main, tag or Release publication.

## Built-in reading presentation and release preparation — 2026-09-07

The user confirmed that reasoning cards, live streaming, successful-completion process folding and a prominent final answer belong in native Chat. Desktop remains **0.5.5**, with Harness **0.1.3-alpha.1**. The sole shared-code owner is the commander checkout at `/Users/missher/Documents/ChatGPT/deepseek-harness-desktop-055`, branch `codex/desktop-0.5.5-commander`, starting from `ad673a8b816e866b4a3fc3bc743fedbf209f872f`. The official core target remains `d347e703908d0406b7a7ef80e3a0e594d86b2215`. The installed application described below predates the new reading presentation.

### Implementation and verification

Native `ui-chat` owns bounded literal reasoning cards and existing Markdown output. New text appends to a stable Text node; manual scrolling, selection and focus pause following. Completed history and reduced-motion views remain still. Only successful completed Turns fold automatically; cancelled, failed, blocked and other unsuccessful outcomes retain visible process. Selection defers hiding the whole selected Turn until it clears. No external reader, loader, plugin or interactive HTML card is installed, and model prompts and stored responses are unchanged. Both Mac and Windows packaging entrypoints select the official client brand profile.

The assembled browser scenarios pass for built-in reading and native streaming code fences. The reading scenario and both packaged-platform smokes share one UI exercise; a bounded loopback HTTP/SSE provider admits one explicitly armed synthetic Turn, preserves the tripwire for other requests, and passes through the actual PiAi adapter in protocol tests. The 100 reading regressions, 10 protocol/helper checks, 19 Desktop manifest checks, 40 packaging contracts, 40 CI/constraint checks, 25 System Update checks and 69 focused follow-up regressions pass. The official Host/Client build records 239 client artifacts with four official profile values; Desktop staging validates 75 required files. Full lint, the 33 documentation gates, package dependency policy, runtime closure, Client UI localization and workspace constraints pass. Evidence remains private under `.artifacts/`; no external model service was contacted. The package-path checker distinguishes current checkout references from historical URL references; historical documents retain their explicit status and exact release pointers.

### Platform coordination and remaining release gates

The user authorized Git publication and updates for both platforms. Both dedicated tasks acknowledged the shared taskbook, baseline SHA and clean isolated worktrees: `codex/desktop-0.5.5-mac` and `codex/desktop-0.5.5-windows`. Their task permission roots still point at the retired checkout, and both reported denied writes to the assigned worktree and Git metadata. The Mac task confirmed an Intel macOS host and cached Electron; the Windows task found no local Windows host and identified the existing native GitHub Windows lane. These preflight reports are not native acceptance.

The commander branch holds the integration candidate for an exact-SHA handoff. Mac and Windows executor-authored native-test corrections have been integrated only into the commander checkout. A non-publishing Mac validation workflow complements the existing Windows validation workflow; both consume an exact source SHA and retain bounded Actions artifacts. The shared native reading screenshots follow the same bounded evidence collectors. The user explicitly authorized the validation-branch push before native acceptance. Candidate `61297bc42f7c5e0f5b598094a27b9063122acfcd` is published on `codex/desktop-0.5.5-commander` under PR 34. Mac run `34098080225` built the DMG but failed before smoke import because Electron rebuild changed the test host's fs-ext ABI. Windows run `34098080096` built Setup but rejected the historical 0.5.3 baseline under the candidate removal rule. Both platform owners diagnosed these failures; the commander integrated their bounded host-ABI restoration and explicit historical-inventory corrections. Neither run supplies completed native acceptance. No main merge, tag or public Release has occurred in this follow-up. Both platforms must bind their final artifacts and native evidence to one final shared SHA before publication; later source changes invalidate prior artifacts.

The validation follow-up repairs obsolete retired-feature and current-projection expectations, checks archive deletion and recovery failure paths, and covers the built-in compatibility exports. The 96 owning test files pass 1,503 tests; all 27 previously deficient source files reach the repository's per-file 100% coverage thresholds. Registry comparison excludes private Desktop manifests while retaining the public package graph. The Python output serializer preserves exact scalar JSON and existing size budgets while removing repeated scalar encoder allocations; its runtime/protocol regression suite passes 275 tests with two existing platform skips. Repository Actions secrets are absent, so five installed-wheel Python SDK live-API jobs remain blocked at their explicit key preflight. These local and keyless results do not replace either platform's native acceptance or the missing live-API evidence.

## Local alpha follow-up installed and verified — 2026-09-07

The current local installation at `/Applications/DeepSeek Harness.app` is **Desktop 0.5.5 / Harness 0.1.3-alpha.1**. The working checkout is `/Users/missher/Documents/ChatGPT/deepseek-harness-desktop-055`, branch `codex/desktop-0.5.5-commander`, still based on `ad673a8b816e866b4a3fc3bc743fedbf209f872f`. The official core integration targets `d347e703908d0406b7a7ef80e3a0e594d86b2215` (`dsh-v0.1.3-alpha.1`). This paragraph records the earlier local installation. The user subsequently authorized Git publication and both-platform delivery; see the current handoff above. Mac and Windows task worktrees remain untouched. Older sections below describe earlier installations.

### Requested behavior and implementation

- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx` and its CSS remove the transcript width handles, pointer-drag behavior and stored manual width override. The transcript follows its available column; the piano rail retains a 16px outer inset and at least 12px of text separation.
- `packages/client/ui-settings-system-update/src/client/SystemUpdateSection.tsx`, its CSS and locales present a status card, actual installed Desktop and core versions, prerelease labeling, update progress, visible operation errors and release links. Electron retains ownership of checking, downloading and installation.
- The official core uses lifecycle-owned Session handles and format-v2 Assistant stream records. Persistence consumers, archive deletion, usage folding, attachment intake and renderer projections are adapted. Frozen migration validators preserve known Desktop descriptor-v2 and messenger events without accepting arbitrary unknown legacy payloads. Descriptor-v2 history remains readable; the existing descriptor-v3 owner fence still controls automatic continuation.
- `packages/session/usage-insights/src/index.ts` caches the revision observed after migration, bounds concurrent reads, closes read handles and preserves invalidation across restarts and concurrent appends. `fold.ts` handles final Assistant usage and separately billed retry attempts. The cache schema is 3.
- `packages/client/ui-chat/src/client/chat/MessageItem.tsx` connects the preserved incoming relay card to the new keyed context renderer. A regression test verifies visible body/sender and hides the transport envelope. The shared file input supports image previews, local document extraction and generic-file uploads.
- Workbench, BrowserSkill and Open Design remain excluded from Desktop composition. Brain, Memory, Evolution and Media@Missher remain removed from the installed plugin list; independent sources and plugin data are retained.

### Validation

The final official Host/Client build passes; staging validates 75 required files and the packaged inventory contains 13,617 files. The 136-test chat/relay/composer batch, 236 format checks, 52 focused lifecycle checks, 23 width checks and 25 System Update checks pass. Scoped lint and `git diff --check` pass. The final isolated packaged Mac smoke passes in 39.68s, covering history, relay rendering, attachment selection/drop/removal, rail/gutter behavior, settings, usage, plugin market and owned-process cleanup, without a model-provider request. Its image-removal locator follows the alpha UI's specific `Remove image` label.

Installed-app testing reads real history at 100% and 150% zoom: width handles = 0; both former drag gutters leave transcript width unchanged; rail inset = 16px; minimum observed text gap = 12px; composer stays inside its pane. System Update contains two actual installed-version rows and no horizontal overflow at either scale. Usage first becomes visible in 778ms and reopens in 82ms; refreshes settle in 784ms and 170ms. The installed-plugin endpoint returns HTTP 200 with none of the four removed entries. Graceful quit passes. Normal LaunchServices relaunch then reaches Desktop ready in 4.88s and leaves the installed application open (PID 38448, window 7264).

A separate macOS window capture verifies the full System Update page at 150% and confirms pointer hit-testing inside the section. Playwright's CDP screenshots at non-default Electron zoom can be cropped or show stale compositing; use `installed-055-alpha-update-150-window.png` as the visual acceptance artifact, rather than the earlier CDP-only capture.

Current documentation pairing (1,228 pairs), relative links (2,454 files), six generated graphs, API JSDoc, package Model Experience, package documentation structure and subsystem ownership checks pass. The broad `doc-sync` attempt also exposed stale literal file paths in historical `docs/superpowers/plans` after the upstream package split; that documentation-only package-path gate was subsequently repaired and passes on the current checkout. This is not a claim that every repository test or Windows native acceptance passed.

### Data preservation and rollback

Before changing the real data, a private backup saved and hash-verified 5,773 files/links under `/Users/missher/.dsh/backups/desktop-055-alpha-20260907-110651`, including the Harness home and Electron user data. All 91 current Sessions migrated and read successfully in 176.16s. Initial statistics indexing took 7.35s; warmed refreshes took 121ms and 101ms, with zero omissions. The migration adds new canonical generations and retains the original log bytes. Before application launch, only the derived usage cache changed among preexisting files.

After installed native acceptance, every original Session file is still byte-identical. Changes among backed-up files are confined to selected-workspace state, the usage cache, three Session projection caches and the rebuildable module-fallback cache. The NAS configuration and plugin data remain unchanged. An additional older isolated backup retained one already-invalid log with a missing turn-end; the strict reader rejects it rather than fabricating an event. That record is absent from the current 91-Session data set.

The replaced application is recoverable at `/Users/missher/.Trash/DeepSeek-Harness-replaced-alpha-20260907-111113/DeepSeek Harness 0.5.5 core 0.1.2-rc.1.app`. The installed ASAR matches the validated package: `fd181647c0fab1ff51c43058650fa02498a2aa338ea423fa1f8e70ee743007f9`. No tag, push, release, Windows packaging or real model inference was performed.

Evidence: `.artifacts/core-013-official-build-relay.log`, `.artifacts/core-013-stage-relay.log`, `.artifacts/core-013-native-final-acceptance.log`, `.artifacts/package-inventory-055-alpha.json`, `.artifacts/core-013-migration-local.json`, `.artifacts/local-alpha-install-state.json`, `.artifacts/installed-055-alpha-verification.json`, `.artifacts/installed-055-alpha-zoom-native.json`, `.artifacts/installed-055-alpha-update-100.png`, `.artifacts/installed-055-alpha-update-150-window.png` and `.artifacts/installed-055-alpha-usage.png`.

## Local 0.5.5 installed and verified (2026-09-07)

The active checkout is `/Users/missher/Documents/ChatGPT/deepseek-harness-desktop-055`, branch `codex/desktop-0.5.5-commander`, based on `ad673a8b816e866b4a3fc3bc743fedbf209f872f`. The user instructed the commander to implement and verify directly. Both platform task worktrees remain clean and paused. All changes remain local and uncommitted; push, tags, publication and Windows packaging await the user's instruction. Older sections below are historical context, not evidence for this build.

The installed `/Applications/DeepSeek Harness.app` reports Desktop 0.5.5 with the existing Harness 0.1.2-rc.1 runtime. Its ASAR SHA-256 is `fbb701f6f88623ed28128de6d3cf9c3ef7b49975eca505d3f9af34779886bd3a`. The verified local application is also available in `apps/desktop/release/mac/DeepSeek Harness.app`. The complete 13,450-file inventory rejects removed product packages and resources.

### Changes

- `apps/desktop` composition, dependencies, native main/preload, package metadata and staging/inventory scripts exclude Workbench, its browser IPC, BrowserSkill and Open Design. AppFrame has only sidebar, conversation and optional details tracks; stale utility state cannot create a column or drawer.
- TurnNavigator and ConversationRoot reserve a 16px outer rail inset and at least 12px between its longest mark and the text gutter. The installed app's actual history was checked at 100% and 150% zoom: the outer gap is exactly 16px at both scales, with the composer contained in its pane.
- Usage folds reuse one validated calendar formatter and calculate dates only for counted activity, tool calls and valid usage samples. Accounting, revision invalidation, live-event generation checks, concurrent refresh sharing and time-zone semantics are preserved. Profiling traced the previous bottleneck to per-event Intl.DateTimeFormat construction.
- Brain, Memory and Evolution are absent from the application composition and builtin catalog. The real Web profile's Media/Evolution dependencies and bundle references are removed, and Open Design's separate profile and eight application-owned fallback links are archived. The general plugin manager remains usable for later installations.

### Verification and preservation

The relevant 161-test regression batch, 57-test packaging/helper batch and subsequent 18-test inventory/helper checks passed. Full Host/Client typechecking, scoped lint, bilingual pairing and the 2,408-file Markdown link check passed. The official build and 74-file stage validation passed. The isolated packaged Mac smoke passed in 42.35s with native history, turn rail, attachments, usage charts, marketplace, quit and process cleanup; no model-provider request was made by that smoke.

An isolated copy of 121 real Sessions exceeded the old 120s benchmark budget; the optimized cold index took 9.53s, followed by 76–100ms refreshes, with zero omissions. Installed-app testing on the user's actual data rendered the first usage view in 4.94s and repeated views in about 80ms. After a restart and selecting actual history, the first view took 0.80s and the repeated view 80ms, with refresh completed in 191ms. The installed-plugin endpoint returned no entries for the four removed plugins. Native graceful quit and a normal LaunchServices restart both succeeded.

Before installation, 258 Session, plugin-data, archive, storage and configuration files were hashed and remained identical through replacement. Native history inspection subsequently appended Session state while preserving the complete original history prefix; only its projection cache and the derived usage cache changed. Plugin data and release archives remain byte-identical, and the NAS MCP patch is unchanged. The profile uninstall command could not validate the private tarballs against the public registry, so the two-plugin install tree and lockfile were archived locally without relaxing package-manager policy.

Recoverable installation backup: `/Users/missher/.dsh/backups/desktop-055-local-20260907-020916`. The replaced 0.5.4 application is in `/Users/missher/.Trash/DeepSeek-Harness-replaced-20260907-021311/DeepSeek Harness 0.5.4.app`. Independent plugin source repositories and data folders remain available.

Evidence: `.artifacts/local-install-state.json`, `.artifacts/installed-055-first-verification.json`, `.artifacts/installed-055-verification.json`, `.artifacts/installed-055-100.png`, `.artifacts/installed-055-150.png`, `.artifacts/installed-055-usage.png`, `.artifacts/installed-055-plugins.png`, `.artifacts/installed-055-normal-relaunch.png`, `.artifacts/package-inventory-055.json`, `.artifacts/native-smoke.log`, `.artifacts/regression-tests.log`, `.artifacts/final-typecheck.log` and `.artifacts/final-scoped-lint.log`.

## Project Goal

Turn the official DeepSeek Harness browser surface into standalone Intel macOS and Windows x64 applications with a simple Codex-style desktop experience. The user launches the Mac application from Finder or the Dock, or installs the Windows application through one Setup executable, without opening a browser or terminal.

## Verified Baseline

- Target machine: Intel (`x86_64`) Mac running macOS 15.7.4.
- Previously installed runtime: `@deepseek-ai/dsh@0.1.0-rc.6`.
- Desktop source baseline: official repository version `0.1.1-rc.2` at upstream commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- Previous launch path: Hermes gateway → `npm exec @deepseek-ai/dsh web --port 65000` → Node web host.
- Current launch path: `/Applications/DeepSeek Harness.app` → owned bundled CLI → random loopback listener.
- Current UI: React/Vite application with workspaces, sessions, model and permission selection, tools, plans, jobs, settings, a details pane, a Codex-style archived-session manager, and exact session-ID copy actions for active and archived sessions.
- User data root: `~/.dsh`.
- Official source: <https://github.com/deepseek-ai/deepseek-harness>.
- Inspected upstream release: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (`dsh-v0.1.1-rc.2`) on 2026-08-22.
- Upstream currently contains `apps/cli` and `apps/web`; there is no implemented desktop application.

## Confirmed Product Decisions

- Platforms: Intel macOS and Windows 10/11 x64.
- Product name: **DeepSeek Harness**.
- Layout: simple Codex-style three-pane workspace.
- Runtime ownership: the app starts and stops its own Harness; it does not depend on Hermes.
- Data: continue using the existing `~/.dsh` data and credentials in place.
- Transport: the embedded Harness binds to `127.0.0.1` on an OS-assigned random port; users never interact with the port.
- Startup: restore the last workspace and session.
- Scope: reuse the official UI and capabilities; add desktop behavior and targeted Codex-style polish instead of rewriting the interface.
- Installation: Windows uses a visible assisted, per-user, non-elevating NSIS Setup with Welcome, destination, expanded progress/details, and Finish pages plus desktop and Start menu shortcuts; macOS keeps the Intel app and DMG flow.

## Architecture Summary

- Electron x64 application shell.
- Electron main process owns the application window and Harness child process.
- The child runs the pinned official `dsh web --no-open --host 127.0.0.1 --port 0` build.
- BrowserWindow loads only the discovered loopback URL.
- The existing React/Vite client and WebSocket transport remain intact.
- The renderer has no Node integration and receives no credentials.
- Desktop-only presentation changes live in explicit source modules, not injected selectors against minified bundles.
- The packaged app keeps its JS entrypoint in `app.asar` and unpacks runtime `node_modules`, allowing the profile fallback to create valid filesystem symlinks to in-box plugins.
- The preload bridge is one bundled CommonJS file because Electron's sandboxed preload runtime does not execute the main process's ESM format.
- Platform decisions keep macOS close-to-Dock and process-group cleanup while Windows uses a standard frame, close-to-quit, fail-closed PowerShell conflict discovery, and exact-PID process-tree termination.

## Repository Shape

The repository is based on the pinned official source and adds the desktop application without editing installed npm-cache files.

- `apps/desktop/`: Electron main process, preload, lifecycle, packaging, and tests.
- `apps/web/` and `packages/client/`: reused renderer with narrow desktop presentation and command hooks.
- `packages/session/usage-insights/`: privacy-minimal, revision-aware all-history
  usage index and Settings Remote.
- `packages/client/ui-settings-usage/`: localized KPI, activity-chart, insight,
  and feature-ranking presentation for the usage snapshot.
- `scripts/stage-desktop.ts`: creates and validates a self-contained package staging tree.
- `scripts/windows-desktop-setup-smoke.ps1`: verifies isolated Setup install, shortcuts, packaged launch, window close, process cleanup, uninstall, and data preservation on native Windows.
- `scripts/windows-desktop-installer-ui-smoke.ps1`: drives and verifies every visible assisted-installer page on native Windows before cleaning up its isolated installation.
- `scripts/windows-directory-picker-ui-smoke.ps1`: selects an exact isolated folder through the real Windows common-item dialog so the packaged result-decoding path is release-blocking.
- `docs/superpowers/specs/`: product, architecture, and implementation plans.

## Safety Boundaries

- Never copy credentials into the application bundle, logs, fixtures, or commits.
- Never bind the Harness host to `0.0.0.0`.
- Never run two independent Harness writers against `~/.dsh` without an explicit ownership check.
- Do not terminate an existing Hermes-launched Harness automatically during development or testing.
- Use a temporary `DSH_HOME` for automated tests. Live acceptance against `~/.dsh` is a separate, explicit step.
- Preserve the official data format and avoid migrations in version 1.

## Current Progress

- Desktop 0.5.4 was released from exact commit
  `5575ad3a7b17e79ef83abebe07643e82aaec3326` by Desktop Release run
  `33883487169`. The public `desktop-v0.5.4` tag resolves to that commit, whose
  public 0.5.3 parent is `0da8093092c9a29f5cebdfc094d0b58d97b56219`
  and whose history contains the exact official `dsh-v0.1.2-rc.1` commit
  `a66e4702047846cdaa10c66c9d3df3951f5ea70d`. The complete-history turn rail is
  anchored in the transcript's left gutter, away from the composer and right
  Workbench. The responsive Workbench remains the sole Review, Terminal,
  Browser, and Files utility column, while its Plugins page reports the packaged
  BrowserSkill 0.2.0 and the independently installed `open-design` Harness
  profile. The BrowserSkill CLI cache is version-scoped so a pinned upgrade
  cannot collide with an older verified binary. Open Design is not baked into
  the Desktop graph: its official runtime remains owned by that separate profile
  and is detected only when the Plugins page is opened. The composer `@` and Add
  menus put live skills ahead of file/Session references and Goal/Plan actions
  without changing the canonical skill invocation path. Desktop package and
  update metadata are 0.5.4/core rc.1. Startup evidence records six fixed
  path-free Loader details and requires exactly ten samples; local isolation
  points to import/root activation as the bottleneck, but no feature-disabling
  or compile-cache shortcut met the safety and improvement threshold. The
  release run passed native Intel Mac and Windows package, install, lifecycle,
  100/150 percent UI, ten-sample startup, process cleanup, and checksum gates.
  The public Mac DMG is 189153743 bytes with SHA-256
  `a113c509e0b2fbc6b485040ab52f5a185f100736779ddd2e8764413c0330b4ff`;
  the public Windows Setup is 153191816 bytes with SHA-256
  `43d555d5b52f12b062e52a94a4752c0a2fd83ea0f38811f12c3fd4c057d951ef`.
  Both were anonymously downloaded and checked against their public checksum
  files. The verified Intel DMG replaced this machine's 0.5.3 app only after a
  recoverable backup; the independent Open Design profile remained byte-stable
  and its protocol probe passed. Live BrowserSkill control still requires a
  compatible user-authorized extension session and is not started silently.
- Desktop 0.5.2 starts from the released `desktop-v0.5.1` commit
  `b8595d75a9f94fb332689e28aef70cf5b7d72d4f`. Its integrated UI restores the
  v0.4.11 PromptRail against the current `PromptAnchor` data flow, adds
  ChatGPT-like spacing and selected treatment to the existing Project/Session
  tree without changing its semantics, keeps Review/Terminal/Browser/Files as
  vertical navigation inside the existing fixed resizable Workbench, and lets
  an explicit risk-confirmed action switch only the current Session to the
  existing `danger-full-access` preset. Startup evidence now records the real
  profile-compose, loader-mount, loader-settle, and activation-audit phases;
  the measured duplicate fallback work was only 64–66 ms and therefore did not
  justify bypassing validation under the 15% performance threshold. Windows
  packaging prunes only inventoried target-inaccessible assets while retaining
  physical Profile fallback roots, and dedicated Windows taskbar, tray, and
  installer assets leave the Mac icon unchanged. Windows Setup acceptance now
  records installed bytes and inventory hashes, validates shortcut targets and
  icons, captures redacted installer pages, and exercises the installed app at
  Electron 100% and 150% scale. Automated integration gates and final native
  Intel macOS/Windows evidence must still be bound to one exact final commit;
  tags and public release remain owned by the commander. The binding design
  and execution contracts are
  `docs/superpowers/specs/2026-09-02-desktop-0.5.2-design.zh.md`,
  `docs/superpowers/plans/2026-09-02-desktop-0.5.2-interface.zh.md`, and
  `docs/superpowers/plans/2026-09-02-desktop-0.5.2-runtime-packaging.zh.md`.
- Version 0.5.1 is the released parent and upgrade-state benchmark for existing 0.4.10 and 0.4.11 Desktop homes. `healProfilesModuleFallback` recognizes only byte-exact packaged module proxies emitted by those releases, atomically retains them under `$DSH_HOME/recovery/legacy-module-fallback`, and creates the current installation links before the Harness child starts. Unknown or modified real directories remain byte-for-byte and fail loud. Unit and packaged smokes retain this upgrade contract in 0.5.2; final Intel macOS and Windows Setup evidence must originate from one exact final commit.
- The next Desktop branch adds real local document attachments to the composer:
  users can drag or choose PDF, DOCX, XLSX, UTF-8 text, Markdown, JSON, CSV,
  YAML, XML, and a closed shared roster of source-code filenames. Original
  bytes and extracted UTF-8 text are stored as separate immutable SHA-256
  objects. Images and documents share a 296MiB canonical-base64 carrier cap
  beneath the 300MiB HTTP ceiling. PDF parsing runs in a separately bundled
  Worker with a 30-second deadline, a 128MiB V8 old-generation limit, and
  page/item/output work bounds. Prompt projection favors the current and newest
  messages, fits verified text to the exact resolved model context and output
  reserve, and sends neither local paths nor content-address ids to the model.
  Host history/live/queue projections replace durable document ids and digests
  with bounded renderer metadata and process-random display ids before crossing
  into the browser process.
  The user-facing External Brain label is replaced by **Memory & Learning** /
  **记忆与学习** without changing the single local Brain Hub authority. The
  unfinished Browser/Computer Control product remains excluded by exact
  staging and packaged-artifact guards; the ordinary Workbench browser remains
  an unrelated workspace feature. Intel macOS and Windows x64 release evidence
  must still originate from one exact public commit.
- Version 0.5.0 is the public baseline, containing the document
  attachment and Memory & Learning work described above while keeping the
  unfinished Browser/Computer Control product excluded. Version 0.4.2
  previously added a navigation-only prompt ruler that indexes every
  user-message boundary from the immutable history tail,
  renders a bounded left-side rail, reveals localized prompt summaries on
  pointer hover or keyboard focus, and fetches older pages only when an exact
  sequence is selected. It does not delete, edit, rewind, resend, or fork
  history. Custom pi-ai model rows now expose an explicit input-capability
  choice: inherit the catalog or route default, text only, or text plus images.
  OpenAI-compatible discovery adopts only modalities explicitly reported by
  the endpoint and never guesses from a model id or display name. Version 0.4.1
  previously made long reasoning model lists scroll independently from the
  fixed preference footer, coalesced immediate model-directory reads, and
  allowed Desktop warm startup to reuse the module fallback only after
  validating its complete install shape. Version 0.4.0 gave each Desktop-managed
  built-in an explicit mapping from its market-facing package name to the exact
  Loader entry that implements it. Plugin Market now reports Memory, MSE, and
  the Memory & Learning coordinator as live only when their real fibers are up;
  an absent or merely similar Loader name remains restart-required. Packaged
  smoke verifies all three statuses against the same-origin installed endpoint
  on both platforms. Version 0.3.9 previously let manually declared
  models advertise an explicit reasoning capability, including a distinct
  High-only shape that does not invent Low or Medium wire values. The six-step
  Desktop slider keeps the user's visual choice while safely mapping requests
  to an actual Host-advertised effort; up to 64 exact session/provider/model
  visual positions persist in the plugin-owned local profile section across
  remounts, random listener ports, and application restarts. Mac Intel and
  Windows x64 artifacts must originate from the same public merge commit.
- The Desktop 0.3.8 local memory-and-learning stack (internally introduced as the external brain) implements the bounded local scope recorded in
  `.agents/notes/implemented/architecture/2026-08-24-local-external-brain.md`. It keeps project facts in
  `dsh-missher-memory`, procedural learning in the Harness-native
  `dsh-missher-evolution`, and coordination in a new `@deepseek-ai/dsh-missher-brain`
  Bundle. The Brain Hub owns the only injection path and a pathless Settings
  snapshot; Provider failures are fail-open. Memory schema v2 adds FTS5 search
  and reversible automatic consolidation for reviewed memory and
  packages the TencentDB compatibility reader without packaging, writing,
  migrating, consolidating, or learning from a user's live `vectors.db`. The
  immutable Desktop overlay disables matching legacy Profile rows without
  editing the Profile, then mounts distinct Desktop-owned dual-face wrappers;
  this prevents old Profile-local Memory or Evolution packages from shadowing
  either the packaged Host implementation or its Web settings page during an
  application upgrade. Packaged smoke seeds both legacy Host and Web tripwires
  and exercises a real plugin-market transaction before accepting the build.
  The Mac and Windows native packaging plus public artifact verification must all
  originate from the same final shared commit.
- Version 0.3.8 is the previous public baseline. Version 0.3.7 upgrades the managed memory
  fallback to `dsh-missher-memory@0.1.3`, separates ready built-in project memory
  from the optional legacy `vectors.db` source on fresh Desktop installs, and
  preserves the zero-write-before-binding boundary. Usage Insights
  now shares one 12-second cancellation deadline across durable Session reads,
  returns partial cached results when a Session stalls, clears every shared
  refresh for retry, and leaves a first-load renderer skeleton after 15 seconds
  with an honest retryable state. Repeated reads of an active Session now reuse
  a process-local generation-bound row and invalidate it on the next Session
  event, avoiding a full active-log fold without ever persisting a row ahead of
  its durable revision. The Settings shell also owns one 760px page measure and
  one title, intro, and subsection typography contract for built-in, bundled,
  and profile-installed sections. Native Intel macOS packaging, install,
  persisted-data preservation, visual geometry, and repeated-open performance
  acceptance have passed; public-release evidence remains pending. Windows is
  validated and published from its separate platform worktree.
- Version 0.3.6 adds a first-class global Personalization section whose bounded
  Host API owns only a marked block in `~/.dsh/AGENTS.md`, preserves unrelated
  instructions byte-for-byte, rejects stale revisions and unsafe targets, and
  exposes no filesystem path to the browser. The conversation footer now uses
  the current Beijing tariff window, late-bound DeepSeek provider facts, and the
  official read-only balance endpoint; failures keep cost estimates and show an
  explicit unavailable balance instead of fabricating a value. The standalone
  `dsh-missher-memory@0.1.1` bundle is included as an enabled Desktop fallback,
  remains inert until a project is explicitly bound, appears in Plugin Market,
  and is protected from market update, disable, repair, and uninstall actions;
  profile-local installations retain Loader precedence. The 229-test affected
  suite, all 28 documentation gates, full typecheck and lint, official build,
  67-file Desktop staging, and two final isolated native packaged smokes pass.
  The public Intel DMG is 163,728,392 bytes with SHA-256
  `bffc197ca145b3dc7c8262bf8ab5d8878ce05cbe1ebe03f3717b5e9c7b2d7b80`;
  `hdiutil verify`, LF checksum validation, and anonymous public re-download
  byte comparison pass. The installed 0.3.5 application then discovered,
  downloaded, verified, installed, and relaunched this exact 0.3.6 release
  through its real update bridge. The installed executable and `app.asar`
  match the built application, the random loopback Host is ready, and the
  existing `~/.dsh` file count and total byte count are unchanged. Native
  Windows run `32656918392` built from the same tagged source commit
  `a52c03b7c59a454dae2ac50a53115e35e72e0980` and passed 206 focused tests plus
  the visible installer, installed-app lifecycle, personalization, balance
  fallback, memory-market protection, cross-session stop, close behavior,
  shortcut, process-cleanup, uninstall, and data-preservation checks. Its Setup
  is 139,791,104 bytes with SHA-256
  `be8757e794c9532b3aee9eb7280ed5b0db361663dbf0770cb0d84b8e3396e895`;
  anonymous public re-download and the 107-byte LF checksum match the CI
  artifact, and publication preserved all three Mac asset identities.
- Version 0.3.5 keeps the existing 53×7 particle
  geometry and daily heatmap semantics, but gives weekly and cumulative filled
  particles logarithmic relative intensity levels from 1 through 4 instead of
  painting every non-zero aggregate at the strongest color. This changes only
  visual emphasis: row counts, token totals, hover facts, and daily particles
  are unchanged. Desktop startup now uses one shared white DeepSeek loading
  document on macOS and Windows, and the later Web-plugin boot surface recognizes
  the explicit `surface=desktop` marker on both platforms; ordinary browser Web
  sessions retain the generic Harness spinner. The expanded affected regression
  suite passes 68 tests across Usage, boot-page, Desktop lifecycle, window, and
  release-version paths; full-repository lint and the Host, Client, Web, and
  Desktop-main production builds also pass. Desktop staging validates 67 required
  files. The isolated native packaged smoke passes against the final unsigned
  Intel application, whose bundle and executable report `0.3.5` / `x86_64`; it
  shuts down its complete process tree and random listener. The verified DMG is
  `apps/desktop/release/DeepSeek-Harness-0.3.5-mac-x64.dmg`, 163,661,182 bytes,
  with SHA-256 `dfa4b1f27ac3ff2235f67105b065be25465b701ea3be88956efbe2d0b1120852`.
  `hdiutil verify` and the LF-only 101-byte checksum both pass. Native Windows
  Setup acceptance must still be produced on Windows; no Windows artifact is
  inferred from this macOS build.
- The 2026-08-23 source candidate adds an explicit stop boundary to the existing
  transcript-only cross-session messenger: either participant can stop one
  receipt-linked collaboration chain, all unresolved deliveries and waits settle
  as `collaboration-stopped`, later replies/continuations are rejected, and a
  fresh user-directed send starts an independent chain. The existing outgoing
  conversation row gains only a compact Stop/Stopped action; no drawer, card,
  side-chat surface, background Agent loop, or second message archive was added.
  Desktop General Settings now persist an owner-only close preference and a
  tiered-price-estimate switch under Electron `userData`. macOS defaults to
  keep-running and Windows defaults to quit; Windows creates a Show/Quit tray
  only when keep-running is selected, while explicit Quit always performs the
  bounded Harness shutdown. The conversation footer keeps its performance line
  and adds settled latest-turn cost, session estimate, exact provider balance,
  and the current official pricing tier on a second line. Disabling estimates
  hides both local estimates and the tier while retaining exact balance. These
  passed 201 focused cross-session/Desktop/billing tests, 40 packaged-helper and
  manifest tests, affected production builds, full-repository lint, bilingual
  contract pairing, 67-file Desktop staging, and the isolated native Intel Mac
  packaged smoke. The native smoke verified preference round-trips, hide-on-close
  with the Harness listener still owned, window restoration, explicit bounded
  quit, and complete process/listener cleanup. Windows code and the same native
  smoke contract are synchronized, but native Windows Setup/tray acceptance has
  not run from this source candidate. No release version or public asset is
  implied here.
- Version 0.3.4 is the current verified cross-platform release. The stable
  `Low / Medium / High / XHigh / Max / Ultra` reasoning ladder still maps every
  visual stop to an exact Host-advertised effort and still displays the model's
  separate capability limit, but the selected value no longer appends
  `actual …` / `实际 …`; visual and accessibility value text use only the clean
  display label. High-only Ultra still submits High, and Low can still submit
  Off where the model capability requires it. The shared Mac/UI source landed
  as public main commit `3c3f72c8565be8c76df465ab36ebc7efd9ec378a`.
  Windows standard-frame windows had also inherited the Mac-only 38 px
  hidden-inset drag strip: native RED run `32554789168` measured
  `sidebarTop=38`, `padding-top=38px`, and a 38 px pseudo-element. The Desktop
  renderer URL now marks `titlebar=hidden-inset` only for the actual macOS
  hidden-inset window, and the Web surface applies its inset only for that
  trusted marker. Windows therefore keeps the standard native frame with no
  renderer inset while macOS retains its drag strip. PR #20 squash-merged this
  fix as public main commit `fb8dc97c368417edd4420a493b32cb280ffc8fc4`.
  Final native Windows Setup run `32558492256` passed the visible installer,
  installed-app lifecycle, Ultra→real-effort fallback, directory picker,
  clipboard, process cleanup, uninstall, and isolated data preservation; its
  packaged geometry is `frameTop=0`, `sidebarTop=0`, `padding-top=0`, with no
  drag pseudo-element. Full Windows CI run `32558492405` passed all 46 native
  gates after the SQLite retry pacing test stopped advancing unrelated fake
  timers. Release `desktop-v0.3.4` now contains
  `DeepSeek-Harness-Setup-0.3.4-win-x64.exe`, 139,705,330 bytes, SHA-256
  `46671cd4be4533196a1e0e939494e8e69797f9ccc71acd9917b5f162ba84b28a`,
  plus its 107-byte LF checksum. Anonymous public re-download matches both
  exact files. The final 16,656-entry Setup scan contains no private config,
  secret-like value, or personal path. Windows assets are IDs `524796800` and
  `524796801`; the existing Mac DMG, checksum, and updater-manifest assets keep
  IDs `524704681`, `524704689`, and `524704688` with their original bytes and
  digests. Package and updater metadata remain bound to Harness `0.1.1-rc.2`.
- Version 0.3.3 is the preceding verified Intel-macOS release. It applies the
  complete official `dsh-v0.1.0-rc.8` → `dsh-v0.1.1-rc.2` source delta while
  retaining the Desktop shell, workbench, plugin market, reasoning-effort,
  usage-insights, session-messenger, archive, updater, and DeepSeek billing
  additions. The official session-projection API now requires persisted state
  schemas and explicit wire views; the custom billing-model projection has
  been migrated to that contract and is versioned with the other token-meter
  projections. `apps/desktop/update-metadata.json` binds the candidate to
  Desktop `0.3.3`, Harness `0.1.1-rc.2`, Intel macOS, and the release channel.
  A failing migration assertion first pinned the required 0.3.3/rc.2 pair;
  after the minimal manifest change it passed, as did 20 focused token-meter
  projection tests, 207 merge/conflict-impact tests, and the full Host/Client
  typecheck. The raw full-repository test run saturated the Intel host and
  timed out 31 files; its two deterministic manifest/version failures were
  fixed, then every affected path passed under a one-worker budget (527 passed,
  2 platform-skipped). Final validation passes lint, the Host/Client/Web
  production build, all 28 documentation gates, 187 updater/custom-feature
  assertions, and 10 readiness/process assertions. Packaged smoke first caught
  the rc.2 boot-manifest assignment change; a regression test now proves the
  Desktop probe accepts both the legacy `window.__DSH_BOOT__` assignment and
  rc.2's `globalThis["__DSH_BOOT__"]` assignment, and the rebuilt packaged
  application passes its complete isolated smoke. The unsigned Intel DMG is
  163,638,106 bytes with SHA-256
  `803810e8767ed86514368906782d0a80c0bed54907973f84ff57eb8edf0167fa`;
  `hdiutil verify` passes, the bundle reports Desktop `0.3.3`, the packaged
  executable reports `x86_64`, and the embedded Harness reports `0.1.1-rc.2`.
  PR #17 was squash-merged as public main commit
  `927a5f7c999a3074496ac3b0274fc8dcc35ead75`; tag and Release
  `desktop-v0.3.3` point to that exact application tree. The public DMG asset
  (ID `524615247`) is 163,638,106 bytes and its anonymous proxy-assisted
  re-download matches the local candidate byte-for-byte and passes the
  101-byte LF checksum. The public updater manifest (ID `524615248`) also
  matches the local 378-byte manifest exactly. The already installed 0.3.2
  application then displayed the real `Download update` action, progressed to
  `Restart and install`, verified the public DMG SHA-256, invoked the native
  rollback-capable helper, and relaunched `/Applications/DeepSeek Harness.app`
  as Desktop `0.3.3`, `x86_64`, with embedded Harness `0.1.1-rc.2`. The live
  `~/.dsh` aggregate remained 98 files / 8,972 KiB before and after replacement,
  and the custom Usage, Evolution, Plugin Market, and reasoning controls
  remounted on the upgraded core. The old 0.3.2 single-stream GitHub transfer
  became CDN-throttled during acceptance, so the final UI/hash/native-install
  leg reused the separately anonymous-downloaded, byte-identical public DMG
  through a temporary exact-URL bridge; this did not bypass the updater's byte
  count or SHA-256 checks. Normal Finder launches do not inherit the temporary
  proxy environment, so persistent application-level proxy selection and
  concurrent download acceleration remain future work. This Mac task did not
  build, replace, or publish Windows assets; Windows remains at the separately
  verified Desktop 0.3.2 release.
- Version 0.3.2 was the preceding Intel-macOS release. The composer `+` now
  opens one compact Codex-style Add menu over the existing input-trigger
  pipeline: files/folders reuse `@` references, images reuse the existing
  attachment intake, Goal and Plan are promoted without duplicating their
  command implementations, every remaining command is preserved, and current
  callable skills appear under Plugins. Image is omitted when the active
  composer has no attachment capability. The reasoning plugin now presents a
  stable six-stop `Low / Medium / High / XHigh / Max / Ultra` ladder and maps
  each stop to an exact Host-advertised effort; visual stops above a model's
  limit converge on that real limit (High-only Max/Ultra submit High), while a
  model with no positive reasoning capability remains explicitly unavailable.
  The candidate also preserves live workbench width across every utility-mode
  switch, overlaps safe startup discovery with local loading, and unifies the
  white native/Web loading surfaces around the official app icon. Final local
  acceptance passes 51 changed-surface test files / 705 tests, 28 / 28 full
  documentation gates, full-repository lint, the production Host/Client/Web
  build, and the isolated native packaged smoke. The x86_64 application is
  installed in `/Applications` as 0.3.2 without changing `~/.dsh` at the
  installation boundary. The verified DMG is
  `apps/desktop/release/DeepSeek-Harness-0.3.2-mac-x64.dmg`, 163572840 bytes,
  SHA-256 `4bd4ef106ba018b2a99cab95ecf243989f25effeb3ee533b8f9988d80fe19944`;
  its checksum and updater manifest validate locally and after anonymous public
  re-download from `desktop-v0.3.2`. A real installed-app update from 0.3.0
  completed the visible check, download, SHA-256 verification, restart, and
  replacement flow, then relaunched `/Applications/DeepSeek Harness.app` as
  0.3.2 x86_64. The `~/.dsh` file/directory counts remained 97 / 103 across
  that update; two runtime-managed links were added and no data tree was
  copied or deleted by the installer. The verified 0.3.0 DMG is also published
  as a normal historical Release with its checksum and updater manifest. The
  verified 0.3.1 DMG is published only as a prerelease archive: it was a local
  transition build without a separately reproducible source commit, so it has
  no updater manifest and must never enter automatic update selection. Public
  re-downloads of both historical DMGs match their local byte counts and
  SHA-256 values. Windows x64 is synchronized with the same 0.3.2 product at
  public main commit `bf5d1805a0fb14e614a1438bc5ba49d9f9e93caf`. Native
  Windows run `32456696621` passed the assisted installer pages and the full
  installed-application lifecycle, including exact active/archived Session ID
  clipboard behavior, refusal feedback, the native directory picker,
  PowerShell workbench, process cleanup, uninstall, and isolated data
  preservation. The published Setup is
  `DeepSeek-Harness-Setup-0.3.2-win-x64.exe`, 139639588 bytes, SHA-256
  `816a6ce48b96d2fcfebbe42d4c962b2b29df9a0d5e4e028bcac8f471302f1542`;
  its 107-byte LF-only checksum and Setup bytes match an anonymous public
  re-download. The NSIS archive and its `app.asar` contain no `.env*`,
  `.credentials.yaml`, or `.dsh` paths. The three existing macOS Release
  assets retain their original IDs, sizes, and digests; the macOS updater
  manifest remains macOS-only.
- Version 0.3.0 adds the removable Intel-macOS Codex-style workbench opened by
  one compact button beside Session log. Its bounded 320–720 px utility panel
  contains a separately owned Terminal, an isolated native Browser, read-only
  Files and Git Review modes. The duplicate Side Chat surface, its component,
  styles, service dependency, and utility mode were removed; cross-session
  messages still append visible source and target chat rows while retaining
  receipt-bound delivery through requests made in the ordinary composer. The
  former standalone messenger trigger and drawer remain unmounted.
  The Terminal is limited to four shells, 16 KiB input, and 1 MiB retained
  output and is terminated on mode close or plugin disposal. The Browser allows
  HTTP(S) only, denies popup, download, and permission requests, and destroys
  its sandboxed native view when closed. Files and Review canonicalize the
  live session workspace, reject traversal and symlink escape, and cap text and
  diff previews at 256 KiB. Reasoning uses a bounded typewriter reveal with no
  sweep effect and flushes for settled, expanded, hidden, or reduced-motion
  states. Only Desktop composition mounts the workbench; ordinary Web remains
  unchanged. Public main baseline
  `59058b0173b1f2b9447fef89f4312303eb2de200` is merged as the second parent,
  retaining its no-browser-handoff startup parsing, macOS-only updater bridge,
  packaging exclusions, and runtime hardening. Mac Desktop packaging now uses
  the existing official Client profile, so the official DeepSeek Harness brand
  occupant replaces the local fallback and its clipped commit badge. The final
  build record is bound to source commit `c8e556cffad6bd67d543612065efc605325bf21a`.
  The synchronized unsigned Intel DMG is 163,555,915 bytes with SHA-256
  `5c306c58b8e733b25baddac1f2f711ff97e350138945f5c10b64d569d2bde633`;
  `hdiutil verify` passes and the packaged application reports `0.3.0` / `x86_64`.
  Brand/profile regression passes 3 files / 26 tests; the affected Workbench,
  Layout, Messenger, and Desktop regression passes 13 files / 115 tests; the
  two affected TypeScript project builds pass. The complete official Host,
  Client, Web, Desktop-main, 67-file staging, and DMG builds pass.
  The isolated native packaged smoke passes the ordinary and archived
  clipboard paths, visible cross-session chat rows, a real workbench terminal
  command and teardown, all four workbench modes with no Side Chat tab,
  reasoning effort, Usage
  Insights, System Update, Plugin Market, provider isolation, random-port
  ownership, and final process cleanup. The synchronized application is
  installed and running at `/Applications/DeepSeek Harness.app`; its owned
  Harness returned HTTP 200 on random port 58995. The installed and final
  packaged `app.asar` share SHA-256
  `c89e2078391bae97ef9523201ad8c392dad7e79bc36714e2ced5548b070fc7eb`.
  The live 97-file `~/.dsh` aggregate remained
  `8195253bdf6de8b0beb2cd4c18195f44514a73633fa8df890ab01ab4f2841850`
  before replacement, after replacement, and after launch. The previous 0.2.2
  application is recoverably retained at
  `~/Library/Application Support/DeepSeek Harness Backups/DeepSeek Harness-0.2.2-pre-0.3.0-20260821-020107.app`.
  The pre-final-layout 0.3.0 application is retained beside it as
  `DeepSeek Harness-0.3.0-pre-final-layout-20260821-022529.app`; the immediately
  preceding 0.3.0 application is retained as
  `DeepSeek Harness-0.3.0-pre-main-59058b0-20260821-042841.app`; the immediately
  replaced build is retained as
  `DeepSeek Harness-0.3.0-before-brand-sidechat-20260821-094826.app`. No Windows
  build or public GitHub release was produced for this synchronization task.
- Version 0.2.2 replaces the rejected macOS startup artwork with the approved
  Codex-like A direction. The local Electron phase is a network-free centered
  DeepSeek whale, title, status, and five-pixel indeterminate bar because Host
  startup has no truthful denominator. The following Web phase is selected
  only by `?surface=desktop` plus a macOS user agent and reports the existing
  monotonic active-plugin count as a real percentage; ordinary Web and
  non-macOS surfaces retain the generic circular loader, and plugin failure
  still replaces progress with the kernel-owned report. Focused regression
  passes 46 files / 378 tests, explicit Host, Client, Web, and Desktop-main
  production builds pass, and browser visual acceptance passes at 736×480 and
  360×480 without clipping or progress overflow. The final unsigned Intel DMG
  is 163,541,739 bytes with SHA-256
  `f6ec1b99261bc1e8e9494dcdd13eddeba24bc028aa14c1f13fa295aa7b09c96b`;
  `hdiutil verify` and the isolated native packaged smoke pass. The exact final
  candidate and installed `app.asar` share SHA-256
  `22fc5a5200c3784d184974f1fdaa4a27982be20f77ba1bba10c93b6b11ce7f01`.
  `/Applications/DeepSeek Harness.app` reports `0.2.2` and `x86_64`, launches
  its owned `--no-open --host 127.0.0.1 --port 0` child, and returned HTTP 200
  on the observed random port 63641. The exact 63-file `~/.dsh` aggregate hash
  remained `6b1cda7016342b9de37c85e760c95802f2e1941e8c5d1456a9621ca089dcf76d`
  across final installation. Recoverable application backups remain in
  `/Applications`; no Windows build or public GitHub release was produced.
- Version 0.2.1 fixes the Windows false startup failure by disabling the CLI's
  default-browser handoff and accepting exactly one valid loopback URL while
  ignoring other `dsh web:` status lines. It also replaces the directory
  picker's unsafe fixed-size native memory view with Koffi's NUL-terminated
  UTF-16 decoder, covering the fatal `readUtf16` crash observed after a folder
  was selected. Native Windows acceptance now selects a real isolated folder
  through the installed application in addition to installer, clipboard,
  process, uninstall, and data-preservation checks. The root Harness version
  remains `0.1.0-rc.8`; only the Desktop artifact version advances to `0.2.1`.
  This standalone public repository now defaults its required CI lanes to
  GitHub-hosted `ubuntu-24.04` and `windows-2025` runners; the existing explicit
  self-hosted failover selectors remain available. This prevents release
  checks from waiting forever on upstream-only enterprise runner labels.
  Windows does not expose or invoke the macOS-only update bridge; Windows
  upgrades remain explicit Setup installs. Desktop packaging keeps its narrow
  runtime allowlist and now also excludes `.env`, credential, and `.dsh`
  paths explicitly. The final local candidate passes all 37 static gates, all
  10 consumer/build gates, 124 Desktop tests, and the complete 14,483-test
  coverage gate at 100% statements, branches, functions, and lines. A clean
  native Windows Setup build and installed-app lifecycle smoke remain the
  release authority for this commit. The final hosted-CI repair also makes the
  persistent PowerShell terminal answer cursor-position device queries, waits
  for the private OSC prompt instead of matching its echoed `dsh> ` source,
  and defers Linux exact-wait fallback until output is quiet. Once that private
  prompt is established, PowerShell silence alone can no longer release a send
  slot before delayed output; startup retains the bounded fallback needed to
  establish the first prompt. The serialized persistent PowerShell tool may
  also opt into that fallback because its independent random completion marker,
  rather than terminal settlement, is authoritative for command completion.
  A portable pwsh 7.6.5 run passes the real persistent-state, UTF-8,
  large-output, exit/restart, and ACP snapshot scenarios. Browser steering
  snapshots now anchor on the open question
  composer instead of runner-dependent intermediate timing, and the HMR
  browser gate gives only its cold watch build bounded hosted-runner headroom
  while retaining the existing source-update deadline. The
  four-core Windows hosted lane now uses a bounded 3-partition/2-gate budget so
  subprocess and worker timing tests are not starved by the coverage
  coordinator.
- Version 0.2.0 rebased the Desktop product on official `dsh-v0.1.0-rc.8`
  while retaining the current macOS/Desktop feature set. It adds a native
  Windows assisted installer whose ordinary double-click flow exposes Welcome,
  installation directory, expanded progress/details, and Finish pages while
  remaining per-user and non-elevating. The root Harness version remains
  `0.1.0-rc.8`; only the Desktop artifact version advanced to `0.2.0`.
  Host/Client typecheck, the complete Host/Client/Web production build,
  85 SQLite persistence tests, 28 installer/staging contract tests, and a
  63-file Desktop staging closure pass locally. Native Windows UI, clipboard,
  install lifecycle, public artifact, and SHA-256 acceptance remain required
  on the final committed source.
- Version 0.2.1 adds a Desktop-only **System Update** for macOS while leaving
  the already-published Windows 0.2.0 release untouched. The updater is backed
  by fixed GitHub endpoints, a 24-hour cache, ETag revalidation, strict release
  manifests, bounded downloads, SHA-256 checks, x86_64 bundle and packaged-
  metadata verification, and a detached same-parent installer with backup and
  rollback. Official Harness tags remain informational; only a compatible
  Desktop DMG can authorize installation. Marketplace install and update also
  snapshot `dependencies` and `dsh.profile.bundles` together and restore both
  on failed, cancelled, timed-out, stale, or rejected operations.
  The integrated Intel Mac build, verified DMG, packaged smoke, native
  replacement, random-port startup, and no-browser-handoff checks pass locally;
  public Release download and updater-discovery evidence remains to be produced.
- Version 0.1.9 consolidated the earlier macOS/Desktop work: the separate
  session-communication trigger and drawer are removed, session-messenger
  relays render directly in the ordinary chat timeline with source
  attribution, Settings uses one stable 1040px responsive width, the archive
  manager has room for its three row actions, and the reference-style Plugin
  Market, Usage skeleton/cache, macOS startup reveal, and eight additional
  built-in role presets are included. The composer stats strip estimates cost
  only for a single identified official DeepSeek V4 route using the current
  Beijing-time peak/off-peak prices; the optional account balance uses a
  read-only, capability-gated same-origin bridge restricted to the official
  DeepSeek endpoint. The focused 208-test suite, 31-test preset E2E, 6-test
  built-Web E2E, 28-test release-workflow gate, full Host/Client/Web production
  build, lint, 62-file Desktop staging, isolated packaged Electron smoke, and
  `hdiutil verify` pass. The unsigned Intel DMG is 163,392,392 bytes with
  SHA-256 `c6b360e08c221ee7afa452b84e0f7ab2e6670b042cfafd4d382dcd35fdf4af0f`;
  the packaged application reports `0.1.9` and `x86_64`. Native Windows Setup
  acceptance and public Release publication still require the final committed
  source.
- The 2026-08-20 internal macOS build replaces the Plugin Market's legacy
  card/category rail with the accepted reference-style surface: full-width
  functional search, installed-plugin icon rail, Public and Personal modes,
  grouped Featured/category sections, and flat two-column rows with exactly
  one trailing Install or overflow action. Personal is deliberately limited
  to installed dependencies whose durable spec starts with `file:` or
  `link:`; the gear menu retains installed/update/activity/theme/group and
  backup/recovery management. Every Settings section now uses the same 1040px
  responsive panel width, so navigating between General, Models, Usage,
  Plugins, Agent presets, and Plugin Market no longer resizes the dialog. The
  focused layout/artifact/manifest/Settings suite passed 52/52, the isolated
  packaged Electron smoke passed, and the verified x86_64 0.1.8 bundle was
  installed at `/Applications/DeepSeek Harness.app`. The replaced bundle is
  recoverably retained at `/Applications/DeepSeek Harness.app.backup-20260820-025949`;
  no GitHub upload or public release was performed.
- The 2026-08-20 internal macOS candidate keeps the original Standard, Code,
  Minimal, and Creator presets and adds Planning, Frontend and UI, Backend and
  API, Troubleshooting, Code review, Testing and QA, DevOps and release, and
  Documentation and research. All 12 presets remain manually selected through
  the existing composer and Settings controls; no automatic classifier or
  router was added. Execution-oriented roles retain the normal tool surface,
  while focused planning, review, and research roles omit background-job,
  delegation, and workflow tools. These prompt/tool presets guide behavior but
  are not treated as a security boundary. The x86_64 `0.1.8` candidate passed
  configuration, localization, Host behavior, browser-selection, typecheck,
  lint, translation-pairing, packaging, and isolated packaged-app smoke gates;
  it was installed to `/Applications/DeepSeek Harness.app` after moving the
  previous application bundle to a timestamped per-user backup. The installed
  bundle contains all 12 preset snapshots and starts its owned loopback Host.
- The 2026-08-19 internal macOS candidate adds a Darwin-only Endfield-inspired DeepSeek-blue startup reveal that overlaps the first real application render and exits directly into the page; it does not add a second window or delay Host readiness. Usage Settings now paints a dimensionally stable structural skeleton on first read, keeps the last immutable in-process snapshot on revisit, and refreshes it in the background. The pinned `dshmarket@1.10.1` patch uses the accepted B2 single-row hierarchy, keeps plugin name/category/Install/icon-only More aligned on the first row even at narrow Settings widths, and paints an immediately visible blue initial tile underneath asynchronously decoded owner images. The composer strip now prices the complete durable token ledger only when the durable billing-route projection identifies one supported official DeepSeek V4 model, and exposes the exact account balance only through the optional official-endpoint, read-only, capability-gated same-origin bridge. This is local tuning only: no GitHub upload, public release, application replacement, or live `~/.dsh` acceptance is authorized.
- The 2026-08-18 Usage section is implemented between Models and Plugins. It
  summarizes all durable root, archived, and subagent Sessions with five KPIs,
  one stable Sunday-aligned 53×7 particle field with a daily calendar heatmap,
  bottom-up weekly/cumulative particle stacks, scope-specific rounded hover
  copy, an all-history baseline that keeps the final cumulative column equal to
  the headline total, activity insights, and a truthful
  Skill/Tool feature ranking. The Host keeps only derived identifiers and
  counters in a revision-aware cache; prompts, replies, tool payloads, titles,
  paths, attachments, and credentials never enter that cache. Host, Client,
  Settings, Remote, and bundle-focused tests pass. Packaged Intel macOS
  acceptance also passes against isolated data, including all 371 particles
  and the daily, weekly, and cumulative hover semantics.
- Read-only local runtime audit complete.
- Official source and architecture audit complete.
- Electron x64 application shell, native menu, loading/failure surfaces, random-port runtime ownership, window-state persistence, and the accepted cross-platform icon master complete.
- macOS and Windows share the exact 1254×1254 RGBA icon master (SHA-256 `1fe0c2a3b6475c451f86dc999e97de33e4aabace244e35a284d1c5e162b0672a`); the generated macOS `.icns` and Windows `.ico` have SHA-256 values `d453a58a11cb5247f83f3b220bca2c6f0f216f07a6c7dfbb4998bb9f9f72c54e` and `2331df774341ce7796c1c0d06e708ae37bbde84a53e4edd2741659bbe8d4e4ae`.
- Desktop renderer styling and command hooks complete.
- The 2026-08-18 source candidate keeps the default-off ordinary reasoning thumb fully inside both track endpoints and reflows the embedded Plugin Market from its real Settings container width. Every registry category stays in stable source order on one horizontally scrollable rail; selection never moves chips, edge controls and fades reflect the true scroll bounds, search and filter use a separate row above the category rail, and narrow plugin actions stay aligned with the title row. The pinned market Client artifacts were rebuilt from upstream `v1.10.1`; final 0.1.8 staging and the isolated native packaged smoke refreshed the geometry evidence after the collaboration changes.
- The 2026-08-18 Desktop startup path now overlaps the local loading surface with the read-only ownership check, then starts Harness as soon as that check clears while the loading surface finishes. The same-home writer gate, complete Harness readiness probe, failure surface, and owned-process cleanup remain mandatory. A lifecycle regression test and the complete isolated packaged macOS smoke passed. Comparative live timing was not accepted on the installation host because unrelated processes saturated CPU during the run.
- The apparent session-messenger mark-read mutation was a smoke-fixture race, not an acknowledgement write: preserved failed logs contained only delayed selected-Session policy restoration. The fixture now seeds the current permission, sandbox, and approval records before its final end-seed and waits for protected storage to settle on both sides of copy and acknowledgement actions. Three consecutive complete packaged smokes passed with exact protected-file equality, and the final 0.1.8 packaged candidate repeated the complete isolated smoke before installation or publication.
- The model-control visual experiment was removed on 2026-08-17 after user acceptance rejected it. The original simple Host-advertised effort rows are restored, with no canvas, particle renderer, aliases, or invented effort ids.
- Version 0.1.5 reintroduces the requested richer control as the removable `@deepseek-ai/dsh-reasoning-effort` plugin instead of another core UI fork. It uses Host-advertised values, a down-first adaptive portal, HanaAyane's pinned attributed Canvas effect, and a profile-backed character opt-in that defaults off. Desktop dependency, immutable patch, duplicate-original/fork preflight, staged Host/Client/license/notice/sprite closure, and generated root attribution are integrated. Native packaged acceptance proves direct High startup, High-to-Max persistence, down-first/adaptive placement, non-empty Canvas pixels, and the default-off character; separate light/dark/200%/reduced-motion visual sweeps remain future evidence.
- Desktop plugin market integration complete on 2026-08-17: the immutable Desktop patch mounts a dedicated active-profile/packaged-pnpm provider and pinned `dshmarket@1.10.1`; ordinary Web composition remains unchanged. Desktop package operations are serialized, cancellable, tree-terminated, credential-scrubbed, and confined to the fixed `web` profile, with self-restart disabled.
- Harness-native marketplace presentation work is source-locked to the published `dshmarket@1.10.1` tarball integrity and upstream commit `6970a6f801108c04234eb953ff0f707feffa621a`; only an audited pnpm dependency patch may alter its Client presentation or self-protection routes.
- The audited marketplace patch provides a compact Harness-native Discover list and stable Discover/Installed/Updates/Activity tabs, rejects disable/uninstall/update against both active-market aliases before package execution, and is guarded by source/bundle/source-map/Host coherence plus exactly-one-package staging checks. Native packaged acceptance proves the compact tab/search/category/action geometry, clean ordinary rendering, protected self-update, and a real ordinary-plugin uninstall; separate light/dark/200%-zoom visual sweeps remain future evidence.
- Desktop integration for `@deepseek-ai/dsh-session-messenger` follows the requested peer-session model: copy Session A's exact ordinary ID, paste it into Session B's chat request, and let B's Agent send to A; A's existing Agent can wake and reply while both durable relays remain visible in their ordinary chat timelines. Relay cards explicitly attribute the text as sent by Codex from another chat, retain the untrusted-body boundary and trusted source metadata, and fall back to the source Session ID when no title is available. The separate session-communication header button, operator drawer, activity panel, duplicate composer, and client notification surface are absent; the Client plugin intentionally mounts nothing. Existing Host tools, write-ahead receipts, exact-once recovery, archive/self/missing/subagent/hop/rate boundaries, and ordinary Session-ID copy actions remain intact; no new Session, subagent, parallel driver, or autonomous Agent loop is created.
- Isolated source and staged-artifact acceptance passed for the plugin market: random loopback Hosts returned `/dsh-market/status` with `pnpm=true`, `restart=false`, `active=false`, and the curated registry was available. The staged application validated the Desktop patch, provider, dshmarket Host/Client artifacts, packaged pnpm bin, native modules, and third-party notices; temporary listeners closed cleanly.
- Native Intel macOS 0.1.6 packaged UI acceptance passed without an API key or model request: exact ordinary and archived clipboard IDs, no-side-effect rejection paths, Codex-style session collaboration controls and ordinary no-card rendering, reasoning slider/Canvas/persistence, stable horizontally scrolling Plugin Market categories plus separated search/filter geometry, self-protection/ordinary uninstall, random-port ownership, and full process cleanup all passed.
- Version 0.1.6 passed lint, documentation sync, 234 focused tests across 19 files, the isolated 19-test packaged smoke, and the two post-build TypeScript checks. A resource-saturated full-repository run completed 13,735 tests with 21 failures: two current-branch contract gaps were fixed and passed their 34-test serial rerun, while all other failed files passed a 197-test single-worker rerun. Staging validated 62 required files including the new Desktop plugin-runtime invariant. The final peer-messaging correction passed an additional 128-test focused rerun. The unsigned Intel DMG is 163,329,569 bytes with SHA-256 `5085c25e85b0eb650941d8b7915c1035090c52ce968b457b03bafc8971f4fe34`; `hdiutil verify` passed, the app executable reports `x86_64`, and the bundle reports `0.1.6`. Native Windows 0.1.6 packaging and acceptance remain pending and must come from the Windows workflow; filenames alone are not release evidence.
- Version 0.1.7 adds the local Usage dashboard and passes 77 focused source tests plus the isolated packaged macOS smoke. Desktop staging validates 62 required files. The unsigned Intel DMG is 163,343,340 bytes with SHA-256 `d9aaf227ebc24f7b1bca0e4b884745665691b92272c25380c226874df5f1c32d`; `hdiutil verify` passes, the bundle reports `0.1.7`, and the app executable plus packaged `node-pty` module report `x86_64`. It has not been installed over the existing application and no Windows build was run from macOS.
- Version 0.1.8 closes the residual generic-CI portability, exact-coverage, persistence-race, and usage-overflow contract gaps without changing the Desktop feature scope. The complete local coverage/static gates, Intel bundle checks, `hdiutil verify`, isolated packaged smoke, install-over-existing-app check, random-port launch, single-Harness-child check, and exact install-time `~/.dsh` preservation check pass. The final consumer repair updates the already-shipped Usage and Archive accessibility goldens, reuses the composed `tool-pwsh` row instead of inserting a duplicate, refreshes its current tool schema, and gives the DeepSeek SSE-comment fixture enough scheduler margin for hosted CI; the local consumer gate passes all 10 build, snapshot, Web, lint, documentation, and built-artifact gates. Native Windows acceptance is required on the final commit and remains the release authority for the real per-user install, shortcuts, launch, close, process cleanup, uninstall, and data preservation. Exact release bytes are intentionally kept out of packaged documentation; the public Release assets and their matching ASCII/LF `.sha256` files are authoritative.
- Version 0.1.4 removes the rejected effort-slider experiment and restores the pre-experiment model-control implementation byte-for-byte. Focused behavior, notice, staging, CI, release, and manifest tests passed 77/77; full lint and production builds passed; Desktop staging validated 49 required files; the isolated packaged smoke passed. Playwright acceptance against the packaged Host reported `slider=0`, `canvas=0`, `ULTRACODE=false`, exact `Off / High / Max` rows, and a working Plugin Market.
- The verified unsigned Intel 0.1.4 DMG is 160,692,416 bytes with SHA-256 `a1b79014e040634c44b24dc4b91ff3f7c00374e92ab53a27dfb6705fabae5865`; `hdiutil verify` passed and the bundle plus executable report `0.1.4` / `x86_64`. It is installed at `/Applications/DeepSeek Harness.app`; the prior 0.1.3 application is recoverably retained at `~/Library/Application Support/DeepSeek Harness Backups/DeepSeek Harness-0.1.3-pre-0.1.4-20260817-183558.app`.
- The 0.1.4 installation itself preserved the exact 16-file `~/.dsh` aggregate SHA-256 `753ae9dab43cdea768ab0470fb68eef780233fb3d7f70855157e86859a5f3953`. First launch then completed on random loopback port 60999 with HTTP 200 and performed ordinary runtime bookkeeping in workspace, project-cache, profile, and one session archive; the resulting JSON, YAML, and Zstandard records all passed structural integrity checks, and no effort-slider profile reference remains.
- Version 0.1.3 passed full lint and production builds, 67 focused behavior tests, 32 notice/staging tests, the staged closure check, and the isolated packaged macOS smoke. Its Intel DMG is 160,717,590 bytes with SHA-256 `21127170a7f28fef0646706507cb0f7cc5bddd23f2170de0d32df8f14ff57760`; a read-only `hdiutil` mount confirmed the `x86_64` executable, bundle version, Desktop patch, and third-party notices.
- Version 0.1.3 is installed at `/Applications/DeepSeek Harness.app`; the replaced application is recoverably retained as `~/Library/Application Support/DeepSeek Harness Backups/DeepSeek Harness-0.1.2-pre-0.1.3-20260817-1540.app`. Live startup completed on random loopback port 62047, and the settings market loaded 1,169 current registry entries. Pre/post hashes of existing session, workspace, and project-cache records were identical.
- The separately installed effort-slider package remains removed after a recoverable profile backup at `~/Library/Application Support/DeepSeek Harness Backups/web-profile-pre-built-in-effort-20260817-1519`; the original built-in list handles effort selection without changing `~/.dsh` sessions. The shared macOS/Windows child launch keeps Electron's internal ESM-loader fallback so profile-installed Host plugins can resolve correctly.
- Archived-session management complete: the sidebar archive lists hidden sessions, restores them to their retained Workspace positions, and gates permanent deletion behind an archive-only Host check plus an explicit irreversible-action confirmation. Running, externally owned, and subagent-owned sessions are refused; project files, shared attachments, settings, and credentials remain outside the deletion boundary.
- Session-ID copy complete: every non-blank session row and archived-session card can copy the exact stable ID with accepted/refused clipboard feedback; the action does not open, restore, archive, or delete the session.
- Standalone package staging and unsigned local `.app` packaging complete.
- Isolated packaged smoke passed from outside the repository: clean `DSH_HOME`, preload bridge, random loopback listener, stable plugin graph, settings dialog, native quit, and complete process/port cleanup.
- Intel DMG regenerated with the accepted icon master and verified with `hdiutil`: `DeepSeek-Harness-0.1.1-mac-x64.dmg` (SHA-256 `e715b4e85553a904d619568803e778fde952c69b2419b1e9d2cf9948bc6e9aad`).
- Version 0.1.2 Intel DMG built and verified with `hdiutil`: `DeepSeek-Harness-0.1.2-mac-x64.dmg` (SHA-256 `40e20ade2025116e0b80181529ba5fef4fbe11087690894636a0c9c5bd4ff138`). The packaged executable and app bundle both report `x86_64` / `0.1.2`, and the packaged smoke passed with an isolated `DSH_HOME`.
- Live ownership migration complete on 2026-08-14: the exact legacy process group stopped gracefully, port 65000 was released, and the independent Hermes gateway remained running.
- A permission-restricted pre-migration backup is stored under `~/Library/Application Support/DeepSeek Harness Backups/pre-desktop-20260814-021540`.
- The final-icon application installed at `/Applications/DeepSeek Harness.app` passed live acceptance against the existing `~/.dsh`: HTTP 200 on random port 65320, the saved application window and Dock item loaded, Finder resolved `icon.icns`, all 518 profile fallback links resolved to physical packaged modules, and no virtual-asar link remained.
- Windows window/menu behavior, runtime conflict discovery, exact process-tree shutdown, x64 NSIS packaging, and native installer lifecycle automation complete.
- Native Windows Setup acceptance passed on `windows-2025` at source commit `c1023875285564aa64d8b6676deaa51e7872a5ca` (run `31756708218`). The one-click per-user Setup created both shortcuts, launched against isolated data, copied exact ordinary and archived `node.id` values through the Windows system clipboard without session side effects, closed its complete process tree and random listener, uninstalled its complete application tree, and preserved both Harness and Electron data markers. The resulting `DeepSeek-Harness-Setup-0.1.2-win-x64.exe` is 136,280,531 bytes with SHA-256 `450d2f8f8770ac3a8008e05cc03b522c63cfa3700fcd885cc2904bd173fc94ed`; the separately generated checksum file matched a local rehash after artifact download.
- Version 0.1.2 is installed at `/Applications/DeepSeek Harness.app`; the replaced 0.1.1 application is retained under `~/Library/Application Support/DeepSeek Harness Backups/DeepSeek Harness-0.1.1-20260814-045758.app`, alongside the earlier 0.1.0 backup.
- The installed 0.1.1 application passed live acceptance against the existing `~/.dsh`: HTTP 200 on random port 49375, the archive manager displayed the retained `AI助手功能简介` session with Restore and Delete actions, the archived log SHA-256 remained unchanged, and neither action was invoked during acceptance.
- The installed Mac 0.1.2 application passed startup and archive-manager safety checks against the existing `~/.dsh`, but its earlier sentinel-only clipboard observation is not valid evidence of exact ID copying: a later audit found the production Electron permission handlers denied every renderer clipboard request. The cross-platform fix now allows only `clipboard-sanitized-write` from the owned main frame, trusted `webContents`, exact `http://127.0.0.1:<bound-random-port>` origin, with request/check parity and an explicit deny matrix. Mac clipboard acceptance and the DMG must be repeated from public main after the Windows PR merge; the existing Mac 0.1.2 DMG must not be cited as clipboard-success evidence. Restore and Delete were not invoked, and the install itself left the 12-file `~/.dsh` aggregate SHA-256 unchanged before first launch.

## Known Risks

- A first Usage read with no derived cache must inspect all durable Session
  logs; partial inspection failures are surfaced as omitted-session counts, and
  unsupported or invalid provider token fields are not estimated.
- Upstream is still a release candidate and may change quickly.
- The installed package does not ship a ready-made Electron shell.
- The desktop source baseline is official `0.1.0-rc.8`; older installed macOS builds and their retained backups may still contain the earlier `rc.5`-derived Desktop graph.
- Signed/notarized distribution and automatic updates require Apple Developer and Windows code-signing credentials and are outside version 1.
- Unsigned local artifacts may require Finder's **Open** action or a Windows SmartScreen confirmation on first launch.
- Windows release evidence must come from native Windows x64 because Electron native dependency rebuilding cannot safely cross-compile from macOS. The accepted Setup is unsigned, so SmartScreen may warn even though its published SHA-256 is verified.
- Marketplace packages are third-party executable code. The pinned market restricts installs to its curated registry and pnpm blocks unapproved build scripts by default, but users must still inspect plugin provenance and requested build-script approvals; catalog contents and counts are network-derived and can change independently of the Desktop release.
