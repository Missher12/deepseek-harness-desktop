# DeepSeek Harness Desktop

[English](README.md) | 中文

DeepSeek Harness Desktop 是由 Missher 维护的社区桌面发行版，将官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 打包为 macOS、Windows 和 Ubuntu 应用。

当前源码基于 **Harness 0.1.6-alpha.2**，桌面端与内置 Harness 使用同一版本号。三端采用官方界面、蓝紫色鲸鱼图标和操作系统分配的本机回环端口。

<a id="run"></a>

## 下载

请在 [GitHub Releases](https://github.com/Missher12/deepseek-harness-desktop/releases) 下载安装包及 SHA-256 校验文件。源码分支不代表安装包已发布；各个发行条目会列出实际文件和验证结果。

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| macOS | Intel x64 | DMG |
| Windows | x64 | Setup EXE |
| Ubuntu | 22.04 / 24.04 x64 | deb / AppImage |

这些社区安装包包含运行所需的环境。macOS 安装包使用本地 ad-hoc 签名，未经公证；Windows 安装包未签名。各平台的安装条件和原生验证结果见发行说明。

## 应用与插件

应用保留官方聊天、模型设置、会话与插件管理器。本发行版不预装 Missher 增强包或其他个人插件。

可选插件通过官方的**插件**页面安装，由各插件声明支持的 Harness 版本。存在 GitHub 仓库或可安装的软件包，不代表已经兼容当前版本。

<a id="run-from-source"></a>

## 源码与打包

官方源码基线为 [dsh-v0.1.6-alpha.2](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.6-alpha.2)。社区打包入口位于 [desktop-packaging](desktop-packaging/)，官方 Electron 桌面壳位于 [apps/desktop](apps/desktop/README.zh.md)。

三端安装包使用同一个集成源码提交构建，并在隔离数据环境下检查安装、应用就绪和退出。这些检查不调用付费模型，也不代表第三方插件兼容性已通过。

源码开发请参阅[开发指南](docs/development.zh.md)、[架构](docs/architecture.zh.md)和[贡献指南](CONTRIBUTING.zh.md)。本发行版的问题请反馈到[当前仓库](https://github.com/Missher12/deepseek-harness-desktop/issues)。

## 许可证

采用 [MIT](LICENSE) 许可证。上游 Harness 由 DeepSeek AI 开发。依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
