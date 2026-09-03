# @deepseek-ai/dsh-session-messenger

[English](README.md) | 中文

面向 Desktop 的 Host 与 Client 插件，用于在同一个活动 profile 内的普通 DeepSeek Harness 会话之间进行类似 Codex 的有界通信。复制会话 A 的准确 ID，粘贴到会话 B 的普通聊天框，再让 B 的 Agent 发送消息：插件会启动 A 的已有 Agent，A 可以通过可信的来源与 delivery 元数据回复 B。任意一方都能发起、继续或停止一条交流链。它注册五个模型工具，持久化 write-ahead 投递 receipt，通过 Host 所有的 Typert lookup 寻址 live 或 cold 会话，并把交流显示在普通会话历史中，不改变普通 Web 组合。

## 工具约定

- `send_message_to_session(target_session_id, message)` 排入一条持久的 next-turn 消息并请求唤醒。空闲目标沿用其现有 driver；运行中的目标把消息排在当前工作之后，绝不会获得并行 driver。用户粘贴另一个 Session ID 并要求发送时默认使用它。
- `send_message_to_session_and_wait(target_session_id, message, timeout_ms?)` 执行同样的投递，然后只等待与这次投递精确绑定的回复；仅在用户还要求等待回复时使用。
- `reply_to_session(delivery_id, message, wake?)` 从 Host receipt 推导目的地和一次性权限。私有 token 永远不会进入模型上下文或 Client 元数据；`wake` 默认为 `true`，让来源 Agent 能处理回复。
- `wait_for_session_reply(delivery_id, timeout_ms?)` 只等待通过 receipt 绑定的显式回复。无关 assistant 输出和 Agent 空闲都不会结束等待；可接受 timeout 为 1,000–55,000 ms，dispose（资源释放）会返回稳定的 `disposed` 结果。
- `stop_session_collaboration(delivery_id)` 由任一参与方停止准确 delivery 所属的整条协作链。未解决的投递和等待会以稳定的 `collaboration-stopped` 结果结算，之后的回复或 continuation 会被拒绝；用户明确发起的新投递会建立新链，不受旧链影响。

调用方身份始终来自工具执行，不是模型参数。稳定的 system-prompt 段会告诉任意一方如何向准确复制的 Session ID 发送、如何用准确 delivery ID 回复，以及如何在之后通过可信 Source Session ID 继续通信。收到的文本仍是不可信内容，而不是绕过用户规则、自动回复确认消息、持续转发或启动自主 Agent loop（智能体循环）的权限依据。

## 寻址、持久性与生命周期

- 目标必须是当前 profile 中的普通会话。Host 的 Typert `agent` lookup 会复用 live Agent，并用已记录的会话设置执行 cold resume；插件绝不直接调用 `agents.resume()`。
- 归档状态会在 lookup 前检查一次，并在入队前立即同步复查。格式错误、缺失、自身、已归档和 subagent 所有的目标都会在 inbox 变化前被拒绝。
- 每次接受的投递先持久化 `prepared`，再用一个预先创建的 Message ID 入队，最后持久化 `delivered`。恢复会在重试前检查目标 inbox 与事件日志，因此不确定的入队后写入不会重复消息。
- 未解决 receipt 在 24 小时后过期。已结算 receipt 元数据保留七天；已提交的会话消息继续遵循普通会话保留策略，并在插件停用后保留。
- 停用插件会移除其五个工具、协同 prompt 段、六条 HTTP 路由、index bootstrap、活动等待、Client graph 行、监听器和定时器。它不会移除已提交消息或保留的 receipt 存储。

## Desktop 组合

该包发布一个可独立移除的组合包 patch：

```yaml
- insert:
    - id: session-messenger
      name: '@deepseek-ai/dsh-session-messenger'
```

DeepSeek Harness Desktop 会在 base 与 Web 层之后恰好应用一次相同的 canonical 行。仅组合 base 与 Web 时不包含 messenger 行，因此普通 `dsh web` 行为保持不变。

## Client 界面

Client 侧维护普通会话消息行所需的受限 receipt 状态；它不注册独立标题栏入口、抽屉、侧边聊天或 overlay。用户复制准确 Session ID，粘贴到普通聊天框，再让当前 Agent 发送或回复。一次被接受的 outgoing 投递会在来源侧追加 ignorable 会话行，目标 relay 则保持普通可见 user-message 行，因此两边会话都能看到交流，同时来源文本不会重复进入模型历史。通知仍然只限站内：没有原生 macOS 通知、替代会话行、独立消息档案或自动 Agent loop。

## 模型体验

### 五个跨会话工具

#### 模型看到的内容

启用时，native Function Calling（函数调用）公开 `send_message_to_session`、`send_message_to_session_and_wait`、`reply_to_session`、`wait_for_session_reply` 和 `stop_session_collaboration`；Code Mode 通过 `run_code` 背后的生成 `tools` SDK 公开相同五个调用。稳定 prompt 会为准确粘贴的 Session ID 选择直接发送，仅在用户要求时选择发送并等待，让接收 Agent 通过准确 delivery ID 回复或继续同一条链，并阻止确认消息或结束语形成自动循环。每条 relay 都是普通 user-role 消息，包含一个可信元数据块和一个单独且明确不可信的正文块。元数据标明来源 Session ID、delivery ID 和投递模式，但永远不会暴露由 Host 持有的 reply token。工具结果报告投递与匹配回复的身份、状态、请求的 wake 与稳定错误；目标空闲或无关 assistant 输出绝不会被误报为回复。

#### Token 影响

每个启用后的请求都会在 native 模式承担五项工具定义，或在 Code Mode 承担其生成 SDK 声明。已投递 relay 会把受限信封与正文追加到目标下一次领取的上下文；之后每次工具调用与结果都遵循普通会话保留策略。Client receipt 流只含元数据，不增加模型 token。

#### KV Cache 影响

只要插件与展示模式不变，五项定义与 SDK 声明就逐字节稳定，因此会保留相应工具前缀的缓存段。启用或停用插件会改变该段；已投递并领取的 relay 追加在会话尾部，而不会重写先前消息。

### Invariant ownership

不发布不变式伴生入口，因为 route/receipt/session 所有权由包测试覆盖。

## 已知限制与暂缓事项

- 通信仅限一个活动 profile，并且只接受普通会话；尚未实现跨 profile、跨设备、subagent、广播、群组或公共网络投递。
- 协同内容保留在来源和目标会话的普通历史中；不存在第二份消息档案或手动 relay 面板。
- 原生系统通知暂缓实现，因为它需要本可独立停用包边界之外的 Electron 权限与窗口生命周期所有权。
- 插件提供显式且有界的对等通信，而不是新的调度器：任意一个已有普通 Agent 都能发起、回复或停止一条协作链；回复链有上限，停止后只有用户指示的全新消息才能建立新链。它不会创建新会话、subagent、转发规则、后台循环或自主双 Agent 对话。
