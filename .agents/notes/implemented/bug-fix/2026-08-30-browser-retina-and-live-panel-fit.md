# Agent Note: Browser Retina recovery and live panel fit

Status: implemented

English | [中文](2026-08-30-browser-retina-and-live-panel-fit.zh.md)

## Problem

On an installed macOS build, official `browser_snapshot` could return `INTERNAL` even after navigation and the accessibility tree were ready. The optional PNG path assumed every CDP build reported backing-store dimensions, while Retina renderers may report the exact CSS clip dimensions. The optional image failure discarded valid semantic refs. The packaged debugger handshake also enabled Overlay before DOM, which real Electron rejects even though the test double did not. An expired native approval request left its modal sheet visible. In addition, a browser transferred to the Agent stopped following utility-panel resize, narrow panels clipped desktop-oriented pages, and the prompt ruler could overlap a tall composer. Switching to another Harness session also left the previous session bound as Electron's official control owner, so the new session failed immediately with `UNAUTHORIZED` even after the old browser had stopped.

## Decision

Accept only the two deterministic CDP viewport dimension conventions: physical backing-store pixels or CSS clip pixels. PNG remains optional; bounded capture, encoding, or renderer failures preserve the verified semantic snapshot. Record only a closed stage and error code in the native log. Enable DOM before Overlay and disable both during owned-debugger cleanup. Bind Electron's native message box AbortSignal to the exact request so timeout, cancellation, window hide, and window close also dismiss the sheet.

Add a layout-only trusted IPC that can resize and zoom the exact existing browser during human or Agent ownership. It cannot create, reveal, navigate, or transfer a view. The page zoom follows the live dock width. The prompt ruler uses measured conversation and composer geometry rather than the full window. The strict-session header now sends a zero-argument, revoke-only signal when it mounts. Electron accepts it only from the trusted main frame, clears any Give intent, awaits old-session cleanup, and releases the old official binding. The renderer cannot name or claim the new session; only the owned child request can.

## Alternatives considered

**Fail every snapshot when PNG capture differs.** This preserves an unnecessarily strict image invariant but discards independently verified semantic refs. The image is presentation data, so only its attachment degrades.

**Create a new narrow Agent browser after every resize.** That would lose login state and violate exact-view ownership. A layout-only operation keeps identity and authority unchanged.

## Consequences

Official BrowserControl keeps usable refs when only the visual attachment is unavailable, and a future failure can be diagnosed without logging page data. The installed Intel macOS build completed a real official `browser_navigate https://example.com/` followed by `browser_snapshot`, returning eight semantic refs after the native approval was accepted. The same controlled browser follows the user's splitter continuously without a second window or authority change. Narrow pages trade visual scale for complete layout; widening the panel returns zoom to 100 percent. Changing conversations no longer inherits the former conversation's control identity, and malformed renderer calls carrying a session value are rejected.
