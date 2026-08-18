# @deepseek-ai/dsh-session-messenger

[English](README.md) | 中文

面向 Desktop 的 Host 与 Client 插件，用于在同一个活动 profile 内的普通 DeepSeek Harness 会话之间进行有界通信。它注册四个模型工具，持久化 write-ahead 投递 receipt，通过 Host 所有的 Typert lookup 寻址 live 或 cold 会话，把收到的 relay 渲染为可见会话卡片，并提供可调宽的站内消息抽屉，不改变普通 Web 组合。

## 工具约定

- `send_message_to_session(target_session_id, message)` 注入一条持久的 next-step 消息，并且绝不唤醒目标。cold 目标可以恢复为可寻址的内存 Agent，但该路径不发起模型请求，也不启动 driver。
- `followup_session(target_session_id, message)` 排入一条普通 next-turn 跟进消息并请求唤醒。空闲目标沿用并保留其现有 driver；运行中的目标把消息排在当前工作之后，绝不会获得并行 driver。
- `reply_to_session(delivery_id, message, wake?)` 从 Host receipt 推导目的地和一次性权限。私有 token 永远不会进入模型上下文或 Client 元数据；`wake` 默认为 `false`。
- `wait_for_session_reply(delivery_id, timeout_ms?)` 只等待通过 receipt 绑定的显式回复。无关 assistant 输出和 Agent 空闲都不会结束等待；可接受 timeout 为 1,000–55,000 ms，dispose（资源释放）会返回稳定的 `disposed` 结果。

调用方身份始终来自工具执行，不是模型参数。收到的文本是不可信内容而不是权限依据；插件绝不会把普通消息解释为回复、转发或启动自动 Agent loop（智能体循环）的指令。

## 寻址、持久性与生命周期

- 目标必须是当前 profile 中的普通会话。Host 的 Typert `agent` lookup 会复用 live Agent，并用已记录的会话设置执行 cold resume；插件绝不直接调用 `agents.resume()`。
- 归档状态会在 lookup 前检查一次，并在入队前立即同步复查。格式错误、缺失、自身、已归档和 subagent 所有的目标都会在 inbox 变化前被拒绝。
- 每次接受的投递先持久化 `prepared`，再用一个预先创建的 Message ID 入队，最后持久化 `delivered`。恢复会在重试前检查目标 inbox 与事件日志，因此不确定的入队后写入不会重复消息。
- 未解决 receipt 在 24 小时后过期。已结算 receipt 元数据保留七天；已提交的会话消息继续遵循普通会话保留策略，并在插件停用后保留。
- 停用插件会移除其四个工具、五条 HTTP 路由、index bootstrap、活动等待、Client graph 行、标题栏操作、抽屉、监听器和定时器。它不会移除已提交消息或保留的 receipt 存储。

## Desktop 组合

该包发布一个可独立移除的组合包 patch：

```yaml
- insert:
    - id: session-messenger
      name: '@deepseek-ai/dsh-session-messenger'
```

DeepSeek Harness Desktop 会在 base 与 Web 层之后恰好应用一次相同的 canonical 行。仅组合 base 与 Web 时不包含 messenger 行，因此普通 `dsh web` 行为保持不变。

## Client 界面

Client 侧注册一个 `conversation.session.header.utilities` 入口和一个 `shell.overlay` 抽屉。入口显示未读状态，但不改变标题栏几何。抽屉宽度限制为 320–560 px 并会记忆，在窄屏下占满宽度；它可以复制当前 Session ID、发送消息或基于 receipt 回复、保留发送失败的草稿，并显示只含元数据的最近活动。来自本插件的 relay 会在会话中显示为卡片，包含来源 Session ID、delivery ID、正文、复制和回复操作；旧格式或外部 context injection 仍使用普通 fallback renderer。通知仅限站内：没有原生 macOS／Windows 通知、替代会话行、独立消息正文 inbox 或自动 Agent loop。

## 模型体验

### 四个跨会话工具

#### 模型看到的内容

启用时，native Function Calling（函数调用）公开 `send_message_to_session`、`followup_session`、`reply_to_session` 和 `wait_for_session_reply`；Code Mode 通过 `run_code` 背后的生成 `tools` SDK 公开相同四个调用。每条收到的 relay 都是普通 user-role 消息，包含一个可信元数据块和一个单独且明确不可信的正文块。元数据标明来源 Session ID、delivery ID 和投递模式，但永远不会暴露由 Host 持有的 reply token。工具结果报告投递身份、状态、请求的 wake 与稳定错误，但绝不宣称目标已阅读或回复消息。

#### Token 影响

每个启用后的请求都会在 native 模式承担四项工具定义，或在 Code Mode 承担其生成 SDK 声明。已投递 relay 会把受限信封与正文追加到目标下一次领取的上下文；之后每次工具调用与结果都遵循普通会话保留策略。Client receipt 流只含元数据，不增加模型 token。

#### KV Cache 影响

只要插件与展示模式不变，四项定义与 SDK 声明就逐字节稳定，因此会保留相应工具前缀的缓存段。启用或停用插件会改变该段；已投递并领取的 relay 追加在会话尾部，而不会重写先前消息。

## 已知限制与暂缓事项

- 通信仅限一个活动 profile，并且只接受普通会话；尚未实现跨 profile、跨设备、subagent、广播、群组或公共网络投递。
- 抽屉显示投递元数据，而不是第二份消息档案；消息正文保留在目标会话中，并以 relay 卡片显示。
- 原生系统通知暂缓实现，因为它需要本可独立停用包边界之外的 Electron 权限与窗口生命周期所有权。
- 插件提供显式工具，而非自主协调：不会创建自动回复、转发规则、后台 Agent loop 或无界的双 Agent 对话。
