---
description: "@deepseek-ai/dsh-reasoning-effort 的中文包参考，涵盖其运行时职责、组合边界与已知限制。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-reasoning-effort

[English](README.md) | 中文

## 概述

这是一个可移除、符合 Harness 风格的单席位模型选择控件。它保留 HanaAyane 锁定版本的 Canvas 思考等级特效，弹层优先显示在输入框下方；模型、真实提交值和当前选项读取活动 Host 的 `ModelDirectory`，固定六档视觉标签再安全映射到每个模型的精确能力。

## 目录

- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

## 行为

- 优先级为 `-100` 的条目只在本插件活动时遮蔽优先级为 `0` 的原生模型控件。
- 弹层通过 portal 渲染，优先与触发器下方保持八像素间距，接近底部边缘时翻到上方；上下都无法完整容纳时，会限制在可见视口内。
- Canvas 光束、像素辐射、波浪和辉光保留上游绘制算法；减少动态效果模式会停止持续动画，但不会移除控件。
- 可选人物滑块在设置缺失或损坏时保持关闭，只有用户明确启用后才会按 profile 持久保存。
- 关闭人物后，直径 28 像素的普通滑块会在两个端点预留自身半径，因此最小与最大选项都保持在轨道内。
- 键盘、指针、触摸、Escape 后焦点归还、点击外部关闭、主题切换、缩放和 Host 目录实时刷新均受支持。
- 被寻址的 subagent 会话继续隐藏。可调模型统一显示 `Low / Medium / High / XHigh / Max / Ultra` 六档；每个视觉档位都会映射到该模型由 Host 公布的最强不超档位，超过模型上限的档位会收敛到真实上限（例如 High-only 模型的 Max／Ultra 都提交 High）。滑块与收起后的触发按钮都会保留用户选中的视觉档位，因此即使提供方实际收到 High 或 Max，选择 Ultra 后仍显示 Ultra；独立的模型上限行继续展示已公布的最强能力。只有完全没有正向推理能力的模型才隐藏滑块；若模型公布 Off，Low 端仍可到达 Off。

## 安装与回退

DeepSeek Harness Desktop 从不可变的 Desktop patch 挂载此 workspace 包。独立 profile 可以使用包内的 `cordis.patch.yml`，但必须先停用或移除原版 `dsh-reasoning-effort`：两者会竞争 `conversation.input.model`，绝不能同时启用。Desktop staging 会拒绝同时含有这两个身份的组合。

Client 入口会声明共享 `ModelDirectory` 所需的全部运行时服务，包括 `remote` 与 `remote.session`。只有这组服务完整可用时，Cordis 才会激活替换席位。

停用或卸载本包并重新载入 profile 后，其优先级为 `-100` 的条目会释放，Harness 会重新选中优先级为 `0` 的原生模型选择器。该回退不会改写模型 provider 配置、会话日志或其他插件数据。组件在渲染期崩溃时同样会退出替换席位，让原生条目恢复。

模块解析、必需服务缺失和插件 `apply` 失败都发生在 React 席位存在之前。因此 Harness 会拒绝激活该 Web 图，并在加载界面报告失败或等待中的条目，而不会声称已经走原生席位回退。Desktop stage 还会在打包前分别拒绝缺少 Host、Client、许可证、声明或 sprite 成品的情况。

## 兼容性与来源

本分支面向 DeepSeek Harness `0.1.2-alpha.2` workspace 约定。其 `workspace:^` peer 描述的是这条已验证源码边界，并不声称兼容原版插件的 `rc.6` 依赖集合。

保留的 Canvas 实现和 `chibi-runner-strip.png` 来自 [`HanaAyane/dsh-reasoning-effort`](https://github.com/HanaAyane/dsh-reasoning-effort) `v0.6.0` 的提交 `f94622b46078ac8c064f91bdc10ab27e8cf32270`。完整 MIT 文本、`Copyright (c) 2026 HanaAyane`、源码 URL、提交和 sprite 归属均保留在 `LICENSE`、包内 `THIRD_PARTY_NOTICES.md`，以及 Desktop 成品根部的 `THIRD_PARTY_NOTICES.md` 中。

## 偏好与数据边界

Host 半只拥有一个按 profile 保存的 `chibiThumb` 布尔值、最多 64 条以确切会话／提供方／模型路由为键的视觉位置，以及一条由每代 capability 鉴权的精确 loopback 偏好端点。这个有界映射不包含 prompt 或回复正文；端点不开放通用设置访问、不启用 CORS，且只接受它持有的两种窄补丁形状。因此 Ultra 视觉选择可跨控件重挂载、会话切换、Desktop 随机端口和应用重启保留，而真实 Host 档位仍是映射后的受支持值。停用插件不会修改会话或 provider 设置，也不承诺删除这些惰性的本地偏好；重新启用时可能继续使用它们。

<a id="dev-note"></a>
## 开发备注

无。

<a id="model-experience"></a>
## 模型体验

### 已选思考等级

#### 模型看到什么

本插件不贡献 prompt、工具或隐藏消息。六档只是稳定的界面刻度；它只通过现有模型目录命令传递映射后、且由确切模型 Host 目录真实公布的 `reasoningEffort`。Host 会在下一次请求边界读取这项普通选择；插件不会把 `Ultra` 等视觉名称伪装成模型不接受的协议值。

#### Token 影响

本身没有：控件不增加 prompt token。provider 可能针对所选等级产生不同推理或输出，但该行为属于所选模型和 adapter。

#### KV Cache 影响

本插件不改写会话历史，因此自身不会改变缓存前缀。修改请求级推理配置能否复用 provider 缓存取决于 provider，本包不作保证。

## 已知限制与欠账

<a id="known-limitations-and-deferred-work"></a>

- 兼容性只针对仓库的 `0.1.2-alpha.2` 约定完成验证；Harness 升级后必须重新检查 peer、服务、staged profile 和视觉表现。
- 按 profile 保存的有界偏好不是卸载清理器；移除插件后，可能保留惰性的人物 opt-in 与视觉路由位置供以后重装使用。
- 原生席位回退覆盖已经进入槽位、随后崩溃的替换组件。注册前失败会让 Web 图保持未激活，必须修复报告中的模块、peer、服务或 `apply` 问题。
