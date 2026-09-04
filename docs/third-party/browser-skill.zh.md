# BrowserSkill 供应链

Desktop 将腾讯 BrowserSkill 作为可审计、默认休眠的内置能力交付。所有第三方输入均按下表固定；任何输入都不得改为 `latest`、分支 URL 或未校验的下载。

[English](browser-skill.md) | 中文

## 固定输入

| 输入 | 固定值 |
|---|---|
| npm 插件 | `@wxg-prc-cpg/browser-skill-dsh-plugin@0.2.0` |
| npm 完整性 | `sha512-CwzoviH02P0mwKM7/7NDyurO0r243m4AuM2smgk8nIT6LEBXvt52pbU0RLM71jjHjldFwsJZQoQvJibiVVK51w==` |
| 许可证 | MIT（Tencent） |
| 已审计上游源码 | `945bf1523dc969ba6c359368c56c01047ccdeeea` |
| Intel macOS CLI | `bsk-v0.2.0-x86_64-apple-darwin.tar.gz`，SHA-256 `9700ebd84b306acf83c641e0a23db0fe6003fba1d728e640fae4f6abc3e821bc` |
| Windows x64 CLI | `bsk-v0.2.0-x86_64-pc-windows-msvc.zip`，SHA-256 `57c0459711125c4a5c7f5759ef15b5e45c942e69afa43aaf22bfa06f7fec4590` |

## 本地补丁

`patches/@wxg-prc-cpg__browser-skill-dsh-plugin@0.2.0.patch` 移除启动期的 `bsk --version` 探针，以及插件自带的浮动覆盖层／侧栏注入。打包的 CLI 是构建期校验过的资产，每次启动都探测会在任何 `browser_*` 工具运行前产生一个不必要的子进程；Desktop 的唯一固定 Workbench 负责浏览界面。CLI 缺失的安装指引仍会在第一次真实调用时出现。

## Desktop 配置

Desktop 行以 `lazyTools: true`（仅在调用 BrowserSkill 技能后暴露工具）与 `observationEnabled: false`（关闭浮动 PiP 覆盖层；唯一的固定 Workbench 拥有全部浏览界面）挂载该插件。
