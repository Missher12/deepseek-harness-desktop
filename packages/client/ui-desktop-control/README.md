---
description: "Desktop-only visible Browser and Computer Control status and settings"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-control

English | [中文](README.zh.md)

## Summary

Desktop-only visible Computer Use UI. It contributes a compact active-control capsule to the additive `layout.status` seat and a compact-list Browser & Computer Control settings section. The capsule shows the Agent, current application, action, and approval-free Stop. Version 0.4.3 has no Pause control.

The optional preload bridge exposes only validated, path-free status and setting intents. It never carries sessions, leases, refs, window IDs, screenshots, coordinates, approval data, or native handles. Browser and Computer availability are independent from enablement and from each other: an installed capability that is off renders **Available · Not enabled**, while an absent or explicitly unsupported adapter alone renders unavailable. When the bridge is absent the plugin registers nothing; it never blocks ordinary chat or startup.

Settings show explicit Browser Agent and Computer Control enablement, Screen Viewing and Assistive Control separately, the main-owned ordinary application allowlist, the emergency shortcut, and current control. Native status and application enumeration settle independently. Main retains the latest validated status and list in memory; a later failure marks only its refresh row, exposes a bounded generic Retry message, and never discards unrelated valid display state. Both controls remain disabled by default; enabling either is confirmed and persisted by Electron main. Give records only a browser takeover intent and never enables Browser Agent control. Static UI strings ship in English and Chinese.

When Computer Control is enabled and applications are visible but none is allowed, the application section shows a corrective status instead of implying that enumeration granted control. It also explains that each new task has a separate Electron-native approval and that the ordinary Harness `ask` or `never` policy cannot replace it.

## Table of Contents

- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="dev-note"></a>
## Dev Note

None.

<a id="model-experience"></a>
## Model Experience

None, as this package only presents main-owned Desktop control state and fixed setting intents. It does not register tools, assemble prompts, select models, or send provider requests.

#### KV Cache effect

None; this package never participates in a model request or changes its cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Native status/list observation is an optional main-process provider seam supplied with the native adapter.
- OS permissions must be granted manually in system settings.
- Screenshot and accessibility content never reaches this UI package.
