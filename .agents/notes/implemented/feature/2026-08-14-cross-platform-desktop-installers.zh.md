# Agent Note: 跨平台桌面安装器

Status: implemented

[English](2026-08-14-cross-platform-desktop-installers.md) | 中文

## 问题

官方 Harness 交付 Web 应用和 CLI，因此桌面用户必须准备 Node.js、从终端启动命令、管理浏览器标签页并避免运行时所有权冲突。Intel 桌面外壳在 macOS 上消除了这些步骤，但它的关闭行为、进程组终止、打开文件所有权检查、ICNS 打包和 DMG 不能提供可安装的 Windows 应用。

## 决策

同一份 Electron 桌面源码支持 Intel macOS 和 Windows x64。共享外壳负责仅限回环地址的 `dsh web` 子进程、加固的渲染器、状态恢复、命令和圆角白鲸图形身份；显式的平台决策只负责操作系统之间确实不同的行为。

- macOS 保留隐藏式标题栏、应用菜单、关闭到 Dock、POSIX 进程组、数据根目录打开文件精确所有权检查、`.app` 和 DMG。
- Windows 使用标准原生窗框、File/Edit/View/Window/Help 菜单、关闭即退出、封闭失败的 PowerShell 进程发现，以及针对准确 PID 的 `taskkill /T /F` 清理。
- Electron Builder 以一键、当前用户范围、非升权模式输出一个未签名 Windows x64 NSIS Setup。交互式安装创建桌面和开始菜单快捷方式并启动应用；卸载保留 Harness 与 Electron 数据。
- 圆角 RGBA 母版同时生成 [`icon.icns` 和 `icon.ico`](../../../../apps/desktop/README.md#icon-provenance)，因此 Finder、Dock、Windows 资源管理器、快捷方式、Setup 和卸载程序使用同一个应用图形身份。
- [Windows Setup 设计](../../../../docs/superpowers/specs/2026-08-14-deepseek-harness-windows-setup-design.md)拥有完整的打包、生命周期和失败行为说明。

## 原生验证

平台无关测试在 macOS 上覆盖 Windows 菜单与窗口决策、命令解析、封闭失败的所有权检查、进程树终止、NSIS 设置、工作流接线和成品测试的进程输出解析。生产暂存会验证构建后的桌面入口、Web 客户端、运行时 CLI、图标容器和原生模块是否存在。

仓库的原生 Windows PR 任务运行在 GitHub 面向公开仓库提供的标准 `windows-2025` 运行器上。它会在完整 Windows 检查之后构建 Setup，把它安装到隔离目录，验证两种快捷方式，使用临时 Harness 和 Electron 数据启动已安装程序，打开设置，关闭原生窗口，证明监听端口与应用拥有的进程树已经消失，然后卸载、确认两份数据标记仍然保留、记录 SHA-256，并上传程序和校验文件。如果以后配置了自托管运行器，master 备用任务会运行相同的构建与生命周期测试。

## 备选方案

**交付 Web 应用快捷方式和安装脚本。** 否决，因为用户仍然依赖 Node.js、终端、浏览器所有权和可见端口管理，无法满足一键桌面安装。

**关闭 Electron 原生重建并在 macOS 交叉构建 Windows 安装器。** 否决，因为 `node-pty` 明确拒绝跨平台 `node-gyp`，包管理器的可选依赖选择也遵循宿主系统。生成的文件可能看似完整，实际携带错误的原生依赖闭包。

**两个平台共用一种关闭与进程清理实现。** 否决，因为关闭到 Dock 符合 macOS 惯例，却会让 Windows 用户困惑；Windows 也没有 POSIX 进程组或相同的非提权数据根目录打开文件证明。

## 后果

- Windows 用户双击一个 Setup 即可获得可用的桌面应用，不需要管理员权限或另行安装运行时。
- Windows 把每个可观察的外部 `dsh web` 进程都视为冲突，因为它无法通过内置非提权检查证明对方使用不同的 `DSH_HOME`。这项选择优先保护数据，而不是支持同时运行多个独立 Harness 实例。
- Windows 发布证据必须来自原生 Windows x64 运行；符合预期的 macOS 交叉构建失败绝不算发布结果。
- 本地产物仍未签名。在配置受信任的平台签名凭据之前，Windows SmartScreen 和 macOS Gatekeeper 可能要求用户确认。
