# @deepseek-ai/dsh-desktop-control-protocol

[English](README.md) | 中文

跨进程 Desktop 控制操作、结果、错误和品牌化标识符的唯一 TypeScript 真源。Harness 到 Electron 的请求使用 `BridgeRequest`；Electron 到 helper 的请求使用 `HelperRequest`，从而使仅用于恢复的 `input.release` 和 Electron 编写的 `lease.install` 不会进入子进程请求联合。本包是纯库，不注册运行时服务或工具。

## Protocol v1

[`protocol-v1.json`](protocol-v1.json) 是 TypeScript 和本地实现共用的机器可读清单、字段矩阵与限制真源。如果 TypeScript 常量发生偏离，导入时的 `assertProtocolManifest()` 就会失败。三类请求都是封闭的：25 种 bridge、14 种 helper 和 4 种 control。响应会回显精确的请求种类，并与显式结果类型或 17 种错误码之一配对；不存在通用结果逃逸口。

严格 decoder 会在整份 JSON 解析可以套用 last-wins 行为前拒绝重复 key。它也拒绝危险 key、未知或缺失字段、未知判别值、错误版本、畸形标识符、非有限或超范围数字，以及超过 UTF-8 限制的值。解码后的 JSON 与输入分离并深度冻结。

## 分帧与图像

无前缀 frame 以 tag `0x01` 开始时，后续最多为 65,536 个 JSON 字节；以 tag `0x02` 开始时，后续为 16 字节 transfer UUID 和最多 4,194,304 个原始 PNG 字节。`LengthPrefixedFrameDecoder` 接受 helper 流中拆分或合并的输入，其 4 字节大端长度包含 tag 和 body；它会在分配 body 之前拒绝零值与超限长度。

`DesktopControlFrameDecoder` 要求截图元数据与其 PNG 相邻。它校验 transfer ID、字节长度、SHA-256、PNG 签名、IHDR 尺寸和顺序，随后通过 `ImmutablePng.read()` 公开图像字节，每次读取都返回新副本。任何畸形或顺序错误的输入都会永久关闭该 decoder 实例，但不为 Harness 或聊天生命周期定义行为。

## API 所有权

`RequestId`、`ControlLeaseId` 和 `PngTransferId` 是规范的小写 UUID；`BrowserRef` 和 `ComputerRef` 使用不同固定前缀与 32 位小写十六进制数字。本包从 `@deepseek-ai/dsh-session/types` 导入并重新导出官方 `SessionId`；wire 校验将其 UTF-8 表示限制为 128 字节，但不改变所有方定义的字符集。

Bridge deadline 保持 wall-clock 值，便于 Electron 缩短并转换；`assertBridgeDeadline(request, nowUnixMs)` 执行由调用方提供的当前时间检查与 30 秒上限。Helper 请求则携带 1 至 30,000 之间的 `timeoutMs`。有状态请求关联、重复请求 tombstone、取消与子进程 generation 属于 Host bridge，而不是这个无状态 codec。[封闭协议 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-28-closed-desktop-control-protocol.zh.md) 记录了该所有权决策。

## Model Experience

无，因为本包只校验进程消息，不注册 prompt、工具 schema 或模型结果。

#### KV Cache 影响

无；本包既不组装也不发送模型请求。

## 已知限制与暂缓事项

- **Protocol v1 不提供协商或兼容适配器**——在仓库预发布兼容立场下，不支持的版本会失败关闭。
- **Codec 不会授权操作**——Electron 和本地 helper 在消费这些已校验 DTO 时，仍必须强制 lease、policy、quota、deadline 和撤销。
- **PNG 解析被有意限制**——codec 会校验签名、IHDR 尺寸与已声明的关联事实；在图像供模型使用前，完整归一化属于 attachment service。
