# Agent Note: 按需原生 Computer Use helper

Status: implemented

[English](2026-08-28-on-demand-native-computer-helper.md) | 中文

## Problem

Desktop 需要一个供后续应用观察使用的原生进程边界，同时不能把原生权限装进 Harness、打开本地端口，或在权限和策略层完成前意外交付输入注入实现。

## Decision

`native/computer-use-helper` 是一个三 crate Rust workspace。protocol crate 使用与 TypeScript 相同的闭集 manifest 和 fixture；core crate 负责单调时钟租约、目标和配额；二进制只负责有界的长度前缀 stdin/stdout。Electron 的 `NativeHelperProcess` 在第一个严格 helper 请求到来时启动打包二进制，最多接纳 32 个已关联待处理请求，复制每一帧，在本地应用请求超时，丢弃子进程 stderr，并通过 EOF 加有界 terminate/kill 梯子关闭。不存在 TCP 或 HTTP 端点。

打包 helper 会选择目标专用的 macOS 14+ 或 Windows x64 后端，而不支持的目标继续使用空后端。macOS 状态只执行不会弹窗的 TCC 预检；列表把每个屏幕内 SCK 窗口号绑定到 PID、内核进程启动时间和 bundle 身份；快照把精确目标唯一重新绑定到一个 AX 窗口，并可选择通过 ScreenCaptureKit 捕获。Windows 绑定 HWND、PID、进程创建身份、边界和每显示器 DPI；快照投影有界且脱敏的 UI Automation 树，并可选择通过 Windows Graphics Capture 捕获精确 HWND。两个后端都会重新验证身份，只暴露有界语义 ref，输出相邻的有界 PNG 帧，并对隐藏、最小化、窗口外、迟到、重用或受保护目标执行 fail-closed。

只有 Electron 安装了精确绑定目标的租约，且 helper 已生成新鲜语义快照后，输入才可用。macOS 后端使用 CGEvent，Windows 后端使用 SendInput；两者都会在原生事件前重新验证身份、权限、取消、截止时间、能力、配额与快照修订，并为 Stop、撤销、EOF 和崩溃恢复保留释放日志。两个后端都不会提权、修改隐私设置，也不会回退到 AppleScript 或 PowerShell。Electron 会把拒绝/未知权限状态映射为只展示的手动系统指引。

发布构建固定 Rust 1.95.0 和 `Cargo.lock`。无 shell 构建脚本只选择 Intel macOS 或 Windows x64，验证实际 Mach-O/PE 文件头，清理生成的 `native-bin`，并暂存一个匹配的可执行文件。Desktop staging 重复身份、数量、文件头和 macOS 可执行位检查。Electron Builder 将所选 helper 放在 ASAR 外，发布流水线在各自原生主机上运行格式化、Clippy、测试、构建和暂存。Windows Setup 验收随后会用安装目录中的这个精确 helper 操作两个隔离的无害窗口和一个受保护 fixture，证明 UI Automation、有界 Windows Graphics Capture PNG framing、SendInput、受保护目标拒绝、Stop/租约撤销、EOF 退出、Harness 关闭、卸载、进程清理与数据保留。

## Alternatives considered

**在 Electron 内运行原生观察。** 这样会少一个进程，但会把原生解析器、租约和未来的权限故障放进 UI 权限进程，并失去狭窄的崩溃边界。

**暴露 loopback helper 服务。** 端口会增加发现、认证、生命周期和跨用户攻击面，却不会帮助唯一的 Electron 所有者进程。

**与最初传输同时启用输入。** 此方案被拒绝，因为它会绕过平台权限、批准、前台目标、恢复和真实主机验收。输入只在这些授权层和原生清理验收齐备后交付；在此之前，闭集协议一直保留 `NOT_SUPPORTED`。

## Consequences

Desktop 增加了一小组固定的 Rust 供应链和两条原生构建流水线，并记录在生成的第三方声明中。CLI/Web 以及 Desktop Computer Use 空闲时 helper 保持休眠。macOS 观察依赖屏幕录制和辅助功能授权，但查询当前状态绝不会触发弹窗。Windows 会在不提权的前提下拒绝安全桌面、更高完整性、受 UIPI 阻断、身份复用和敏感目标。因此原生输入既受已评审授权代码约束，也受真实宿主清理验收约束，而不是仅因协议存在就可执行。
