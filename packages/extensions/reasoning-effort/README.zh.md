# @deepseek-ai/dsh-reasoning-effort

[English](README.md) | 中文

这是一个可移除、符合 Harness 风格的单席位模型选择控件。它保留 HanaAyane 锁定版本的 Canvas 思考等级特效，弹层优先显示在输入框下方，并且所有模型、等级标签、提交值和当前选项都只读取活动 Host 的 `ModelDirectory`。

## 行为

- 优先级为 `-100` 的条目只在本插件活动时遮蔽优先级为 `0` 的原生模型控件。
- 弹层通过 portal 渲染，优先与触发器下方保持八像素间距，接近底部边缘时翻到上方；上下都无法完整容纳时，会限制在可见视口内。
- Canvas 光束、像素辐射、波浪和辉光保留上游绘制算法；减少动态效果模式会停止持续动画，但不会移除控件。
- 可选人物滑块在设置缺失或损坏时保持关闭，只有用户明确启用后才会按 profile 持久保存。
- 键盘、指针、触摸、Escape 后焦点归还、点击外部关闭、主题切换、缩放和 Host 目录实时刷新均受支持。
- 被寻址的 subagent 会话继续隐藏；当某个模型的 Host 等级少于两个时，仍保留普通模型选择，不显示无意义的滑块。

## 安装与回退

DeepSeek Harness Desktop 从不可变的 Desktop patch 挂载此 workspace 包。独立 profile 可以使用包内的 `cordis.patch.yml`，但必须先停用或移除原版 `dsh-reasoning-effort`：两者会竞争 `conversation.input.model`，绝不能同时启用。Desktop staging 会拒绝同时含有这两个身份的组合。

停用或卸载本包并重新载入 profile 后，其优先级为 `-100` 的条目会释放，Harness 会重新选中优先级为 `0` 的原生模型选择器。该回退不会改写模型 provider 配置、会话日志或其他插件数据。组件在渲染期崩溃时同样会退出替换席位，让原生条目恢复。

模块解析、必需服务缺失和插件 `apply` 失败都发生在 React 席位存在之前。因此 Harness 会拒绝激活该 Web 图，并在加载界面报告失败或等待中的条目，而不会声称已经走原生席位回退。Desktop stage 还会在打包前分别拒绝缺少 Host、Client、许可证、声明或 sprite 成品的情况。

## 兼容性与来源

本分支面向 DeepSeek Harness `0.1.0-rc.5` workspace 约定。其 `workspace:^` peer 描述的是这条已验证源码边界，并不声称兼容原版插件的 `rc.6` 依赖集合。

保留的 Canvas 实现和 `chibi-runner-strip.png` 来自 [`HanaAyane/dsh-reasoning-effort`](https://github.com/HanaAyane/dsh-reasoning-effort) `v0.6.0` 的提交 `f94622b46078ac8c064f91bdc10ab27e8cf32270`。完整 MIT 文本、`Copyright (c) 2026 HanaAyane`、源码 URL、提交和 sprite 归属均保留在 `LICENSE`、包内 `THIRD_PARTY_NOTICES.md`，以及 Desktop 成品根部的 `THIRD_PARTY_NOTICES.md` 中。

## 偏好与数据边界

Host 半只拥有一个按 profile 保存的 `chibiThumb` 布尔值，以及一条由每代 capability 鉴权的精确 loopback 偏好路由。它不开放通用设置访问，也不启用 CORS。停用插件不会修改会话或 provider 设置，也不承诺删除这项无害的已存 opt-in；重新启用时可能继续使用它。

## 模型体验

### 已选思考等级

#### 模型看到什么

本插件不贡献 prompt、工具或隐藏消息。它只通过现有模型目录命令传递用户选择的 Host 公布 `reasoningEffort`；Host 会在下一次请求边界读取这项普通选择。

#### Token 影响

本身没有：控件不增加 prompt token。provider 可能针对所选等级产生不同推理或输出，但该行为属于所选模型和 adapter。

#### KV Cache 影响

本插件不改写会话历史，因此自身不会改变缓存前缀。修改请求级推理配置能否复用 provider 缓存取决于 provider，本包不作保证。

## 已知限制与欠账

- 兼容性只针对仓库的 `0.1.0-rc.5` 约定完成验证；Harness 升级后必须重新检查 peer、服务、staged profile 和视觉表现。
- 按 profile 保存的人物偏好刻意保持很小，但它不是卸载清理器；移除插件后，可能保留这个惰性布尔值供以后重装使用。
- 原生席位回退覆盖已经进入槽位、随后崩溃的替换组件。注册前失败会让 Web 图保持未激活，必须修复报告中的模块、peer、服务或 `apply` 问题。
