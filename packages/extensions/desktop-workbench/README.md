# @deepseek-ai/dsh-desktop-workbench

English | [中文](README.zh.md)

Desktop-only Codex-style utility workbench for DeepSeek Harness. One compact control beside `Session log` opens a resizable right panel with Terminal, Browser, Files, and Review modes. The package is mounted only by `apps/desktop/desktop.cordis.patch.yml`; ordinary Web profiles do not load it.

## Boundaries

- Terminal processes are user-owned and never enter the Agent terminal registry. Windows opens built-in PowerShell; POSIX platforms open the first available zsh or bash login shell. A client may open four shells; input is capped at 16 KiB, retained output at 1 MiB, and every shell is terminated when the mode or plugin closes.
- Browser content runs in an Electron `WebContentsView` with sandbox, context isolation, and web security. Only HTTP(S) navigation is accepted; popups, downloads, permission requests, and non-Web schemes are denied. Switching modes or collapsing the workbench suspends native pixels while preserving the page; application lifecycle cleanup destroys the native view.
- Files and Review are read-only. They resolve the live session workspace on the Host, reject traversal and symlink escape, limit directory rows to 200, and cap text and Git diff previews at 256 KiB.
- The panel width is limited to 420–1,600 px, starts at 720 px, and persists from one layout store. It remains a real resizable grid column: it may temporarily take the viewport while the left navigation concedes to its compact rail, but it never floats over the conversation or composer. Its separator supports pointer and keyboard resizing. Browser mode serializes exact x/y/width/height and exposure updates from the live DOM host into the native `WebContentsView`, including position-only layout changes, so it stays inside the right workbench instead of drifting over blank center content. Dialogs, tooltips, hidden documents, and other intersecting surfaces suspend the native pixels; closing them restores only the current mount and preserved address. Terminal polling exists only while Terminal mode is mounted; Browser native resources are destroyed only by application lifecycle cleanup; no idle animation runs after reasoning text catches up.

The Host HTTP bridge is bound to the active random loopback origin and a generation-scoped capability injected into the trusted Desktop document. It does not expose filesystem, Git, or terminal operations to other origins.

## Model Experience

None, as this browser-side Desktop utility surface registers nothing model-facing; Files, Review, Browser, and the human-owned Terminal never enter model context automatically.

#### KV Cache effect

Opening, resizing, or switching workbench modes does not change the provider request prefix; content enters context only when the user explicitly copies it into the ordinary composer.

## Known Limitations and Deferred Work

- The embedded Browser is intentionally isolated from Harness login state and does not provide extensions, downloads, popups, permission prompts, or non-HTTP(S) protocols.
- Files and Review are bounded previews rather than an editor or full Git client; binary files, oversized text, repository mutation, staging, and commit operations are out of scope.
- Terminal tabs are local to the current renderer lifetime and do not restore after an application restart.
- The workbench is a native Intel macOS and Windows x64 Desktop composition feature; ordinary Web does not mount it.
