# @deepseek-ai/dsh-desktop-control-host

[English](README.md) | 中文

这是 [`BrowserControl`](../browser-control/README.zh.md) 与 [`ComputerControl`](../computer-control/README.zh.md) 的 Desktop 专用 Host provider。一个进程级 client、请求 ledger、callback 驱动的发送队列与 lease descriptor cache，通过 Electron 所有的准确 Harness 子进程 IPC 通道同时服务两个 provider。没有自有 Node IPC 通道时，本插件不会注册任一服务，普通 Harness 启动保持不变。

## Transport 与生命周期

- Harness 到 Electron 只接受协议的 27 项 bridge request，以及 `request.cancel`、`session.revoke`；Electron 到 Harness 只接受匹配 response、声明时紧邻且已校验的 PNG、`lease.revoke` 与 `parent.shutdown`。方向检查发生在 image correlation 等待 PNG 之前。
- 每条 Node IPC 消息都是一个复制后的无前缀协议 frame。唯一 callback 驱动队列使每组 JSON 加可选 PNG envelope 保持相邻，绝不把 `child.send()` 的布尔返回值当成送达。
- ledger 最多接纳 32 个 live request，并准确保留 256 个按插入顺序排列的终态 request ID。它绑定官方 session、request kind、generation、deadline、cancellation 与任何已校验 lease tuple；只有准确 response 或 revoke tuple 才能结算。
- Browser 与 Computer provider 共享一个 `ControlLeaseCache`。只有 Electron 编写的 acquire result 会进入该 cache；每个公开 snapshot 都通过所属 service package 的不可变 result／PNG envelope validator 重建。
- `agent/turn-stopping` 会同步让缓存 descriptor 失效，并在独立 cleanup signal 上等待有界 release。fire-and-forget 的 `turn/end` 只排入 fallback tail；`session/flush` 负责 drain，而 `session/disposed` 排入 session revoke。插件 disposal 会在移除 listener 前 drain 全部 tail。
- Desktop shutdown 先停止 admission、等待后续 authority-cleanup seam、在时限内发送 `parent.shutdown`、断开准确 control channel，然后才允许 `HarnessProcess` 终止自有进程树。

这是特权第一方 transport 基础设施，不是模型工具。未来工具 Consumer 会在内部填充协议的官方 session 与 transport 字段；其模型 schema 绝不能暴露 lease acquire、lease／session metadata、approval fact、quota、clock 或 action digest。

## 模型体验

无；该 Host provider 只为后续模型工具 Consumer 传输请求，自身不贡献 prompt、schema 或 result。

#### KV Cache 影响

无；本包既不组装也不发送 provider request。

## 已知限制与延后工作

- **尚无 authority 或原生执行** —— 在后续 control coordinator 接管用户审批、lease 创建、浏览器 dispatch 与 helper 执行之前，注入的 Electron backend 会返回 `NOT_SUPPORTED`。
- **只支持一个自有子进程** —— transport 有意不提供 renderer relay、loopback server、bearer token、通用 channel 或兼容性协商。
- **IPC 丢失会让该 generation 的控制不可用** —— 畸形、方向错误、断连或发送失败只会关闭 control link 并拒绝其工作；不会重启或终止 Harness，也不会影响普通聊天。
