# BrowserSkill supply chain

The Desktop ships Tencent's BrowserSkill as an auditable, default-sleeping built-in capability. Every third-party input is pinned below; nothing may move to `latest`, a branch URL, or an unverified download.

English | [中文](browser-skill.zh.md)

## Pinned inputs

| Input | Pin |
|---|---|
| npm plugin | `@wxg-prc-cpg/browser-skill-dsh-plugin@0.2.0` |
| npm integrity | `sha512-CwzoviH02P0mwKM7/7NDyurO0r243m4AuM2smgk8nIT6LEBXvt52pbU0RLM71jjHjldFwsJZQoQvJibiVVK51w==` |
| License | MIT (Tencent) |
| Audited upstream source | `945bf1523dc969ba6c359368c56c01047ccdeeea` |
| Intel macOS CLI | `bsk-v0.2.0-x86_64-apple-darwin.tar.gz`, SHA-256 `9700ebd84b306acf83c641e0a23db0fe6003fba1d728e640fae4f6abc3e821bc` |
| Windows x64 CLI | `bsk-v0.2.0-x86_64-pc-windows-msvc.zip`, SHA-256 `57c0459711125c4a5c7f5759ef15b5e45c942e69afa43aaf22bfa06f7fec4590` |

## Local patch

`patches/@wxg-prc-cpg__browser-skill-dsh-plugin@0.2.0.patch` removes the startup `bsk --version` probe and the plugin's floating overlay/sidebar injection. The packaged CLI is a build-time verified asset, so probing on every boot would spawn an unnecessary subprocess before any `browser_*` tool runs; Desktop's one fixed Workbench owns the browsing surface. Missing-CLI guidance still surfaces from the first real invocation.

## Desktop configuration

The Desktop row mounts the plugin with `lazyTools: true` (tools reveal only after the BrowserSkill skill is invoked) and `observationEnabled: false` (the floating PiP overlay stays off; the one fixed Workbench owns every browsing surface).
