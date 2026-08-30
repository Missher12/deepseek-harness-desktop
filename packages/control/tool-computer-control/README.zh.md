---
description: "@deepseek-ai/dsh-tool-computer-control 的中文包参考，涵盖其运行时职责、组合边界与已知限制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-computer-control

[English](README.md) | 中文

## 概述

这个可选 Consumer 通过准确十二个封闭工具公开 Desktop 所有的原生电脑控制：status、list、snapshot、focus、click、double-click、drag、type、key、scroll、wait 与 Stop。只有存在 `ctx.computerControl` 时才注册模型工具，因此普通 CLI 与 Web 行为保持不变。

## 目录

- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

## 约定

模型不能提供 session、lease、approval、request ID、deadline、进程句柄或通用原生命令。Consumer 推导官方会话，只针对 `computer_list` 返回的精确应用／窗口组合获取一个由提供方创建的 lease，并且只沿用提供方返回的 snapshot revision。Stop 不接受参数、不获取 lease，也不需要 approval。

优先使用语义 ref。只有精确的当前 route 支持图片输入时，才接受截图坐标。`computer_snapshot` 通过 `AttachmentStore` 提交已验证 PNG；原始 PNG 字节绝不会进入文本结果、日志、遥测、记忆或 MSE 输入。password、OTP、payment、file、安装、删除、权限和操作系统安全目标仍由提供方拒绝。

安全工具错误会区分五种判断：电脑控制关闭、应用白名单缺失、操作系统权限被拒、本次原生任务询问被拒，以及目标受保护，并分别返回长度受限的纠正文字。Harness 普通 `ask` 或 `never` 工具策略不能替代 Electron 的逐任务原生批准，也不能预先授权应用。

<a id="dev-note"></a>
## 开发备注

无。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

存在提供方时，模型会看到十二个封闭的 [Computer Control 工具 schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-computer-control)，并在操作前先使用 `computer_list` 与 `computer_snapshot`。缺少提供方时，不会出现任何电脑控制 schema 或 prompt 文本。输入内容不会显示在 pending presentation 中。

#### Token 影响

挂载 Desktop 提供方时，固定 schema 会增加有界的输入成本。应用列表与 snapshot 内容属于逐次调用结果，不属于常驻 prompt 文本。

#### KV Cache 影响

只要 `ComputerControl` 可用性与封闭 schema 不变，工具清单就是前缀稳定的。挂载或移除提供方会改变工具可见性，并可能使该位置之后的复用失效。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- Accessibility 语义无法证明每个外部效果；原生 policy 与可见用户控制始终是权威。
- 坐标 click、double-click、drag 与 scroll 需要视觉 route，且始终是窗口相对坐标。
- 本包不负责原生权限提示、helper 生命周期、lease、approval、allowlist、可见状态胶囊或紧急停止 UI。
