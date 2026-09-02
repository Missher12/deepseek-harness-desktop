# @deepseek-ai/dsh-desktop-workbench

English | [中文](README.zh.md)

Desktop-only Codex-style utility workbench for DeepSeek Harness. One compact control beside `Session log` opens a resizable right panel whose vertical launcher keeps Review, Terminal, Browser, and Files inside the same docked surface. The package is mounted only by `apps/desktop/desktop.cordis.patch.yml`; ordinary Web profiles do not load it.

## Boundaries

- Terminal processes are user-owned and never enter the Agent terminal registry. Windows opens built-in PowerShell; POSIX platforms open the first available zsh or bash login shell. A client may open four shells; input is capped at 16 KiB, retained output at 1 MiB, and every shell is terminated when the mode or plugin closes.
- Browser content runs in an Electron `WebContentsView` with sandbox, context isolation, and web security. Only HTTP(S) navigation is accepted; popups, downloads, permission requests, and non-Web schemes are denied. Closing the mode destroys the native view.
- Files and Review are read-only. They resolve the live session workspace on the Host, reject traversal and symlink escape, limit directory rows to 200, and cap text and Git diff previews at 256 KiB.
- The panel width is limited to 320–720 px and persisted locally. The last valid mode is stored separately and restored on the next explicit open without opening the panel for a new Session. The vertical launcher supports Up/Down/Home/End, Enter or Space activation, and Escape to close. Terminal polling exists only while Terminal mode is mounted; Browser native resources are destroyed on unmount; no idle animation runs after reasoning text catches up.

The Host HTTP bridge is bound to the active random loopback origin and a generation-scoped capability injected into the trusted Desktop document. It does not expose filesystem, Git, or terminal operations to other origins.

## Model Experience

None, as this browser-side Desktop utility surface registers nothing model-facing; Files, Review, Browser, and the human-owned Terminal never enter model context automatically.

#### KV Cache effect

Opening, resizing, or switching workbench modes does not change the provider request prefix; content enters context only when the user explicitly copies it into the ordinary composer.

## Known Limitations and Deferred Work

- The embedded Browser is intentionally isolated from Harness login state and does not provide extensions, downloads, popups, permission prompts, or non-HTTP(S) protocols.
- Files and Review are bounded previews rather than an editor or full Git client; binary files, oversized text, repository mutation, staging, and commit operations are out of scope.
- Terminal tabs are local to the current renderer lifetime and do not restore after an application restart.
- The launcher shows no shortcut capsules because the product has no global shortcuts for its four modes; it does not advertise keys without matching handlers and tests.
- The workbench is a native Intel macOS and Windows x64 Desktop composition feature; ordinary Web does not mount it.
