# Codex 式对等会话通信与插件市场稳定分类设计

[English](2026-08-18-session-messenger-and-market-refinement-design.md) | 中文

**日期：** 2026-08-18

**状态：** 成品候选已实现

**目标：** Intel macOS 与 Windows x64 的 DeepSeek Harness Desktop 0.1.6

## 目标

用户复制会话 A 的准确 ID，粘贴到会话 B，再让 B 的 Agent 发送消息。DeepSeek Harness 会启动 A 的已有 Agent；A 可以通过可信 delivery 元数据回复 B，任意一方之后也能使用对方 ID 发起另一条消息。这是对等会话通信，不是第二套聊天卡片系统，也不是无界自主循环。

插件市场保留紧凑列表，把搜索和筛选与分类轨道分开，按来源稳定顺序渲染 live registry 的全部分类，并允许横向滚动；切换分类时标签不会移动。

## 对等通信协议

插件注册四个全局工具。`send_message_to_session` 是默认准确 ID 适配器：通过现有 follow-up 路径投递并请求一次目标 wake。`send_message_to_session_and_wait` 在用户要求等待时执行相同投递，并且只等待精确 receipt 绑定回复。`reply_to_session` 从 Host receipt 推导一次性目的地权限，并默认唤醒来源 Agent。`wait_for_session_reply` 可以在有界 timeout 后使用原 delivery 继续等待。

稳定的 `tool:session-collaboration` system-prompt 段会告诉任意一方使用粘贴的准确 Session ID；接收 Agent 在适合回复时使用准确 delivery ID 调用 `reply_to_session`，之后的新消息也可使用可信 Source Session ID。目标空闲、无关 assistant 输出或另一条投递都不能结束等待。timeout 不会触发盲目重发，确认消息也不会形成自动回复循环。

调用方身份来自工具执行，而不是模型输入。消息正文被明确视为不可信内容，不能改变权限或用户规则。目标必须是活动 profile 中的普通会话。缺失、空白、自身、已归档和 subagent 所有的目标都会在 inbox 变化前被拒绝。运行中的目标排在现有工作之后，不会获得并行 driver；cold 普通目标通过 Host 所有的 lookup 恢复。

持久 `user/message` 仍是唯一模型可见记录。可信元数据标明来源 Session ID、delivery ID、模式和正文边界，但不会暴露 Host reply token。write-ahead receipt 和固定 Message ID 保证 exactly-once 入队恢复。停用插件会移除工具、prompt 段、等待、路由、Client 组合、listener 和 timer，但不会删除已提交会话历史。

## 原生 Client 界面

插件保留一个 `conversation.session.header.utilities` 入口和一个 `shell.overlay` 抽屉作为人工操作入口。抽屉可复制当前准确 Session ID、直接发送或回复、显示只含元数据的 receipt 活动、保留失败草稿，并记忆限制在 320–560 像素的宽度。窄窗口使用全宽 sheet。“启动目标 Agent”默认开启。

协同消息使用 Harness 原有的上下文折叠行。已否决的自定义 relay 卡片投影、正文卡片、卡片复制操作和卡片回复操作均不存在，因此会话几何和视觉语言保持原生。关闭抽屉、切换会话、按 Escape 或停用插件都会移除交互层，不修改 receipt 或消息。

## 插件市场分类轨道

registry 仍是分类数量和名称的权威。固定工具栏把全宽搜索／筛选行放在独立分类行上方。`全部` 和每一个 registry 分类保持来源顺序；选择分类只改变选中状态、查询结果和页码。

分类行使用单行不换行的原生横向滚动区。紧凑边缘按钮只在对应方向存在隐藏内容时出现，渐隐提示溢出但不遮挡焦点标签。触控板和键盘方向键保留原生行为；键盘焦点使用最小距离 `scrollIntoView`。减少动画模式关闭平滑移动，页面本身不会获得横向溢出。

## 失败与生命周期行为

精确同源 Client 路由继续执行 generation capability、仅回环 origin、有界正文、当前会话权限、rate limit、receipt 限额、归档／subagent／self 拒绝和拒绝时零修改。Host companion 不可用时仍可复制 Session ID，修改操作只显示一条有界诊断。

抽屉关闭或停用时清理 document listener、活动请求和 resize 工作。市场轨道随组件清理 scroll、resize 和 observer 所有权。Desktop 退出仍只管理自己的 Harness 子进程树与随机回环 listener；发布工作不会终止 Codex 或无关应用。

## 验证与交付

工具测试证明精确注册、wake 投递、单 driver 语义、system-prompt 所有权、receipt 绑定等待、无关输出拒绝、timeout、dispose 和回滚。Client 测试证明默认 wake、原生无卡片渲染、准确 ID 复制、失败草稿保留、Escape／焦点恢复、宽度持久化、未读确认，以及窄屏／减少动画行为。Host 测试覆盖 origin、capability、正文、来源权限、目标拒绝、恢复、回复绑定和失败零修改。

市场测试要求分类顺序稳定、搜索／筛选／分类位置分离、横向溢出、边缘按钮、键盘最小滚动、窄容器重排，以及源码、生成 bundle 与 source map 一致。macOS 与 Windows 成品 smoke 使用临时 `DSH_HOME` 且不发起外部模型请求；它们验证人工操作界面和存储边界，工具测试验证 Agent 协议。原生成品必须在各自平台构建和验收，并在发布前从公开地址重新下载、核对大小和 SHA-256。

## 范围外

创建新会话或 subagent、跨 profile 或跨设备投递、公共网络访问、广播、群组、原生系统通知、无限后台协同、任意 GitHub 安装、新分类服务、ARM macOS 打包和终止无关用户进程不属于本轮优化。
