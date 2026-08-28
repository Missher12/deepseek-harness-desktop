# Agent Note: 封闭 Desktop 控制协议的所有权

Status: implemented

[English](2026-08-28-closed-desktop-control-protocol.md) | 中文

## 问题

浏览器和本地应用控制会跨越两个进程边界，并在后续获得不同的服务与工具消费方。如果复制操作类型或接受可扩展的进程消息，一端就可能解释另一端从未审查的字段；普通 JSON 解析还会隐藏重复 key 的歧义。

## 决策

`@deepseek-ai/dsh-desktop-control-protocol` 拥有 Desktop 控制使用的每个跨进程操作、结果、错误和品牌化标识符。`protocol-v1.json` 是机器可读的清单、字段矩阵与数值限制真源；TypeScript 常量在导入时对其进行自校验，本地实现使用同一文件和原始 fixture。

面向 Harness 的 `BridgeRequest` 与面向 Electron 的 `HelperRequest` 是分离的封闭联合。Bridge 联合共有 27 种请求，包括仅供内部使用的 `control.lease.acquire` 与 `control.lease.release`。Acquire 携带封闭 surface、非空且不重复的 capability 子集，以及保持应用／窗口配对的 targets；浏览器 targets 为空，原生 targets 非空。其结果只公开生效描述符，release 则只返回等待清理完成的确认。两者都不接受或返回审批声明、quota、clock 或 action digest。

只有 helper 联合包含 `lease.install` 与 `input.release`。Install 复用协议所有的配对 targets 与 capabilities，并携带 Electron 编写的总 `operations` 及分类 quota；`agentId` 只用于展示。仅用于恢复的 `input.release` 不携带 lease 字段。成功响应把显式结果绑定到其请求判别值；错误响应使用一份封闭代码清单。

二进制 envelope 将有界 UTF-8 JSON 与原始 PNG 字节分离。截图元数据要求后续紧邻的 PNG，并绑定其 UUID、字节长度、SHA-256、宽度和高度。Decoder 输出与输入分离并深度冻结；图像字节只有一个不可变所有方，其 reader 返回副本。畸形值或 frame 顺序只会关闭用于 Desktop 控制的 decoder。

## 考虑过的替代方案

**将 DTO 复制到每个服务和适配器中。** 这会减少一个包依赖，但也会在最需要防漂移的信任边界产生相互独立的词汇。

**使用带任意操作名与无类型值的通用 RPC envelope。** 这会简化转发，但也会暴露一种可绕过单个操作、字段、结果与限制审查的扩展机制。

**在 JSON 中编码截图。** Base64 会放大消息、混淆 JSON 与图像限制，并产生额外的大型可变副本。相邻原始 frame 让大小与所有权检查保持显式。

## 后果

每个新操作或结果都需要一次经审查的 manifest 与 TypeScript 更新，并修改 fixture；后续本地实现还必须证明逐字节对等。原始 acquire／release frame 与 status、screenshot fixture 一同检入。本包定义 lease 生命周期消息，但刻意不创建 lease，也不负责授权、请求 ledger、进程 generation 或图像归一化；其运行时所有方使用它已校验的值。在仓库预发布阶段，protocol v1 不提供兼容性协商。
