# `dsh-lark` 飞书远程 Session 插件设计

[English](2026-08-25-dsh-lark-remote-session-plugin-design.md) | 中文

**日期：** 2026-08-25

**状态：** 已获产品方向批准，等待书面规格审核

**实现基线：** `origin/main` 的 Desktop 0.4.0（`e171dd2d45`），Harness 包版本 `0.1.1-rc.2`

## 目标

交付独立可安装、可停用和可移除的 `@deepseek-ai/dsh-lark` Bundle。指定飞书用户可以在机器人私聊中选择当前 Harness Profile 的项目和普通 Session，继续向该 Session 下达开发指令，并接收与 OpenClaw-Lark 风格一致的流式卡片、工具状态、耗时、Token、附件和一次性审批交互。项目、Session、Agent、权限、审批、Sandbox 和用量始终由 Harness 持有；插件不安装或启动 OpenClaw，也不创建第二套 Agent Runtime。

插件关闭时必须立即断开飞书连接、停止入站消费、撤销事件订阅并结束未完成卡片更新。关闭或卸载不得归档、删除、重置或改写已有 Harness Session；已经进入 Session 日志的用户消息继续属于该 Session。

## 交付形态

代码位于 `packages/extensions/lark/`，npm 包名为 `@deepseek-ai/dsh-lark`，公开导出 Host 插件、Client 设置插件、`cordis.patch.yml` 和运行时 invariant。包 manifest 声明 `dsh.bundle.patch`，因此通过 `dsh plugin --profile web add <package-spec>` 安装后进入 Profile 的 `dsh.profile.bundles`。第一版不加入 Desktop 默认 patch，不把它变成无法单独移除的内置功能。

Bundle 只依赖 Harness 的公开包接口和飞书官方 Node SDK。可以参考或移植 `@larksuite/openclaw-lark` 中与宿主无关且许可证允许复用的飞书传输、卡片和媒体处理逻辑；任何移植代码保留必要归属和第三方声明。包内不得出现 `openclaw/plugin-sdk` 导入、`~/.openclaw` 状态、Gateway 管理或 OpenClaw Session 路由。

## 组件

### 飞书传输与身份

`LarkTransport` 持有 WebSocket、断线重连、消息发送、卡片更新、媒体下载和回调应答。它按 `app_id`、凭据引用、飞书或 Lark 域名、流式刷新间隔、媒体上限和重试策略解析配置；部署可调值必须进入 Schemastery Config，不以散落常量代替配置。

`OwnerGate` 只接受一个已配对 `open_id` 的私聊事件。群聊、其他用户、转发卡片回调、身份不匹配的附件和命令在读取项目或 Session 数据前拒绝。所有按钮回调重新校验 `open_id`、`chat_id`、卡片 generation、一次性 nonce 和有效期；飞书侧已经显示的文本无法阻止本人截图、通知或历史留存，因此完整路径只出现在已授权私聊。

首次配置在 Harness 设置页保存飞书应用凭据引用并启动一次性配对。机器人只返回无项目数据的短配对码，用户须在本机 Harness 设置页确认该码，随后插件固定唯一 owner。重新配对必须在本机设置页撤销原 owner 后进行，不能通过飞书命令直接更换控制者。凭据内容由 Harness Credentials 服务持有，日志、诊断、卡片和持久化队列不得记录 App Secret。

### 项目、Session 与绑定

`BindingController` 从 `ctx.workspaceRegistry.list()` 读取有序项目，从每个 Workspace 的 `sessionIds` 和 Host Session 摘要读取普通 Session。项目卡显示标题和完整绝对路径；Session 卡显示标题、Session ID 和 `运行中`、`空闲`、`等待审批` 或 `已停止` 状态，运行中优先。已归档、`origin: subagent`、已删除、工作目录缺失或无法通过 Host Typert lookup 安全恢复的 Session 不可绑定。实现复用 `@deepseek-ai/dsh-session-messenger` 已有普通 Session 解析规则，必要时把该解析器提升为公开的 Host API；不得复制出第二套冷恢复、归档或子 Agent 判定逻辑。

飞书不提供文本框内的原生 slash 候选菜单；OpenClaw 的飞书文档同样要求把 slash 命令作为普通文本发送。因此插件无法在用户尚未发送键盘输入时收到 `/`。精确消息 `/`、`/进入` 和机器人底部菜单 `进入项目` 走不调用模型的命令快路径：收到后立即返回项目选择卡片，选择项目后更新为 Session 卡，选择 Session 后把当前 `owner open_id + chat_id` 绑定到该 Session。`/切换` 重新进入选择流程，`/解绑` 删除绑定，`/状态` 展示连接和当前绑定，`/帮助` 展示命令。

绑定记录至少包含 schema 版本、owner、chat、Workspace ID、规范化项目路径、Session ID、绑定时间和 generation，并原子写入 Profile 的插件专属状态。Harness 重启后先验证 owner、Workspace、项目目录、归档集合和 Session 来源，再恢复绑定；任何验证失败都自动解绑并要求重新选择。插件完全离线期间不接收消息，不增加常驻后台服务，也不远程启动 Harness。

### 持久消息队列

`DurableInbox` 以飞书消息 ID 去重，并为每个已授权私聊按接收顺序分配单调序号。普通文本和附件在向飞书确认“已入队”前以 write-ahead 顺序原子持久化；队列记录至少包含事件 ID、序号、绑定 generation、目标 Session ID、规范化内容、附件引用、状态、尝试次数和时间戳。重启只恢复仍指向同一有效绑定 generation 的 `prepared` 或 `queued` 记录，已投递 ID 不重复进入 Harness。

普通消息使用 Harness `createUserMessage` 和 `Agent.followup()`，每条消息成为自己的后续 turn；目标正在运行时只排入下一 turn，空闲或冷 Session 通过 Host Typert lookup 恢复后唤醒，插件不得直接调用 `ctx.agents.resume()`。同一绑定同时只允许一个队列消费者：消费者用预生成 Message ID 关联 `agent/inbox/claimed`、`user/message` 和对应 `turn/end`，前一条到达终止状态后才投递后一条，不能把整批飞书消息提前塞入 Harness inbox，也不能创建并行 driver。飞书响应中的“已入队”不表示模型已阅读或任务已完成。

`/插话 <内容>` 使用 `Agent.steer()`，在最近的安全 step 交付；没有内容时返回用法提示。`/停止` 走命令快路径，把尚未投递的远程队列记录标记为 cancelled，按预生成 Message ID 从 Harness inbox 移除仍未领取的远程消息，并调用 `Agent.cancel(..., { keepInbox: true })` 停止活动 turn；其他来源已经排队的 Harness 消息必须保留。普通消息永不隐式 steer 或 interrupt。

### Session 事件与流式卡片

`SessionProjection` 复用 Harness ApiProxy mux 和 Host 计算的工具展示数据，不建立第二份运行状态。绑定后只订阅目标 Session 的新事件和当前未完成 turn，不回放完整历史；无论该 turn 从飞书还是 Harness 桌面发起，owner 都能看到绑定后发生的流式进度。

每个活动 turn 对应一张持续更新的飞书卡片。卡片按 OpenClaw-Lark 的表现保留打字机效果、文本流、当前阶段、精简工具时间线、等待审批、错误、停止、完成、已耗时间和 Token 区域。刷新经过可配置节流和单调 revision，旧更新不能覆盖新状态；卡片更新失败时降级为有界文本消息，不能重复发送最终答案。

文本来自 `assistant/chunk` 与最终 `assistant/message`，工具状态来自 `tool/call`、`tool/result` 和 Host 的安全展示数据，耗时来自 Harness 事件时间，Token 只采用 Harness `TokenUsage` 的真实字段。缺失的用量显示 `暂不可用`，不估算或复制 OpenClaw 的统计。插件遵守 Harness 当前可见性规则，不把系统提示、隐藏推理、凭据、原始环境变量或可能含秘密的完整工具参数发送到飞书。

### 附件

图片下载后先校验 owner、飞书媒体类型和大小，再通过 `ctx.attachments.saveImages()` 进入 Harness 的持久图片存储，生成普通 `image` block。PNG、JPEG、WebP 和 GIF 的数量、像素及字节限制服从已挂载 AttachmentStore，插件不能放宽该策略。

其他文件下载到 `$DSH_HOME` 下插件专属的随机目录，采用安全文件名、原子写入、内容哈希和仅当前用户可读的权限；消息只携带文件名、大小、哈希和绝对暂存路径，不直接写入或覆盖项目。Harness 的读取工具可以按用户消息中的路径查看文件，是否解析 PDF、压缩包或专有格式取决于当前 Session 已有工具。媒体上限默认对齐 OpenClaw-Lark 的 30 MiB，但可在插件配置中收紧；暂存文件默认保留七天并由有界清理任务删除。

### 审批

插件不注册第二个 `approval/request` terminal answerer。它复用 ApiProxy 已有的 `approval/requested`、`approval/resolved` 和响应路径，因此桌面与飞书看到的是同一笔 Harness 审批，先被有效回答的一方获胜，晚到点击得到已处理或已过期提示。

飞书审批卡只提供 `允许一次` 和 `拒绝`。回调绑定 owner、chat、Session ID、Approval ID、可选 Call ID、工具名、卡片 generation、一次性 nonce 和短有效期；校验成功后只提交 `allowed-once` 或 `rejected`。插件不提供永久允许、审批策略修改、Sandbox 关闭或权限预设切换；这些操作继续由 Harness 桌面拥有。

### 设置、诊断与生命周期

Client 插件在 Harness 设置中提供 `dsh-lark` 页面，包含总开关、应用凭据状态、域名、owner 配对状态、连接状态、当前绑定、队列深度、最近一次脱敏错误、测试连接、重新配对和清理暂存附件。页面不显示 App Secret 原文，不从浏览器获得文件系统或 shell 权限。

总开关关闭时，Host 插件按顺序停止接收、拒绝新回调、取消重连和定时器、结束未完成卡片刷新、撤销 mux 与 Agent 监听并关闭 WebSocket。已持久化但未交付的飞书指令保留为 paused；再次启用后仍保持 paused，只有本机设置页明确选择“恢复队列”才按原序继续，选择“清空队列”则把它们标记为 cancelled。卸载包不删除 Harness Session，也不自动删除凭据；设置页提供独立的“清除飞书插件数据”显式操作。

连接诊断只报告插件版本、Harness 版本、域名、WebSocket 阶段、owner 是否已配对、绑定是否有效、队列计数和稳定错误码。任何 open_id、chat_id、Session 正文、附件正文、App ID 和 App Secret 均需省略、截断或哈希，诊断不得触发模型、审批或项目写入。

## 错误处理

启动配置缺失或凭据不可用时插件保持 disabled-error 状态并在 Harness 设置页说明，不启动半配置 WebSocket。网络断开按有界退避重连；Harness 仍在线但飞书不可达时，已经持久化的入站记录不丢失，出站卡片进入可恢复失败状态。完全退出 Harness 后不存在接收器，飞书侧离线期间的消息不作可靠收件承诺。

项目或 Session 在选择卡片展示后失效时，按钮回调重新校验并拒绝绑定。已绑定 Session 后续被归档、删除或变为子 Agent 时，队列停止消费、绑定失效且 owner 收到重新选择提示。附件校验失败、超限、写入失败或路径不可读时只拒绝该条附件消息，不把部分附件或空指令投递给 Agent。

重启恢复必须处理写入前崩溃、写入后未确认、Harness inbox 已接受但插件状态未更新和卡片更新中断。恢复先以飞书事件 ID 和预生成 Harness Message ID 查询现有记录，再决定标记完成或用相同 ID 重试；不得因为不确定状态生成第二条模型指令。

## 数据边界

插件持久化仅包含配置引用、owner 配对、一个私聊绑定、消息去重与 FIFO 元数据、尚未投递的规范化消息、卡片 revision、审批回调 nonce 和暂存附件元数据。它不复制完整 Session 历史、不建立跨设备服务、不上传项目索引，也不把任何数据写进 `~/.openclaw` 或其他 Agent Runtime 的目录。

## 验证与验收

- 安装与停用：打包 tarball，通过真实 `web` Profile 安装后 manifest 的 dependency 与 `dsh.profile.bundles` 同时出现；重启 Profile 后设置页和 Host 生效；关闭后无 WebSocket、监听器、定时器或新投递；移除 Bundle 后 Profile 可正常启动。
- 身份：只有配对 owner 的私聊能够获取项目、完整路径和 Session；群聊、其他用户、转发或重放回调均不能读取或操作 Harness；重新配对只能从本机设置页开始。
- `/` 入口：发送精确 `/` 不调用模型并立即返回项目卡，随后可选择项目、普通 Session 并绑定；项目显示完整绝对路径；失效、归档和子 Agent 目标稳定拒绝。
- 顺序与恢复：连续发送多条消息时，Harness 以接收序号逐条获得独立 follow-up turn；运行中的目标没有并行 driver；重复飞书事件不重复投递；插件和 Harness 重启后保留绑定与未完成队列顺序。
- 控制：普通消息只 follow-up，`/插话` 只 steer，`/停止` 停止当前 turn、移除未领取的远程消息并取消尚未投递的远程队列，同时保留其他来源的 Harness inbox；每个命令都校验 owner 和当前 binding generation。
- 卡片：文本以打字机方式流式更新，工具时间线、状态、耗时和 Harness 真实 Token 单调前进；断网重连、卡片 revision 乱序、更新失败降级和最终答案去重均有覆盖。
- 附件：图片经过 Harness AttachmentStore；其他文件进入私有暂存区且不触碰项目；类型、大小、哈希、权限、原子写入、过期清理和部分失败均有测试。
- 审批：同一 Harness Approval ID 在桌面和飞书只允许一次有效决定；飞书仅能允许一次或拒绝；过期、重复、跨用户、跨 Session 和已解析点击全部失败关闭。
- 证据层：包级单元测试覆盖解析、认证、队列、卡片、附件和回调；Host 集成测试使用假飞书传输验证真实 Workspace、Typert、Agent、ApiProxy 和持久化组合；产品可见行为增加无密钥 runnable snapshot；构建、类型检查、lint、文档门禁和 `git diff --check` 通过。
- 真实运行：没有用户提供的飞书应用凭据时只完成离线和真实 Harness 安装预检，不读取或复制其他 Runtime 的现有秘密。用户在 Harness 设置页录入凭据后，再执行真实私聊配对、`/` 选项目、Session follow-up、流式卡片、附件、审批、重启恢复和关闭插件验收。

## 分阶段实现

基础阶段交付可安装 Bundle、设置与配对、WebSocket、精确 `/` 项目/Session 绑定、文本 FIFO follow-up、状态卡片和完整生命周期。该阶段先证明关闭插件零运行影响、非法身份零项目数据和重复事件零重复投递。

完善阶段加入打字机流式卡片、工具时间线、真实 Token、`/插话`、`/停止`、图片与普通文件、一次性审批和重启恢复。每项能力接入 Harness 现有事件或服务，不新增平行 Runtime。

验证阶段完成无密钥自动化、真实 Profile 打包安装、停用与卸载、故障恢复和可用凭据条件下的飞书实测。发布物必须保留第三方声明，并记录未执行真实飞书操作时的证据边界。

## 范围外

飞书群聊、多 owner、多 Harness 设备、Harness 完全退出期间的后台收件、远程启动 Harness、跨 Profile Session、子 Agent 控制、归档恢复、永久审批、远程修改 Sandbox 或权限预设、复制完整会话历史、自动提交或发布项目、原生文本框 slash 自动补全均不在第一版范围内。
