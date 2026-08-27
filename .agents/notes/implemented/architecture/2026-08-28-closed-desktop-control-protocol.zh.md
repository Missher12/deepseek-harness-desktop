# Agent Note: 封闭 Desktop 控制协议的所有权

Status: implemented

[English](2026-08-28-closed-desktop-control-protocol.md) | 中文

## 问题

浏览器和本地应用控制会跨越两个进程边界，并在后续获得不同的服务与工具消费方。如果复制操作类型或接受可扩展的进程消息，一端就可能解释另一端从未审查的字段；普通 JSON 解析还会隐藏重复 key 的歧义。

## 决策

`@deepseek-ai/dsh-desktop-control-protocol` 拥有 Desktop 控制使用的每个跨进程操作、结果、错误和品牌化标识符。`protocol-v1.json` 是机器可读的清单、字段矩阵与数值限制真源；TypeScript 常量在导入时对其进行自校验，本地实现使用同一文件和原始 fixture。

面向 Harness 的 `BridgeRequest` 与面向 Electron 的 `HelperRequest` 是分离的封闭联合。只有 helper 联合包含 `lease.install` 和 `input.release`；前者携带 Electron 编写的 quota，后者不携带 lease 字段。成功响应会把显式结果绑定到其请求判别值，错误响应则使用一套封闭的错误码清单。

二进制 envelope 将有界 UTF-8 JSON 与原始 PNG 字节分离。截图元数据要求后续紧邻的 PNG，并绑定其 UUID、字节长度、SHA-256、宽度和高度。Decoder 输出与输入分离并深度冻结；图像字节只有一个不可变所有方，其 reader 返回副本。畸形值或 frame 顺序只会关闭用于 Desktop 控制的 decoder。

## 考虑过的替代方案

**将 DTO 复制到每个服务和适配器中。** 这会减少一个包依赖，但也会在最需要防漂移的信任边界产生相互独立的词汇。

**使用带任意操作名与无类型值的通用 RPC envelope。** 这会简化转发，但也会暴露一种可绕过单个操作、字段、结果与限制审查的扩展机制。

**在 JSON 中编码截图。** Base64 会放大消息、混淆 JSON 与图像限制，并产生额外的大型可变副本。相邻原始 frame 让大小与所有权检查保持显式。

## 后果

每个新操作或结果都需要一次经审查的 manifest 与 TypeScript 更新，并修改 fixture；后续本地实现还必须证明逐字节对等。本包有意不拥有 lease、授权、请求 ledger、进程 generation 或图像归一化；各运行时所有方使用它已校验的值。在仓库预发布阶段，protocol v1 不提供兼容性协商。
