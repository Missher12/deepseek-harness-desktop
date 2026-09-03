# Agent Note: 跨平台桌面安装器

Status: implemented

[English](2026-08-14-cross-platform-desktop-installers.md) | 中文

## 问题

官方 Harness 交付 Web 应用和 CLI，因此桌面用户必须准备 Node.js、从终端启动命令、管理浏览器标签页并避免运行时所有权冲突。Intel 桌面外壳在 macOS 上消除了这些步骤，但它的关闭行为、进程组终止、打开文件所有权检查、ICNS 打包和 DMG 不能提供可安装的 Windows 应用。

## 决策

同一份 Electron 桌面源码支持 Intel macOS 和 Windows x64。共享外壳负责仅限回环地址的 `dsh web` 子进程、加固的渲染器、状态恢复、命令和圆角白鲸图形身份；显式的平台决策只负责操作系统之间确实不同的行为。

- macOS 保留隐藏式标题栏、应用菜单、关闭到 Dock、POSIX 进程组、数据根目录打开文件精确所有权检查、`.app` 和 DMG。
- Windows 使用标准原生窗框、File/Edit/View/Window/Help 菜单、关闭即退出、封闭失败的 PowerShell 进程发现，以及针对准确 PID 的 `taskkill /T /F` 清理。
- 工作台终端选择完整的原生命令：Windows 使用系统内置 PowerShell，POSIX 使用首个可用的 zsh 或 bash 登录 shell。平台参数与可执行文件一起解析，确保 Windows 永远不会收到 POSIX 的 `-l` 参数。
- Electron Builder 以一键、当前用户范围、非升权模式输出一个未签名 Windows x64 NSIS Setup。交互式安装创建桌面和开始菜单快捷方式并启动应用；卸载保留 Harness 与 Electron 数据。
- 圆角 RGBA 母版同时生成 [`icon.icns` 和 `icon.ico`](../../../../apps/desktop/README.zh.md#icon-provenance)，因此 Finder、Dock、Windows 资源管理器、快捷方式、Setup 和卸载程序使用同一个应用图形身份。
- [Windows Setup 设计](../../../../docs/superpowers/specs/2026-08-14-deepseek-harness-windows-setup-design.zh.md)拥有完整的打包、生命周期和失败行为说明。

## 原生验证

平台无关测试在 macOS 上覆盖 Windows 菜单与窗口决策、命令解析、封闭失败的所有权检查、进程树终止、NSIS 设置、工作流接线和成品测试的进程输出解析。生产暂存会验证构建后的桌面入口、Web 客户端、运行时 CLI、图标容器和原生模块是否存在。

独立的 `Windows Desktop Setup` 工作流和仓库原生 Windows PR 任务都运行在 GitHub 面向公开仓库提供的标准 `windows-2025` 运行器上。独立工作流从 `apps/desktop/package.json` 派生精确 Setup 与校验和名称，并作为有界发布路径执行：不可变依赖安装、完整产品构建、Setup 打包、可见安装器页面、隔离安装、两种快捷方式检查、使用临时 Harness 与 Electron 数据启动成品、共享 Add 菜单／工作台／思考等级控件、精确剪贴板值与拒绝反馈、关闭原生窗口、监听端口与进程树清理、卸载、数据标记保留、SHA-256 和产物上传。它没有 Release 写权限；验收后由操作方只追加已验证 Windows 资产。更广泛的原生任务继续提供完整 Windows 检查作为额外证据；如果以后配置了自托管运行器，master 备用任务会运行相同的打包生命周期测试。

## 备选方案

**交付 Web 应用快捷方式和安装脚本。** 否决，因为用户仍然依赖 Node.js、终端、浏览器所有权和可见端口管理，无法满足一键桌面安装。

**关闭 Electron 原生重建并在 macOS 交叉构建 Windows 安装器。** 否决，因为 `node-pty` 明确拒绝跨平台 `node-gyp`，包管理器的可选依赖选择也遵循宿主系统。生成的文件可能看似完整，实际携带错误的原生依赖闭包。

**两个平台共用一种关闭与进程清理实现。** 否决，因为关闭到 Dock 符合 macOS 惯例，却会让 Windows 用户困惑；Windows 也没有 POSIX 进程组或相同的非提权数据根目录打开文件证明。

**在工作流中固定版本化 Windows 产物名。** 否决，因为 Desktop 升级版本后可能已经构建当前产品，但 smoke、校验和或上传仍静默指向旧文件名。

## 后果

- Windows 用户双击一个 Setup 即可获得可用的桌面应用，不需要管理员权限或另行安装运行时。
- Windows 把每个可观察的外部 `dsh web` 进程都视为冲突，因为它无法通过内置非提权检查证明对方使用不同的 `DSH_HOME`。这项选择优先保护数据，而不是支持同时运行多个独立 Harness 实例。
- Windows 发布证据必须来自原生 Windows x64 运行；符合预期的 macOS 交叉构建失败绝不算发布结果。
- 向已有跨平台 Release 追加 Windows 资产时，不得重新构建或替换其中的 Mac 资产；精确资产名及上传前后的资产元数据属于发布验收内容。
- 本地产物仍未签名。在配置受信任的平台签名凭据之前，Windows SmartScreen 和 macOS Gatekeeper 可能要求用户确认。
