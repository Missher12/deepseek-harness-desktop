---
description: "供 Desktop 扩展使用官方客户端服务的共享浏览器导入入口。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-runtime

[English](README.md) | 中文

## 概述

Desktop 扩展可以通过 `/client` 入口导入共享 store 辅助函数与客户端约定类型。本包不拥有活动服务。Session Controller、Workspace Controller、Conversation、renderer 和 store 包各自拥有运行时状态与行为。

## 目录

- [消费者约定](#consumer-contract)
- [实现](#implementation)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="consumer-contract"></a>
## 消费者约定

浏览器入口从 [client-store](../store/README.zh.md) 重导出 `createSnapshotStore`、`defineStore` 与 `shallowEqual`。类型导出描述 Session 绑定与列表状态、Session 与 Workspace 标识、renderer 根属性及 Conversation 节点定义。[Session Controller](../../api/session-controller/README.zh.md) 拥有 Session 生命周期；[Conversation 包](../ui-conversation/README.zh.md) 拥有共享会话约定。

<a id="implementation"></a>
## 实现

<details>
<summary>实现细节 — 点击展开</summary>

两个 Cordis `apply` 入口都不执行注册。[浏览器入口](src/client/index.ts) 将导入转发给相应的所有者包，因此挂载本包不会重复创建 Session、Workspace 或 store 服务。本包不拥有可变运行时关系，所以不发布运行时不变式伴生入口，也不提供配置伴生入口。

</details>

<a id="model-experience"></a>
## 模型体验

### 浏览器导入

#### 模型会看到什么

没有直接内容：`createSnapshotStore` 与类型导出不构造模型请求、工具或提示词内容。

#### Token 影响

无。消费包拥有自己从客户端状态派生的模型侧内容。

#### KV Cache 影响

无。这些导出不组装或修改请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **需要所有者插件** —— 导入类型或挂载本包不会激活 Session、Workspace、Conversation 或 renderer 服务。
- **浏览器值使用 `/client`** —— 裸包入口是不执行注册的 Host 插件入口。

<a id="dev-note"></a>
### 开发备注

无。
