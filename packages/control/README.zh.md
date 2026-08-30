---
description: "Desktop 控制包组索引：封闭协议、Browser Control、Computer Control 与受信 Host provider。"
kind: "package-group"
---

# control/ —— Desktop 控制能力

[English](README.md) | 中文

## 概述

本组负责封闭的进程协议，以及使用该协议的 Browser Control 和 Computer Control 能力家族。协议类型与服务、提供方和面向模型的工具保持分离，从而让每个进程都校验同一套操作与结果词汇。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | 形式 |
|---|---|---|
| [`desktop-control-protocol/`](desktop-control-protocol/README.zh.md) | 严格的 protocol v1 DTO、manifest、JSON／PNG codec 与 helper 流分帧 | 库 |
| [`browser-control/`](browser-control/README.zh.md) | 语义浏览器 Service Definition、所有者绑定 ref 与不可变上限 | Service Definition |
| [`computer-control/`](computer-control/README.zh.md) | 原生控制 Service Definition、所有者绑定 ref 与遇疑即拒策略 | Service Definition |
| [`desktop-control-host/`](desktop-control-host/README.zh.md) | 通过自有子进程 IPC ledger 提供 Desktop 专用 Browser／Computer provider | Service Provider |

本组的提供方与 Consumer 复用这些协议类型，不重新声明跨进程操作、结果、标识符、lease target 或 capability／surface 联合。两条服务 seam 都向受信 Consumer 提供内部 lease acquire；它绝不是模型工具。没有 Electron 所有的子进程 IPC 时，Desktop Host provider 不注册任何服务。

-----

<a id="related-documentation"></a>
## 相关文档

- [Desktop-control 子系统](../../docs/subsystems/desktop-control.zh.md) —— 权限、租约、surface 所有权、协议上限与清理保证。
- [生成的工具目录](../../docs/tool-catalog.zh.md) —— 封闭的 Browser Control 与 Computer Control 模型工具。

-----

<a id="dev-note"></a>
## 开发备注

无。
