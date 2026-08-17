# 跨会话 Agent 通信插件设计

[English](2026-08-17-cross-session-agent-messaging-plugin-design.md) | 中文

**日期：** 2026-08-17

**状态：** 待实现

**目标：** DeepSeek Harness Web Profile 独立 Host 与 Client 插件；本轮只交付 Intel macOS Desktop

## 目标

用户复制普通会话的 Session ID 后，可以在当前会话里直接要求 Agent 向目标会话发送信息、唤醒目标继续工作、回复原会话，或有界等待某次投递的回复。交互语义对齐 Codex 的跨任务通信，不建立传统聊天收件箱，也不自动让两个 Agent 无限对聊。

插件通过 npm 包的 `dsh.bundle.patch` 加入 Web Profile，注入 Harness 已有的 `apiProxy`、`typert`、`agents`、`tools`、`workspaceRegistry` 和 `webServer` 服务。它不修改 Harness 核心、Electron preload、模型提供方、会话格式或 Desktop 随机端口启动方式。

## 包与兼容责任

- 包声明并锁定经过验证的 Harness peer 范围，从当前 Desktop 基线 `0.1.0-rc.5` 开始；源码相似不能代替针对其他版本的加载测试。
- 安装预检检查所需服务形态、工具名可用性、路由可用性和只有一个活动副本。临时 staged profile 必须能够干净启动和卸载，随后才可在用户 profile 中启用该包。
- 不兼容的模块、peer 范围、服务、路由或工具冲突在产生任何 receipt 或会话写入前拒绝启用。诊断标明插件与 Harness 版本以及失败能力，但不暴露凭据或会话正文。

## 工具接口与精确语义

为避免与 Harness 现有子 Agent 工具名称冲突，插件注册四个全局工具：`send_message_to_session`、`followup_session`、`reply_to_session` 和 `wait_for_session_reply`。调用方 Session ID 从当前工具执行上下文推导，模型不能通过参数伪造发送者。

`send_message_to_session(target_session_id, message)` 生成带唯一 Message ID 的普通用户消息，并调用目标 Agent 的 `inject(message)`。目标正在运行时会在最近的后续 step 边界领取消息而不另开 turn；消息可能错过 pre-step 已经领取批次的模型请求，但仍可供下一个 step 边界领取。目标空闲或冷恢复时消息持久排队但不唤醒，直到用户、跟进或其他合法 wake 启动 Agent。返回值只说明“已持久投递”，不能宣称目标已阅读或已回复。

`followup_session(target_session_id, message)` 使用同样的安全信封并调用目标 Agent 的 `followup(message)`。目标空闲时同步进入 running 并保留一个 driver；目标正在运行时消息排入下一轮，不并发创建 driver。driver 可能继续排空已有 backlog，因此该工具保证没有并行 driver，而不是总共恰好一个 turn。即时返回只区分拒绝、已入队和已请求 wake，不能把入队当成完成；后续运行失败、取消和终止作为非回复状态写入 receipt。

`reply_to_session(delivery_id, message, wake)` 只能使用目标会话实际收到且仍有效的 delivery receipt，发送方从 receipt 绑定的源会话推导。默认 `wake=false`，回复持久投递但不暗中启动源会话；调用方明确要求 `wake=true` 时才使用 follow-up 语义唤醒源会话。receipt 不匹配、已过期、已消费或来源不符时拒绝，且不改变任何会话。

`wait_for_session_reply(delivery_id, timeout_ms)` 只等待下一条通过 receipt 绑定的显式 `reply_to_session` 结果。目标 turn 的 assistant 输出没有 per-input 因果键，因此绝不算作隐式回复；目标失败、取消或终止只能作为独立的非回复状态返回。`timeout_ms` 默认为 30,000，接受 1,000 到 55,000；工具定义具有 60,000 毫秒执行预算，并转发工具执行的 abort signal。它不能使用只表示“整个 Agent 暂时空闲”的 `agent.whenIdle()`。等待超时不会唤醒目标，也不会取消目标正在执行的工作。

## 会话解析与投递信封

目标会话使用 Harness 的品牌化 Session ID 校验，并通过 ApiProxy 已配置的 Typert `agent` lookup 解析。该路径复用 live Agent、去重并发冷恢复，并恢复目标会话原有的 preset 与 model；插件不得直接调用 `ctx.agents.resume()` 绕过这些规则。

插件只允许当前 profile 内的普通会话。格式错误、缺失、已删除、已归档、子 Agent 所有、当前会话自身或无法安全恢复的目标都在创建消息前拒绝；拒绝后目标日志、inbox、运行状态和 receipt 存储保持零变化。插件在 lookup 前检查一次归档集合，并在入队前立即再次检查，既避免恢复已知的归档目标，也缩小跨服务竞态；若其他参与方在入队已接受后归档或删除会话，插件不回滚这次投递。解析 cold no-wake 目标仍会发布其内存 Agent，以便寻址持久 inbox，但不会启动模型 driver。普通 fork 会话只要仍是可用的普通会话即可作为目标。

投递内容使用 Harness 的 `createUserMessage`，source 为 `{ kind: 'plugin', plugin: 'dsh-session-messenger', form: 'relay' }`。模型可见文本包含清楚但不可伪装成权限的来源 Session ID、delivery ID、投递模式和用户消息；结构化 receipt 单独持久化，原始文本不能覆盖发送者、目标、Message ID、reply token、hop 或过期时间。

每个 receipt 至少记录源 Session ID、目标 Session ID、投递 UserMessage ID、模式、状态、创建与过期时间、reply token 和 hop。receipt 尚未解决时还会保留受限的 relay 信封，以便进程在持久化 `prepared` 后、入队前崩溃时重建完全相同的消息；完成后的压缩会移除正文。存储位于当前 profile 的插件专属数据区，并遵循 write-ahead 顺序：原子持久化 `prepared`、用预先创建的 Message ID 入队，再原子标记 `delivered`。已经处理的入队拒绝会在工具返回 rejection 前原子标记为 terminal `failed` 或 `aborted`，并且绝不重试。只有进程死亡或入队后状态写入不确定而留下的 `prepared` 或 `delivery-recovery-pending` receipt 才进入恢复：恢复时先在目标 inbox 与日志中查找该 Message ID，找到后标记 delivered，只对消息缺失的 `prepared` receipt 使用原 Message ID 和信封重建后重试入队。插件不复制完整会话历史，也不把内容发送到本机以外。

Host companion 在 `/plugins/dsh-session-messenger/` 下拥有精确的同源快照、确认与 SSE 通知路由。注入同源 index 的 per-generation capability 用于验证 Client；每条路由检查当前精确 loopback origin，不启用 CORS，校验输入大小，限制每个 SSE 连接，并随插件撤销连接和路由。SSE 事件携带 receipt 元数据与状态，但不携带消息正文；重连使用 event id 与 Client 去重，快照路由恢复遗漏的未读状态。

消息正文限制为 16 KiB UTF-8 字节。每个源会话每分钟最多创建 30 次投递，每个 profile 最多保留 256 个未解决 receipt。已完成 receipt 的元数据在 7 天后压缩，已过期 receipt 在启动时和有界定时任务中清理，已经写入会话日志的消息继续遵守普通会话保留规则。

## 回复、通知与防回环

每次 delivery 的 reply token 只允许消费一次。一次有效回复会完成当前 receipt，同时创建方向相反、hop 加一的新 delivery 和 reply token；两边可以用新 delivery ID 继续有限轮次的对话，但不能重复消费旧 token。目标 Agent 的回复工具返回新 delivery ID、投递状态和可供其说明失败的稳定错误码，不暴露其他会话列表或 receipt。

源会话正在执行 `wait_for_session_reply` 时，有效回复立即解析该等待；源会话没有等待时，回复以不唤醒消息持久排队，并由 Client 插件显示 Harness 风格的站内提示和未读状态。跟进任务完成继续使用 Harness 已有的后台完成圆点；本设计不覆盖完整会话行，也不依赖不稳定的 DOM 或 CSS Modules 哈希。

Client 插件只在稳定的 `sidebar.footer.action` 列表槽位提供一个紧凑通信状态入口，展示待处理、未读和最近错误，并提供复制当前 Session ID 的捷径。它不实现独立收件箱、不显示其他会话正文、不注册与现有会话行冲突的替代 renderer；关闭提示不会删除消息。

receipt 默认 24 小时过期，最大 relay hop 为 8。插件拒绝 self-send、重复消费、过期 token 和超过 hop 的 A↔B 循环；它不会根据收到的普通文本自动回复或自动转发。内容进入目标模型上下文后可能触发目标已有工具权限，因此只有 `followup_session` 或显式 wake reply 才能启动新的 Agent 工作。

## 生命周期与失败

Host 插件加载时原子注册四个工具及 receipt 协调器，热重载不得重复注册。停用或卸载时撤销工具、事件监听器、活动等待和 Client 槽位，保留已经进入会话日志的消息；未完成等待以稳定的 disposed 结果结束，不伪造回复。

工具执行上下文缺少调用方 Agent，或者目标解析或初始持久化失败时，返回阶段化错误并保证尚未提交的后续状态不发生。已经处理的入队拒绝会在返回 rejection 前转为 terminal；若入队已经提交，但 delivered 状态写入结果不确定，工具返回 `delivery-recovery-pending`，而不是虚假的零副作用拒绝。目标在已接受投递后被归档或删除时，已经写入的消息保持不变，后续 follow-up、reply 或 wait 操作返回稳定的 target-unavailable 状态，不修改其他会话。write-ahead 恢复流程幂等解决不确定 receipt，绝不重复投递同一个 Message ID。

插件只提供站内通知。原生 macOS 通知需要额外 Electron 权限与窗口生命周期改动，不属于这次纯插件、可随时停用的范围。

## 验证与验收

- 真实 profile 加载覆盖 `dsh.bundle.patch`、四个工具在 native 与 code/SDK 模式可见、热重载不重复注册、停用后全部工具和槽位消失。
- no-wake 覆盖 live idle、live running 和 cold ordinary 会话：精确 Message ID 持久化、running 目标在后续 step 领取且不另开 turn、idle 目标零 wake 与零模型请求，以及重启后仍可取回。已经处理的入队拒绝在重启后保持 terminal，入队前崩溃会恢复缺失的 prepared 消息，入队后且状态写入前崩溃会找到现有 Message ID 而不重复投递；缺少调用方 Agent 以及缺失、子 Agent、归档和 self-send 目标全部稳定拒绝且零副作用。
- follow-up 覆盖 idle 目标保留一个 driver、running 目标 FIFO 且无并行 driver、已有 backlog 排空，以及模型路由失败、异常、取消和终止的准确非回复状态。
- reply 覆盖 A 到 B 的来源信封、B 到 A 的绑定验证、伪造 token、过期 token、跨 receipt token、重复回复和 hop 上限。
- wait 只覆盖通过 receipt 绑定的显式回复、与 assistant 输出及无关 turn 隔离、参数和工具 timeout 边界、转发 abort、discard、dispose、进程重启和回复到达竞态；quiet idle 始终只能 pending 或 timeout，绝不暗中 wake。
- Client 验收覆盖复制 Session ID、回复站内提示、未读、重连快照恢复且不重复提示、清除提示但不删消息、深浅主题、键盘、屏幕阅读器、200% 缩放和减少动画。
- Mac Desktop 使用临时 `DSH_HOME` 完成两条普通会话的真实 Agent 对聊、归档与子 Agent 拒绝、应用重启恢复、卸载和完整进程清理；本轮不修改或发布 Windows 成品。

## 交付阶段

基础阶段先交付可靠的 `send_message_to_session`、`followup_session`、`reply_to_session`、write-ahead receipt 持久化和站内通知。可靠性阶段再开放 `wait_for_session_reply`，只有完成显式回复关联、超时、取消与重启测试后才进入默认工具目录；不得用 `whenIdle()` 或 assistant 输出推断包装成伪等待提前发布。

## 范围外

跨设备或跨 profile 通信、公共网络服务、传统收件箱、会话正文聚合、自动无限对聊、批量广播、修改归档状态、操作子 Agent、原生系统通知、Harness 核心会话行扩展、Windows 打包和自动更新不在本设计范围内。
