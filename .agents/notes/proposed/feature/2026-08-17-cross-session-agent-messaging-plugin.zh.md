# Agent Note: 跨会话 Agent 通信插件

状态：proposed

[English](2026-08-17-cross-session-agent-messaging-plugin.md) | 中文

## 问题

普通 Harness 会话具有稳定且可复制的 ID，但一个 Agent 无法通过有界、与 receipt 关联的方式向另一个普通会话注入上下文、请求一次跟进 turn、回复确切来源，或等待该次确切回复。复用 subagent 工具会跨越所有权边界；从 assistant 输出或空闲状态推断回复会伪造因果关系；把该功能加入普通 Web bundle 则会改变无关产品界面。

## 方案

把 `@deepseek-ai/dsh-session-messenger` 作为一个可独立移除的 Host／Client 包交付，并且只在不可变 Desktop overlay 中挂载恰好一条 canonical 行。普通 base 加 Web 组合继续不含 messenger。现有 reasoning-effort 与 plugin-market 行作为独立相邻项保留，不嵌套也不替换它们。

注册四个全局工具。`send_message_to_session` 注入但不唤醒；`followup_session` 请求唤醒但绝不创建并行 driver；`reply_to_session` 从与接收会话绑定的单次私有 token 推导目的地；`wait_for_session_reply` 只接受与某个 receipt 关联的显式反向投递。四者都不允许调用方提供发送者身份，收到的普通文本也绝不会触发自动回复或 Agent loop。

只通过 Host Typert `agent` lookup 解析目标。这样，live 复用与 cold-resume 去重仍由 Host 策略负责，同时 cold no-wake 目标可以在不发起模型请求的情况下变为可寻址状态。在 lookup 前检查 ordinary／unarchived 策略，并在同步 inbox 入队前立即再次检查；绝不直接调用 `agents.resume()`。

入队前持久化 write-ahead receipt，恢复期间复用同一个 Message ID，并且只在投递未解决时保留受限正文。未解决 receipt 具有精确的 24 小时 TTL；已结算元数据保留七天。回复权限仅可使用一次，并受 hop 上限约束。已提交会话消息仍是普通会话事件，并在包停用后保留。

Host 恰好拥有三条由同源 capability 验证的路由和一个 index bootstrap。Client 只拥有一个 `sidebar.footer.action` 贡献，显示元数据状态、未读回复、最近错误，并复制当前会话的精确 Session ID。通知路由不发送消息正文，也不请求原生系统通知权限。

停用会移除四个工具、路由、index tap、等待、监听器、定时器、footer 贡献和 Client graph 行，同时保留持久 receipt 存储与已提交会话消息。待处理等待以 `disposed` 结算；绝不伪造回复。

## 模型体验

### 工具与 relay 上下文

#### 模型看到的内容

native 展示公开四项工具定义；Code Mode 公开 `run_code`，并在其生成 SDK 中公开这四项调用。收到的 relay 是一条 user-role 消息，其中带有可信的来源 Session ID、delivery ID、私有 reply token、投递模式，以及明确不可信的正文边界。结果区分已接受投递、请求的 wake、回复结算与稳定错误，但不宣称目标已理解消息。

#### Token 影响

启用后的请求携带四项 native 定义或生成 SDK 声明。每条被领取的 relay 都会追加其受限信封与正文；工具调用与结果按普通方式追加。浏览器通知元数据不增加模型 token。

#### KV Cache 影响

只要在同一展示模式下保持启用，定义就逐字节稳定。启用或停用会改变工具前缀段；relay 投递追加在会话尾部，不重写先前历史。

## 已知限制与暂缓事项

- 范围仅限一个活动 profile 与普通会话；跨设备、跨 profile、subagent、广播、群组和公共网络通信继续暂缓。
- footer 是紧凑状态界面，不是对话浏览器或第二个 inbox。
- 原生 macOS 与 Windows 通知继续暂缓，因为其权限与生命周期所有权属于这个可移除包之外。
- 不交付自主对话策略：模型必须调用显式工具，回复受 capability 绑定，收到的文本不会启动循环。

## 考虑过的替代方案

- 把包放入 Web bundle——不予采纳，因为普通 Web 用户没有选择启用 Desktop 跨会话通信，且停用不再局限于当前界面。
- 复用 subagent 通信——不予采纳，因为 subagent 的所有权、寻址、生命周期与父子权限无法描述两个普通会话。
- 把目标空闲或后续 assistant 输出视为回复——不予采纳，因为两者都不携带投递因果关系。
- 添加 Electron 原生通知或传统 inbox——暂缓，因为两者都会把权限、持久化与 UI 所有权扩展到包边界之外。

## 验收标准

- base 加 Web 组合出零条 messenger 行；Desktop 组合出恰好一条 canonical 行，同时保留 reasoning-effort 与 plugin-market 集成。
- 真实 Host Loader 以 native 方式和 Code Mode SDK 方式公开全部四个工具，提供恰好三条 messenger 路由加一个 index tap，并生成一条 Client graph 行。
- 真实 Client Loader 只贡献一个 `sidebar.footer.action` 项；停用 Host／Client 行会移除工具、路由、等待、footer 与 graph 状态。
- 停用会保留已经提交的 inbox 事件，并把尚未完成的回复等待结算为 `disposed`。
- 包 tarball 包含其 patch、Host bundle、Client bundle、声明与 package 元数据；Desktop staging 会在打包前验证这些文件。
- 自动化源码验收在任何原生操作前通过。真实双会话 macOS Desktop 交换仍是独立的显式验收步骤。

## 风险

- relay 会进入目标模型上下文，并可能使用目标现有权限；只有显式 follow-up 或 waking reply 语义可以启动工作。
- 跨服务归档与删除竞态无法做到原子化，因此策略会在入队前立即复查，并且已经接受的提交绝不会被虚假回滚。
- receipt 持久化可能在 inbox 提交后失败；recovery-pending 状态与精确 Message ID 可以避免虚假的零副作用结果和重复投递。
- 启用时，新增全局工具集会改变请求 schema 与缓存前缀；仅限 Desktop 的组合与完整卸载会限制该影响。
