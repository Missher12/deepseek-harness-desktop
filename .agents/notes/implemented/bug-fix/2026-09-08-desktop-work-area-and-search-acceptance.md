# Agent Note: Desktop windows fit the current work area

Status: implemented

English | [中文](2026-09-08-desktop-work-area-and-search-acceptance.zh.md)

## Problem

The first-run and invalid-state window defaults exceed small desktop work areas, and fixed minimum dimensions can enlarge a fitted window again at higher scaling. A wide test viewport hides the resulting inaccessible first-run action. Windows Search screenshots can also pass by finding the running application window elsewhere on the desktop before the query or search result is ready.

## Decision

Desktop resolves default geometry against the primary work area. On Windows, each dimension at or below its normal minimum releases that minimum axis to zero; larger axes retain the normal 900 by 620 limits. This prevents non-client pixel conversion from enlarging a minimum pinned to the available area. Other platforms cap constructor minimums at the fitted dimensions. Saved geometry selects the eligible display with the largest visible intersection and moves wholly inside it. The state format is unchanged; malformed and absent files use the same fitted fallback. With no display available, the emergency size remains 1180 by 760.

After creating a Windows BrowserWindow, Desktop applies the original fitted rectangle once before attaching state writers, loading content or showing the window. Electron construction repeatedly reads native size back during centering and positioning; fractional-DPI conversion can enlarge each read/write cycle. Reapplying the complete original rectangle prevents constructor drift from becoming the initial or persisted geometry.

Windows displays with fractional scaling reserve one physical pixel, rounded up to device-independent pixels, inside each work-area edge. Display selection uses the original work areas; fitting uses the inward area, and the minimum-size rule accepts previously fitted small windows. This preserves secondary-display placement across restarts while containing native edge rounding. macOS and integer scaling retain their original work areas. Acceptance still compares native bounds with the actual display work area without widening the assertion.

Packaged acceptance records native window and work-area bounds and verifies the first-run Continue action before setting any test viewport. The Windows 150 percent reader records actual geometry and the rail's responsive visibility before a separate wide-viewport interaction scenario. The Windows shell sampler compares DWM visible frame bounds against work-area and virtual-screen bounds in physical coordinates; GetWindowRect remains diagnostic because it includes invisible resize borders. The temporary thread DPI context is restored.

Search acceptance reads only the foreground accessibility root, requires a Shell search process and the complete query, and waits for one visible enabled actionable application result inside that root. It rechecks query and foreground before returning. Background application titles, partial queries, missing or ambiguous results and changed foregrounds cannot satisfy the final observation check. Shell screenshots remain CI diagnostics rather than public promotional images.

## Alternatives considered

**Resize the window in the capture script.** This hides the initial product defect and cannot establish that a user can reach the first-run action.

**Increase delays or retain whole-desktop name matching.** Neither establishes that Search has accepted the full query or produced the requested result.

**Select the first intersecting display.** A small overlap with the primary display can move a mostly-secondary window to the wrong screen. Largest eligible overlap preserves its placement.

## Consequences

Small work areas can use dimensions below the normal 900 by 620 minimum. Saved windows partly outside a display move inward on restoration. The targeted window tests cover small and normal work areas, malformed or absent state and secondary-display placement. A Windows PowerShell regression exercises the actual final Search observation predicate with complete and invalid observations. The dedicated Mac and Windows tasks own new native workflow review at the final source revision; unit and wiring checks do not establish native acceptance. Forced Electron scaling does not establish full system-DPI coverage.
