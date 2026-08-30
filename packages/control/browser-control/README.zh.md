---
description: "@deepseek-ai/dsh-browser-control 的中文包参考，涵盖其运行时职责、组合边界与已知限制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-control

[English](README.md) | 中文

## 概述

Browser Control Service Definition 为 Desktop 所有的可见浏览器 surface 注册唯一一个 `ctx.browserControl` 提供方。它使用 [`dsh-desktop-control-protocol`](../desktop-control-protocol/README.zh.md) 的封闭 request／result DTO，不定义第二套 wire 词汇。

## 目录

- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

## 约定

- `acquireLease(request, signal)` 是 Consumer／提供方内部操作，它把协议所有的目标 surface、targets 和 capabilities 转交给 Electron 权威方。它不是模型工具，也不能自行授权。
- `snapshot(request, signal)` 返回 `BrowserSnapshotEnvelope`；只要存在图片，其中的有界协议结果与 codec 所有的 `ImmutablePng` 就必须同时存在。
- `act(request, signal)` 只接受协议中的导航、语义引用、按键、选择、滚动与等待操作。浏览器坐标操作不存在。
- `revokeSession(sessionId)` 等待恰好一个会话的拆卸完成；surface 的独占生命周期和引用失效由实现负责。
- `bindBrowserReference()` 与 `assertBrowserReferenceCurrent()` 把不透明 ref 绑定到官方会话、surface 身份、mount generation 和 snapshot revision。所有权先于新鲜度检查，避免外来会话探测 surface。
- `freezeBrowserSnapshot()` 只接受原语 own-data 字段，重新构建分离的协议输出，并在执行语义集合与 UTF-8 上限后深度冻结。可选 PNG 元数据只有在 brand、hash、字节和尺寸校验后，才会严格按协议的五个字段重建。`freezeBrowserSnapshotEnvelope()` 会拒绝元数据／PNG 存在性不一致，把协议 `ImmutablePng` 复制进服务所有的存储，剥离额外字段并冻结严格 envelope；不会把原始字节数组作为字段公开。`assertBrowserActionCount()` 执行服务的每轮次 64 次操作上限；Electron 创建的 lease quota 可以更窄。

页面文本始终不受信任，不能授权操作。此 seam 不声称 accessibility 语义能够证明恶意页面 JavaScript 不会产生外部副作用。surface、debugger、URL／redirect 验证、lease 和原生审批挑战均由 Electron 适配器负责。

后续工具 Consumer 自行推导官方 session，并填充每个 request id、deadline、lease id／revision 与其他 transport 字段。模型 schema 不得公开 lease acquire、session 或 lease 元数据、approval、quota、clock 或 action digest 字段。

此特权服务仍会写入文档，供受信的静态第一方提供方与 Consumer 阅读；但运行时模型 Cordis 目录会排除它，模型编写的动态包也无法通过属性访问或 `ctx.get()` 取得该服务。

<a id="dev-note"></a>
## 开发备注

无。

<a id="model-experience"></a>
## 模型体验

通过后续 Browser Control 工具 Consumer 间接影响；这些 Consumer 渲染有界 snapshot 与封闭操作结果，此 Service Definition 本身不注册 prompt 或工具。

#### KV Cache 影响

不会直接影响；任何模型可见 schema 或结果变化由 Consumer 负责。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 本包是约定与验证层，不是浏览器后端、Electron bridge、UI 或模型工具。
- 提供方仍须在权威边界拒绝陈旧导航竞态、外来 debugger、私网目标、文件输入、下载、popup 和不支持的权限。
- 固定的每轮次操作上限只作补充，不能替代更短的 Electron lease 及其 quota。
