# @deepseek-ai/dsh-client-ui-desktop-control

English | [中文](README.zh.md)

Desktop-only visible Computer Use UI. It contributes a compact active-control capsule to the additive `layout.status` seat and a Browser & Computer Control settings section. The capsule shows the Agent, current application, action, and approval-free Stop. Version 0.4.3 has no Pause control.

The optional preload bridge exposes only validated, path-free status and setting intents. It never carries sessions, leases, refs, window IDs, screenshots, coordinates, approval data, or native handles. When the bridge, helper, provider, or OS permissions are missing, the plugin renders an unavailable/permission state or registers nothing; it never blocks ordinary chat or startup.

Settings show explicit Browser Agent and Computer Control enablement, Screen Viewing and Assistive Control separately, the main-owned ordinary application allowlist, and the emergency shortcut. Both controls remain disabled by default; enabling either is confirmed and persisted by Electron main. Give records only a browser takeover intent and never enables Browser Agent control. Static UI strings ship in English and Chinese.

## Known limitations

- Native status/list observation is an optional main-process provider seam supplied with the native adapter.
- OS permissions must be granted manually in system settings.
- Screenshot and accessibility content never reaches this UI package.
