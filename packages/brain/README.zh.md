---
description: "本地记忆上下文协调及其独立管理的提供方。"
kind: "package-group"
---

# brain/ — 本地记忆协调

[English](README.md) | 中文

## 概述

brain 组从已注册的记忆与学习提供方选择有界上下文。每个提供方拥有自己的数据与变更。Desktop 组合不挂载本组；源码保留供独立维护使用。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

[`missher-brain`](missher-brain/README.zh.md) 负责提供方注册、有界选择与上下文来源标注。包参考文档说明模型侧约定。

<a id="related-documentation"></a>
## 相关文档

[扩展子系统](../../docs/subsystems/extensions.zh.md) 负责插件组合。[核心子系统](../../docs/subsystems/core.zh.md) 负责将选中的上下文纳入轮次。

<a id="dev-note"></a>
### 开发备注

无。
