---
description: "@deepseek-ai/dsh-computer-control 的中文包参考，涵盖其运行时职责、组合边界与已知限制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-computer-control

[English](README.md) | 中文

## 概述

Computer Control Service Definition 为跨用户已授权原生应用的有界观察与输入注册唯一一个 `ctx.computerControl` 提供方。它从 [`dsh-desktop-control-protocol`](../desktop-control-protocol/README.zh.md) 导入并重新导出封闭的 request／result DTO 与 brand；原生策略不能扩展该清单。

## 目录

- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

## 约定

- `acquireLease(request, signal)` 是 Consumer／提供方内部操作，它把保持应用／窗口配对的目标与 capabilities 转交给 Electron 权威方。它不是模型工具，也不能自行授权。
- `status()` 报告平台与权限事实。`list(request, signal)` 只返回可供用户授权的应用／窗口。
- `snapshot(request, signal)` 观察一个已授权窗口并返回 `ComputerSnapshotEnvelope`；只要存在图片，其中的有界协议结果与 codec 所有的 `ImmutablePng` 就必须同时存在。`act(request, signal)` 只接受协议中的聚焦、语义／坐标指针、拖动、输入、按键、滚动与等待操作。
- `stop(sessionId)` 等待恰好一个会话的原生资源释放完成。
- `bindComputerReference()` 与 `assertComputerReferenceCurrent()` 把不透明 ref 绑定到会话、应用、PID、进程创建身份、窗口、snapshot revision 和 display scale。任一字段变化即为陈旧；外来会话则未获授权。
- `freezeComputerList()` 与 `freezeComputerSnapshot()` 只接受原语 own-data 字段，在协议上限内重新构建分离的协议集合并深度冻结。可选 PNG 元数据只有在 brand、hash、字节和尺寸校验后，才会严格按协议的五个字段重建。`freezeComputerSnapshotEnvelope()` 会拒绝元数据／PNG 存在性不一致，把协议 `ImmutablePng` 复制进服务所有的存储，剥离额外字段并冻结严格 envelope；不会把原始字节数组作为字段公开。`assertComputerActionCount()` 执行服务的每轮次 64 次操作上限；原生 lease 可以更窄。

## 遇疑即拒策略

`classifyControlPolicy()` 只返回 `ALLOW`、`APPROVAL_REQUIRED` 或 `DENY`。运行时边界会校验普通输入对象，以及协议 request kind、surface、sensitivity 和 effect 的精确清单；无效、accessor-backed、非字符串或未知值都会在不抛异常的情况下被拒绝。已知 secure text、密码、一次性验证码、付款、文件、生物识别、密码管理器、钥匙串、操作系统隐私／安全目标、安装／移除、破坏性删除和下载后执行目标始终被拒绝。无法确定的敏感性或效果也被拒绝。无目标的 status／list request 使用显式的 `not-applicable` 类别，而不是虚构目标。匹配 surface 上的 Stop 只有在清单校验后才无需审批；错误 surface 上的 Stop 则被拒绝。普通只读操作，以及已授权临时／原生 surface 上的普通本地交互会获准；外部副作用和对持久 human browser 的任何变更都需要单独的 Electron 原生审批。

分类器只接受适配器所有的事实。模型输出与页面文本不能自行把目标标成普通；accessibility 语义也不会被当作恶意 JavaScript 没有副作用的证明。

策略的 surface 类型直接使用协议所有的 `ControlLeaseSurfaceKind`，不是复制出的联合。后续工具 Consumer 自行推导官方 session，并填充 request id、deadline、lease id／revision 与其他 transport 字段。模型 schema 不得公开 acquire、authority、approval、quota、clock 或 action digest 字段。

此特权服务仍会写入文档，供受信的静态第一方提供方与 Consumer 阅读；但运行时模型 Cordis 目录会排除它，模型编写的动态包也无法通过属性访问或 `ctx.get()` 取得该服务。

<a id="dev-note"></a>
## 开发备注

无。

<a id="model-experience"></a>
## 模型体验

通过后续 Computer Control 工具 Consumer 间接影响；这些 Consumer 渲染有界观察与封闭操作结果，此 Service Definition 本身不注册 prompt 或工具。

#### KV Cache 影响

不会直接影响；任何模型可见 schema 或结果变化由 Consumer 负责。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 本包是约定、引用验证与策略层，不是原生 helper、Electron bridge、UI 或模型工具。
- 操作系统权限检查、应用授权、lease、quota、捕获节流、按住输入恢复和紧急 Stop 的权威实现仍在 Electron 与原生 helper 中。
- 坐标操作资格仍取决于后续适配器确实没有可用语义 ref，且所选模型支持视觉；本服务不推断这两项事实。
