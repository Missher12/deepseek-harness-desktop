# BrowserSkill supply chain

The Desktop ships Tencent's BrowserSkill as an auditable, default-sleeping built-in capability. Every third-party input is pinned below; nothing may move to `latest`, a branch URL, or an unverified download.

English | [中文](browser-skill.zh.md)

## Pinned inputs

| Input | Pin |
|---|---|
| npm plugin | `@wxg-prc-cpg/browser-skill-dsh-plugin@0.1.2` |
| npm integrity | `sha512-k6BeAN0SpuaBj0M62wQhcKjCN7Fk6K6NTzGc/5c6LnOW2EvfQxdBssdnKhn7lLyTN3qHktCTpTeJsHdQUcnnTg==` |
| License | MIT (Tencent) |
| Audited upstream source | `945bf1523dc969ba6c359368c56c01047ccdeeea` |
| Intel macOS CLI | `bsk-v0.1.11-x86_64-apple-darwin.tar.gz`, SHA-256 `f1e0749fc2fac11f81d931862efa331bb9fcba30d1a5cce83b2a10626bb02bf6` |
| Windows x64 CLI | `bsk-v0.1.11-x86_64-pc-windows-msvc.zip`, SHA-256 `041785147342a704fd576470e63307880043a15ad52e0553f12e6dcf360ccf74` |

## Local patch

`patches/@wxg-prc-cpg__browser-skill-dsh-plugin@0.1.2.patch` removes only the startup `bsk --version` probe: the packaged CLI is a build-time verified asset, so probing on every boot would spawn an unnecessary subprocess before any `browser_*` tool runs. Missing-CLI guidance still surfaces from the first real invocation.

## Desktop configuration

The Desktop row mounts the plugin with `lazyTools: true` (tools reveal only after the BrowserSkill skill is invoked) and `observationEnabled: false` (the floating PiP overlay stays off; the one fixed Workbench owns every browsing surface).
