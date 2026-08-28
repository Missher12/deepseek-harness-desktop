# Agent Note: 按需原生 Computer Use helper

Status: implemented

[English](2026-08-28-on-demand-native-computer-helper.md) | 中文

## Problem

Desktop 需要一个供后续应用观察使用的原生进程边界，同时不能把原生权限装进 Harness、打开本地端口，或在权限和策略层完成前意外交付输入注入实现。

## Decision

`native/computer-use-helper` 是一个三 crate Rust workspace。protocol crate 使用与 TypeScript 相同的闭集 manifest 和 fixture；core crate 负责单调时钟租约、目标和配额；二进制只负责有界的长度前缀 stdin/stdout。Electron 的 `NativeHelperProcess` 在第一个严格 helper 请求到来时启动打包二进制，最多接纳 32 个已关联待处理请求，复制每一帧，在本地应用请求超时，丢弃子进程 stderr，并通过 EOF 加有界 terminate/kill 梯子关闭。不存在 TCP 或 HTTP 端点。

本次交付保持观察形状，但打包后端是空平台。状态和列表如实返回，截图分发只到达注入的观察接缝并在打包后端返回 `NOT_SUPPORTED`，Stop、撤销和 input-release 只更新 helper 自有状态。所有输入动作都返回 `NOT_SUPPORTED`。Rust 源码不包含 TCC、Accessibility、ScreenCaptureKit、CGEvent、SendInput、AppleScript 或 PowerShell 集成。

发布构建固定 Rust 1.95.0 和 `Cargo.lock`。无 shell 构建脚本只选择 Intel macOS 或 Windows x64，验证实际 Mach-O/PE 文件头，清理生成的 `native-bin`，并暂存一个匹配的可执行文件。Desktop staging 重复身份、数量、文件头和 macOS 可执行位检查。Electron Builder 将所选 helper 放在 ASAR 外，发布流水线在各自原生主机上运行格式化、Clippy、测试、构建和暂存。

## Alternatives considered

**在 Electron 内运行原生观察。** 这样会少一个进程，但会把原生解析器、租约和未来的权限故障放进 UI 权限进程，并失去狭窄的崩溃边界。

**暴露 loopback helper 服务。** 端口会增加发现、认证、生命周期和跨用户攻击面，却不会帮助唯一的 Electron 所有者进程。

**与传输同时实现输入 API。** 这样看起来更完整，却会绕过后续平台权限、批准、前台目标、恢复和真实主机验收工作。闭集 `NOT_SUPPORTED` 响应保留协议，同时不宣称已拥有该权限。

## Consequences

Desktop 增加了一小组固定的 Rust 供应链和两条原生构建流水线，并记录在生成的第三方声明中。CLI/Web 以及 Desktop Computer Use 空闲时 helper 保持休眠。后续平台工作可以替换注入的观察后端而不改变 framing 或 Electron 进程所有权，但启用输入需要单独评审的决定和原生验收证据。
