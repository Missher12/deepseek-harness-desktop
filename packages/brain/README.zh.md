---
description: "外置大脑包组索引：有界 Provider 注册、仲裁与模型上下文注入。"
kind: "package-group"
---

# brain/ —— 外置大脑集成

[English](README.md) | 中文

## 概述

brain 包组负责本地有界 Provider 中心，可向符合条件的顶层轮次加入带来源、明确标记为不受信任的事实或流程上下文。Provider 继续拥有自己的存储和副作用；中心负责注册、仲裁、截止时间与模型上下文上限。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`missher-brain/`](missher-brain/README.zh.md) | 注册有界外置大脑 Provider，并为符合条件的轮次选择一批上下文 | `ctx.brain` |

-----

<a id="related-documentation"></a>
## 相关文档

- [Core 子系统](../../docs/subsystems/core.zh.md) —— Agent 请求组装与顶层轮次所有权。
- [生成的配置目录](../../docs/config-catalog.zh.md) —— 外置大脑中心接受的配置。

-----

<a id="dev-note"></a>
## 开发备注

无。
