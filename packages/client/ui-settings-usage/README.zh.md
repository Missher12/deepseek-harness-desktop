---
description: "在设置中查看本地索引的用量、活动和功能统计。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-usage

[English](README.md) | 中文

<a id="summary"></a>
## 概述

在设置的使用统计页面查看 token 总量、活动、缓存用量和功能排名。每日、每周与累计范围共用可访问的图表，加载、重试和部分数据状态都保留在页面内。本页请求 Host 的只读汇总，不会把缺失指标伪造为零。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [Invariant ownership](#invariant-ownership)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

Web 与桌面端设置中的只读**使用统计**分区。浏览器插件以顺序 12 注册本地化的 `usage` 分区，并在分区挂载时懒调用 `ctx.remote.usageInsights.snapshot()`。

分区展示累计与峰值 Token、最长活跃会话时长、当前连续天数和最长连续天数。三种口径 都保留同一套 53×7 颗粒：每日是日历热力图，每周与累计则把按周日对齐的列从底部向上 填充。圆角可见浮层按口径使用不同日期文案，依次显示当天 Token、所在周汇总和截至该周 的全历史运行总数。图表下方的活动洞察汇总缓存命中率、最常用模型与推理强度、不同 skill 数、 工具调用数和聊天天数；排行列表会区分 skill 与工具。

加载、重试、空结果和部分数据状态都留在本分区内。首次加载若 15 秒后仍未结束，会退出占位图并显示可重试错误；已保留的汇总会继续显示，并标记刷新已过期。后续成功仍可替换任一状态。缺失指标显示破折号，不伪装成零。 布局沿用现有设置宽度和语义主题 Token，支持键盘切换标签；窄宽度会收拢 KPI 布局，且 不会引入页面横向滚动。

<a id="table-of-contents"></a>

<a id="invariant-ownership"></a>
## Invariant ownership

不发布不变式伴生入口，因为组件在呈现前校验每个 Remote 状态。


<a id="model-experience"></a>
## 模型体验

无，因为本包只在浏览器设置中展示 Host 拥有的使用快照，不注册任何模型接口。

#### KV Cache 影响

无；缓存命中率只是提供方计量的只读可视化，本包既不组装也不发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **快照需要显式刷新** —— 分区在挂载和重试时读取，不会在对话框保持打开期间订阅 每一个实时用量事件。
- **图表密度遵循紧凑设置面板** —— 三种口径都保留 371 个颗粒，并提供无障碍摘要和 悬停总数，但紧凑界面有意不提供按提供方或工作区下钻。
- **没有插件排行榜** —— 列表标为“最常用的功能”，因为 Host 无法如实恢复每次历史 工具调用的插件归属。

<a id="dev-note"></a>
### 开发备注

无。
