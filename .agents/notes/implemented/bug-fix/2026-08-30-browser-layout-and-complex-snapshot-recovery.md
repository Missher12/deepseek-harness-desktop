# Agent Note: Browser layout and complex snapshot recovery

Status: implemented

English | [中文](2026-08-30-browser-layout-and-complex-snapshot-recovery.zh.md)

## Problem

The Desktop utility workbench stopped at 960 pixels and changed into an overlay under layout pressure. It could cover the conversation, hide the composer, or appear over blank center space while the left navigation still occupied a large column. A long status line and prompt-rail hint could also paint into the sticky composer.

Browser Control treated a large accessibility tree as an all-or-nothing result. Complex sites exhausted the 2,000-node or 300-reference budget and returned `QUOTA_EXCEEDED`, causing models to retry identical snapshots and expand the request context without receiving usable refs. Cold debugger initialization had only ten seconds, condition waits could report a timeout after the page was already usable, and the user could not see the Agent's intended pointer target. The Windows assisted installer also re-enabled its details window but did not re-enable detail printing after electron-builder suppressed it, leaving a blank-looking progress list.

## Decision

The utility stays a real fourth grid column. It defaults to 720 pixels, grows to 1,600 pixels, shrinks first, and then temporarily reduces the rendered left navigation to its 56-pixel rail without changing the user's saved width. The Workbench preference and live layout use this same width contract, and the native page is inset from the divider so it cannot cover the drag hit area. A truly narrow viewport focuses the utility in the remaining grid; it never overlays the conversation. Composer height bounds the prompt rail, and the status line uses a two-line bounded flow layout. The Browser mode owns the only valid native-page rectangle. Electron main requests that the current session open Browser mode before an Agent surface mounts, waits for its positive host rectangle, and keeps the `WebContentsView` detached and hidden until that rectangle exists. Main never substitutes a window-relative or full-height rectangle; closing the Browser utility clears the anchor and hides mounted resources, while resize and divider updates reflow the exact active mount.

The browser walker accepts up to 10,000 raw nodes and 800 actionable refs but preserves the existing 64 KiB encoded result boundary. Raw-node, CDP-call, actionable, semantic-text, and encoded-result limits return a deterministic partial snapshot. Candidate ordering retains focused, editable, and button-like controls before link noise. The model prompt treats partial output as usable and forbids unchanged snapshot retry loops. Debugger startup gets a bounded twenty-second, two-attempt window. Loading and navigation waits return the current revision at their ten-second bound. Click and scroll operations show a main-owned blue CDP Overlay marker without page code or selector injection.

The NSIS custom install hook explicitly restores `SetDetailsPrint both` before emitting five privacy-safe completion stages.

## Alternatives considered

**Raise the protocol JSON frame and semantic text to 256 KiB.** This would widen every codec and native parity contract and increase model/context cost. Prioritized partial results preserve the existing wire boundary and solve the target-discovery failure.

**Keep the right surface as a drawer.** A drawer can look large but still covers the composer and breaks native browser bounds. A grid concession chain preserves independent resizing and exact `WebContentsView` geometry.

**Fall back to shell or a remote debugging port after browser failure.** This bypasses the owned BrowserControl authority and repeats the behavior reported by the user, so official Stop plus one bounded retry remains the only recovery route.

## Consequences

Complex pages can expose useful current refs without unbounded page dumps, and unchanged snapshot failures no longer encourage retry storms. A partial snapshot can omit low-priority offscreen content, so the Agent may need to scroll or navigate before requesting another snapshot. The visual marker is transient debugger overlay state and disappears with the owned debugger.

The workbench can occupy most of a desktop window while the saved navigation width remains intact. Agent browser acquisition opens the Browser utility automatically, and the page appears only below its toolbar and status row. On very narrow windows the conversation is intentionally hidden until space returns, rather than being covered by another pane. Windows users see bounded installation completion stages; extraction internals remain controlled by electron-builder.
