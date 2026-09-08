# Agent Note：Ubuntu Desktop 打包与原生验收

状态：已实现

[English](2026-09-09-ubuntu-desktop-packaging.md) | 中文

## 问题

Desktop 发布暂存原先覆盖 macOS 和 Windows，而 Linux 需要自己的原生模块、安装包依赖、桌面集成与 Chromium 用户命名空间策略。在其他操作系统生成安装包，无法证明这些部分能协同工作。

## 决策

在 Ubuntu 22.04 使用 Clang 15 和通过探测的 Landlock 启动器，原生构建 x64 `.deb` 与 AppImage。共享暂存清单加入 Linux builder 配置，原生窗口使用现有 PNG 母版。Ubuntu 执行任务提供平台配置、启动包装器、AppArmor 辅助脚本和生命周期测试；共享运行时源码保持单一实现所有者。

Ubuntu 22.04 与 24.04 使用完全相同的产物并验证 SHA-256。原生检查覆盖安装、渲染器隔离、受控回环模型、退出及保留数据的移除。安装包身份与内核观测独立于界面就绪状态记录。X11/Xvfb 证据不能证明 Wayland 已通过验收。

## 考虑过的替代方案

**沿用 builder 旧版 AppImage 沙箱回退。** 它可能加入 `--no-sandbox`。打包启动器拒绝关闭沙箱的参数，渲染器必须保留 Seccomp、NoNewPrivs 和独立用户命名空间。

**关闭 Ubuntu 24.04 的系统级用户命名空间限制。** 应用专属策略只给已安装的 Debian 可执行文件或一个明确的 AppImage 路径授予所需权限。原生测试保持系统限制开启。

## 影响

Debian 安装管理桌面入口、图标、依赖和 AppArmor 策略。Ubuntu 24.04 的 AppImage 用户需先运行匹配的准确路径辅助脚本；路径变化后要更新策略。Linux 自更新、ARM64 和 Wayland 验收不在本次范围内。安装包构建成功不能单独作为发布证据；发布需要最终共享源码版本的完整原生生命周期检查。

## 测试

本地测试覆盖暂存、原生窗口配置、Linux 启动包装器及内核观测的接受和拒绝，包括 Chromium 用空格连接参数的进程标题。原生矩阵保留安装包字节摘要和失败证据。平台验收状态记录在发布交接中，不在这份实现说明中维护。
