# 原生 Computer Use helper

[English](README.md) | 中文

这个 Rust workspace 构建 Desktop 主进程按需使用的私有原生 Computer Use helper。它不是网络服务：Electron 通过带长度前缀的 stdin/stdout 独占一个子进程，能力空闲时不会启动子进程。

## 契约

`protocol` crate 严格解码共享的 [`protocol-v1.json`](../../packages/control/desktop-control-protocol/protocol-v1.json)，拒绝重复或未知字段，在分配正文前执行声明长度限制，并通过 transfer ID、字节长度、SHA-256 和尺寸关联原始 PNG 帧。仓库中的 TypeScript fixture 必须逐字节往返一致。

`core` crate 负责单调时钟租约过期、精确的会话/租约/版本/目标检查和配额。只有 `status`、`list`、`snapshot`、`stop`、`lease.install`、撤销控制和 `input.release` 是已实现的分发路径。打包的空观察平台报告不支持/空列表，并对截图返回 `NOT_SUPPORTED`。聚焦、指针、键盘、文本、滚动和等待请求始终返回 `NOT_SUPPORTED`；此 workspace 不调用 TCC、Accessibility、ScreenCaptureKit、CGEvent、SendInput、AppleScript 或 PowerShell API。

`helper` crate 负责有界 stdio 循环。畸形输入只关闭专用链路，不回显输入或操作系统诊断。EOF 是正常关闭信号。

## 开发

`rust-toolchain.toml` 固定工具链，`Cargo.lock` 固定依赖。

```sh
cd native/computer-use-helper
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

[`scripts/build-computer-use-helper.ts`](../../scripts/build-computer-use-helper.ts) 构建一个 release 目标，并在放入 `apps/desktop/native-bin/<platform>-x64/` 前独立验证可执行文件头。Desktop staging 再次验证只有一个匹配 helper；Electron Builder 将它复制到 ASAR 外的 `resources/native/computer-use-helper[.exe]`。
