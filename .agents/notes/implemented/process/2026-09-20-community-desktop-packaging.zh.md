# Agent Note: 打包社区桌面发行版

Status: implemented

[English](2026-09-20-community-desktop-packaging.md) | 中文

## 问题

社区发行版需要提供 macOS、Windows 和 Ubuntu 安装包，同时保留同一套上游应用以及用户独立安装的插件。本发行版没有官方签名凭据，上游也未提供 Linux 桌面打包入口。

## 决定

[desktop-packaging](../../../../desktop-packaging/) 中的包装脚本使用官方源码和包准备流程。Electron、私有 Host 与 Harness 保持同一版本。平台包装脚本提供共用图标及本地签名方式，不增加另一套聊天界面或插件组合。Host 请求操作系统分配本机回环端口。

Linux 使用目标平台专属的运行时锁文件，保留已有 macOS 和 Windows 的运行时选择。原生验证使用没有外部插件的临时 profile，并实际运行安装后的应用。Ubuntu 24.04 使用 Ubuntu 22.04 构建的同一批安装包字节。

社区 macOS 产物使用未经公证的 ad-hoc 签名，Windows 产物使用官方 unsigned 模式。这些入口与[官方打包决定](../architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)中的生产签名和更新验证流程分开。[共用 Web 桌面壳决定](../architecture/2026-09-10-desktop-web-wrapper.zh.md)继续规定应用行为与插件管理方式。

## 考虑过的替代方案

**导入此前的自定义桌面及增强界面。** 这会恢复一套额外产品界面和组合，使每次上游发布都需要适配。独立可选插件保留各自的兼容性工作。

**为 AppImage 关闭 Chromium 沙箱。** 当前锁定的打包器默认加入此参数。社区配置覆盖这一行为，使渲染器保留沙箱。

**用单个平台的构建成功代表所有安装包。** 平台加载器、原生依赖、安装器行为和进程清理各不相同。各目标需要绑定同一源码及产物字节的原生证据。

## 影响

本发行版维护打包与平台专属依赖，上游负责应用本身。完成打包不能单独证明原生可用性或第三方插件兼容性。社区签名不具备官方生产签名的保证；发行说明记录实际签名状态和验证范围。
