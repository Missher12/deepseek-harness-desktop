# DeepSeek Harness Desktop

[English](README.md) | 中文

DeepSeek Harness Desktop 将官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 带到 macOS、Windows 和 Ubuntu。它是 Missher 维护的独立社区桌面发行版。

项目只有两个目标：把官方 Harness 发布版本做成桌面应用，让用户已经开发的插件在桌面端完整可用。

[下载安装包](https://github.com/Missher12/deepseek-harness-desktop/releases) · [桌面使用与开发说明](apps/desktop/README.zh.md) · [插件](#plugins) · [源码迁移记录](docs/desktop-source-migration.zh.md)

## 下载与开发状态

已发布版本是 [Desktop 0.5.8](https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v0.5.8)，集成 Harness 0.1.5-rc.2。该版本实际交付的功能、安装说明与校验值以 Release 为准。

| 平台 | 支持目标 | 安装包 |
| --- | --- | --- |
| macOS | Intel x64 | DMG |
| Windows | x64 | Setup EXE |
| Ubuntu | 22.04 / 24.04 x64 | deb / AppImage |

主分支包含从验证仓库迁入的 Desktop 0.6.0 开发源码。基础桌面与插件拆分仍在进行中。本次迁移不发布新安装包，也不代表平台验收已经完成；[迁移记录](docs/desktop-source-migration.zh.md) 列出导入来源与待完成检查。

## 桌面与插件的职责

Desktop 负责原生窗口、运行时启动退出、系统集成、安装和系统更新。官方 Harness 提供标准聊天、模型、工具与会话能力。三端使用同一套产品结构。

从 Desktop **0.6.0** 开始，桌面端与插件端将完全分开维护和升级。标准版将配套 **Enhance 增强插件**，其他插件从各自的 GitHub 仓库下载安装。

即使作为标配，Enhance 仍是可以独立配置、停用和升级的插件。桌面升级时，兼容插件可以沿用原版本，只做维持现有功能所需的兼容调整。

<a id="plugins"></a>

## 插件

| 组件 | 已有能力 | 项目或获取方式 |
| --- | --- | --- |
| Enhance 增强包 | 使用统计、数字高亮底栏、钢琴键、无项目会话、模型辅助、个性化、文档与跨会话消息 | `dsh-missher-enhance`；计划作为 0.6.0 标配，配套打包正在完善 |
| Project Ops | 项目任务发现、执行、收集与验证 | [dsh-project-ops](https://github.com/Missher12/dsh-project-ops) |
| Memory | 已确认事实、捕获、搜索与记忆维护 | [dsh-missher-memory](https://github.com/Missher12/dsh-missher-memory) |
| MSE / Evolution | 原有 MSE 经验与规则系统的 Harness 接入 | [dsh-missher-evolution](https://github.com/Missher12/dsh-missher-evolution) |
| Media@Missher | 使用原有 Media 运行时完成设置、采集、结果查看与导出 | `dsh-media-missher`；私有／本地分发 |
| Brain | 协调 Memory、MSE 的共享召回，数据仍由各提供方持有 | `dsh-missher-brain`；本地候选，公开安装入口待完善 |

其他插件统一通过各自 GitHub 仓库及 Releases 获取；尚未发布的入口标为准备中，私有仓库需要访问权限。每个插件分别记录支持的 Harness 版本与平台限制。存在项目链接不等于已兼容当前 Desktop 候选。Media 与 MSE 保留原始核心，本仓库不包含其私有工作数据。

## 插件设置与市场

统一入口目标为 **设置 → 插件**，提供 **已安装** 和 **插件市场**。已安装插件需要显示版本、支持的 Harness 版本、启用或暂停状态，以及配置或使用入口。插件发现、安装与更新复用现有市场，操作结果同步到已安装列表。

补齐这条路径是当前首要接入任务。统计、模型辅助等功能保留各自自然的设置或会话入口。已经删除的右侧工作台及其 BrowserSkill／Open Design 入口不再纳入交付，飞书不在维护范围内。

## 更新流程

官方发布新版后，先适配共同桌面并准备 macOS、Windows、Ubuntu 安装包，再检查现有插件。需要时对插件做小范围兼容调整。确认不兼容的插件可以暂停，同时保留安装与数据；临时网络或 API 错误本身不能证明插件不兼容。

被暂停或尚未验证的插件仍是未完成项。生成安装包、配置检查通过，不能代表全部插件完整可用。平台验收和正式发布遵循[发布说明](apps/desktop/releasing/README.zh.md)。

<a id="run"></a>

<a id="run-from-source"></a>

## 开发

从[桌面说明](apps/desktop/README.zh.md)、[开发指南](docs/development.zh.md)和[架构说明](docs/architecture.zh.md)开始。直接使用 CLI 请阅读[官方 Profile 参考](apps/cli/reference/README.zh.md)。开发者和 Agent 遵循 [AGENTS.md](AGENTS.md) 及当前[项目上下文](PROJECT_CONTEXT.md)。

桌面问题提交到[本仓库](https://github.com/Missher12/deepseek-harness-desktop/issues)，插件问题提交到对应项目。官方 Harness 继续由[上游项目](https://github.com/deepseek-ai/deepseek-harness)维护。

## 许可证

[MIT](LICENSE)。保留上游声明，依赖许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
