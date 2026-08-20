# @deepseek-ai/dsh-desktop-workbench

English | [中文](README.zh.md)

Desktop-only Codex-style utility workbench for DeepSeek Harness. One compact control beside `Session log` opens a resizable right panel with Terminal, Browser, Files, Side Chat, and Review modes. The package is mounted only by `apps/desktop/desktop.cordis.patch.yml`; ordinary Web profiles do not load it.

## Boundaries

- Terminal processes are user-owned and never enter the Agent terminal registry. A client may open four shells; input is capped at 16 KiB, retained output at 1 MiB, and every shell is terminated when the mode or plugin closes.
- Browser content runs in an Electron `WebContentsView` with sandbox, context isolation, and web security. Only HTTP(S) navigation is accepted; popups, downloads, permission requests, and non-Web schemes are denied. Closing the mode destroys the native view.
- Files and Review are read-only. They resolve the live session workspace on the Host, reject traversal and symlink escape, limit directory rows to 200, and cap text and Git diff previews at 256 KiB.
- Side Chat uses `@deepseek-ai/dsh-session-messenger`. The source and destination both receive visible conversation rows; model history receives only the destination relay, while the source row is marked ignorable.
- The panel width is limited to 320–720 px and persisted locally. Terminal polling exists only while Terminal mode is mounted; Browser native resources are destroyed on unmount; no idle animation runs after reasoning text catches up.

The Host HTTP bridge is bound to the active random loopback origin and a generation-scoped capability injected into the trusted Desktop document. It does not expose filesystem, Git, or terminal operations to other origins.
