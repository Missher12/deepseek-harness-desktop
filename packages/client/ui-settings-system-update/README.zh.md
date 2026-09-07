---
description: "查看 Desktop 与 Harness 安装版本并应用经过校验的 Mac 更新。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-system-update

[English](README.md) | 中文

<a id="summary"></a>
## 概述

这个 Desktop 专用客户端包向设置贡献“系统更新”分区。它渲染狭窄的 `window.dshDesktop` 更新状态，并且只调用由 Electron 主进程拥有的固定检查、下载和安装操作。

本包绝不选择仓库、网络 URL、目标路径、校验和或可执行命令。官方 Harness 标签只用于提示；只有通过验证的 Intel macOS Desktop 发布清单才能启用下载与安装。

页面以状态卡片和独立版本行呈现 Desktop 与内置核心。未完成检查时不会宣称已是最新版；预发行核心带有明确标记。下载进度支持无障碍读取，操作失败保持可见并可展开详情，Desktop 与 Harness 各有更新说明入口。

<a id="table-of-contents"></a>
## 目录

- [模型体验](#model-experience)
- [Invariant ownership](#invariant-ownership)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="invariant-ownership"></a>
## Invariant ownership

不发布不变式伴生入口，因为预加载桥接校验更新快照，渲染器只投影该状态。


<a id="model-experience"></a>
## 模型体验

无，因为本包只展示更新状态并调用 Electron 拥有的固定操作。它不组装提示词、不选择模型，也不发送提供方请求。

#### KV Cache 影响

无；本包从不参与模型请求，也不会改变其缓存行为。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **仅限 Intel macOS Desktop** —— 缺少经过验证的 Electron 预加载桥接时会隐藏本分区，包括普通浏览器和当前 Windows Desktop 构建。
- **固定发布通道** —— 用户不能通过本包选择仓库、镜像、资产、校验和、目标路径或安装程序命令。
- **产物未签名** —— 代码签名与公证仍属于发布基础设施工作；Electron 主进程在安装前仍要求发布清单精确匹配、SHA-256 一致且应用包兼容 x86_64。

<a id="dev-note"></a>
### 开发备注

无。
