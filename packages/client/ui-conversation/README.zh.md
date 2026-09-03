--- description: "Target-neutral 对话装配与浏览器 shell：事件和视图注册表、逐会话 binding、输入状态、slot 与临时 composer takeover。" kind: "package-reference" ---

# @deepseek-ai/dsh-client-ui-conversation

[English](README.md) | 中文

## 概述

`ui-conversation` 拥有与 target 无关的 Conversation 组装和共享浏览器 shell。它消费 Session Controller 的 `SessionEventLikeEntry` feed，通过 `ctx.uiConversation` 暴露不依赖 React 的 registry 与逐 Session binding，并通过 `ctx.uiSession` 提供 `useConversation`、`useInput` 和 `inputActions` 标准 props。它还拥有按会话的持久化图片 URL 缓存：`ctx.uiConversation.imageUrl(sessionId, attachment)` 为每个附件解析一个经会话授权的浏览器 URL，并随 Session binding 释放而撤销，因此所有 Conversation target 共享一次 `session.attachment` 读取。Chat 等具体 target 位于独立 package，由各自 package 注册 Definition、snapshot builder、View 和 renderer。

## 目录

- [Conversation 组装](#conversation-assembly)
- [Shell 与标准 props](#shell-and-standard-props)
- [临时 composer entry](#temporary-composer-entries)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="conversation-assembly"></a>
## Conversation 组装

`UiConversation.events` 是 event Definition 的唯一 registry，`UiConversation.views` 是 target snapshot builder 的唯一 registry。两者都拒绝重复 key、保持注册顺序、返回幂等 disposer，并在 contribution roster 变化时重建现有 binding。`UiConversation.binding(bindingOrSessionId)` 为当前 Session Controller binding 返回 identity 稳定的 Conversation binding，不会另开 event source。

adapter 把每个 `SessionEventLikeEntry` 直接交给 assembler。外层 `type` 区分 scalar 与 packed record，内部 `event` 则统一公开 `type`、`seq`、`time` 与 `data`；Definition 接收这个内部 `SessionEventLike`。历史 replace 与 prepend 接受两种 entry，实时 append 只接受 `SessionLiveEventEntry`。两种 event 都使用 Definition 的同一组 `match` 与 `update` 方法，`start` 则只接收标准 event，assembler 会拒绝 packed start。不消费 Assistant delta 的 Definition 对 packed tag 返回 `null`。replace window 或 revision 断档从完整已加载窗口重建；连续 revision 的 append 和 prepend 使用增量组装，并且不展开 packed member。assembler 拥有 Context 匹配、Turn/Step location、target node 物化、target activity 和稳定 target source。`ConversationSnapshot` 只包含与 target 无关的 View 与 active-target 事实；Session lifecycle 状态仍属于 `SessionSnapshot`。

shell 选择解析出 target 或 target source 收到首个 subscriber 时，该 target 进入 active 状态。assembler 从当前 Context 对它执行一次 replace，并使它参与后续增量 flush；创建 source 不会激活 target，取消订阅也不会停用 target。 唯一的严格例外是可移除 session-messenger 的 relay 形态。只有 user-role 节点的持久 source 同时声明 `kind: plugin`、`plugin: dsh-session-messenger`、`form: relay`、有效来源 Session ID 与 delivery ID、`bodyBlockIndex: 1`，并且内容恰好为两个 text block 时，才渲染为可见 relay 卡片。卡片把可信的来源／投递元数据与不可信正文分开，在 transcript 中持续显示两者，并提供复制与基于 receipt 的回复事件；它既不读取也不保存回复权限，该能力由 Host 持有。任何旧格式、畸形、部分加载或外部记录都会封闭式回退到普通 context renderer，不会被误判或隐藏。

Think 行默认保持折叠，并在不展开思维链的情况下暴露实时推理（reasoning）吞吐：当推理块是流式输出尾部时，摘要从结算后的首行切换到最新的非空行，其单行滚动区会随每个 delta 追到行内末端。展开该行会移除移动摘要，让完整推理进入普通页面流，因此页面阅读不会与内部跟随器争夺滚动；结算后恢复左对齐的稳定首行摘要（[决策](../../../.agents/notes/implemented/feature/2026-08-02-web-thinking-tail-scroll.zh.md)）。

target package 通过 declaration merge 扩展 snapshot 与 Location data map，再调用 `ctx.uiConversation.events.register(...)` 和 `ctx.uiConversation.views.register(...)`。target 通过 `ctx.uiConversation.binding(binding).target(targetId)` 读取其 Session-owned source。注册属于 Cordis effect，返回的 disposer 从同一个 registry 移除 contribution。

<a id="shell-and-standard-props"></a>
## Shell 与标准 props

本包注册 optional-Session `conversation` shell、strict Session header/body、View list、composer chain 与 bar、输入区域、Hero 区域、queue dock、草稿持久化和 phase 计算。`ctx.uiSession.provide()` 从同一个 Session binding 物化 Conversation 与 input source，并将 `inputActions` 作为稳定标准 prop 提供。 审批通过本包声明的链条接管编辑器：`ApprovalPanel` 注册为按选择器路由的 `'conversation.composer'` 配置项（ui-user-questions 模式），在审批等待未决期间取代 InputBar 占据编辑器（琥珀色条、理由标题、来自运行中调用参数的配对命令行，以及拒绝／允许一次／本会话不再询问三个动作）。`contract/slots.ts` 中的 `PendingApproval` 领域面在运行时 `PendingWait` 载体之上拥有 wire 编码——带审计关联的 `ApprovalResponsePayload` 值；广播的 `approval/resolved` 帧使等待落定并恢复编辑器。运行时 manager 会将所有审批或问题等待通过 `SessionSummary.pendingInteraction` 投影出来，未实例化的会话也不例外；`ui-workspace` 负责其侧边栏呈现。未决等待完全离开消息流：问题（ui-user-questions）与审批（ApprovalPanel）都经编辑器接管作答，不再保留只读占位卡。编辑器底行的 Access 席位挂载 `PermissionSelect`，由 host 计算的 `permissions` 投影经标准工具包 `useProjection` 供数（key 缺席即隐藏 chip）；chip 打开 Menu 原语下拉，其中 kebab-case 预设名渲染为 Title Case 标签。普通安全预设会立即经输入栏注入的命令面提交 `/permission <preset>`，而 `danger-full-access` 在界面中显示为 `Full access`，选择后先打开页面内的 Modal 风险确认。审批接管复用同一个当前 Session 命令面：“本会话不再询问”会打开相同的风险确认，执行 `/permission danger-full-access`，并且只有命令成功后才把当前等待回答为 `allowed-once`。权限真相仍在 Session 事件中，因此其他 Session 不受影响，切回 Workspace Write 后后续审批会恢复。命令或响应失败时卡片保持可重试且不泄露传输细节；Full access 已成功后的响应重试不会重复执行权限命令。这里没有新增 `ApprovalOutcome`、浏览器持久化、全局 grant 或跨 Session authority。用户勾选确认项前启用按钮始终不可用；取消、Escape、关闭按钮与点击遮罩都不会提交命令。

View 选择规则固定：有效且已注册的持久化选择优先，其次是已注册的 `chat`，否则不渲染 View；绝不选择第一个已注册 View。Shell phase 只组合 Session lifecycle 与 active-target set，不读取任何 target-specific snapshot。

Session 首次绑定或缓存的 Session 成为 current 时，shell 会在渲染前读取持久化 View 偏好，激活已注册的偏好 View 或 Chat fallback，并在后续 tab 或 focus 选择写入 store 前先激活对应 target。blank Session 仍不渲染 `conversation.view` slot；未选中的 target 不会激活。

常驻 composer 在无 Session 与有 Session 之间保持挂载。无 Session 时，同一个编辑器表面保持 inert，Workspace picker 连接 blank Session。该表面是 shell 所有的 Lexical 编辑器：引用 chip 是携带 owner 序列化身份的原子 decorator 节点（提交时经 owner codec 展开），已认领的 slash command 保持为带样式的行首文本，文件夹文本引用以图标前缀携带文件夹图形，草稿的剪贴板投影镜像到逐 Session Conversation store。Queue 操作通过 scoped `ctx.conversation` service 寻址准确的 queue occurrence；queue 预览经 `ui-primitives` 的共享行内引用投影渲染已发送文本（wire 会话形式折叠为其标签），并把本地图片预览或持久化图片部分显示为缩略图，编辑态则展示字面发送文本。持久化缩略图通过会话图片 URL 缓存解析。繁忙时 Enter 行为保存在 Host-backed `ui-conversation` settings namespace。

默认发送采用乐观提交：Enter 在同一事务里清空草稿、occurrence 表和撤销历史，composer 保持 `plain`，发送作为 detached attempt 运行，发送期间可以继续输入和提交。`sendSession` 在序列化之前用投递模式注册 Session 提交回显（`session.beginSubmission`）；Session 根据该模式与当前运行状态推导位置，因此空闲发送进入 transcript，繁忙时 Queue 进入 QueueDock，繁忙时 Steer 进入 pending-steering 区域。随后让出一帧，图片经浏览器原生 `FileReader` data-URL 路径编码。多个并发发送失败时，在用户编辑还原内容之前按提交顺序合并还原；命令提交保持冻结的 `submitting` 阶段。Detached attempt 持有图片 id，直到 admission 完成或 Session scope 销毁。回显以 observed 退休时，durable 图片缓存立即公开预览 URL，同时读取 admitted 附件，随后用规范化 URL 替换预览，并在两个 URL 各自停止使用后撤销。直接 subagent continuation 不创建本地回显，因为其 transport 不保留浏览器 request id。

普通 composer 运行时，如果草稿为空或输入不可用，主指针操作保持为 Stop。可提交的文字或附件会把同一位置切换为 Queue Send；清空或成功提交草稿后恢复 Stop。繁忙态 Enter 设置继续选择 Queue 或 Steer 键盘操作。可继续 subagent 保留独立的 Send 与 Stop 操作（[决策](../../../.agents/notes/implemented/bug-fix/2026-08-20-running-draft-primary-send.zh.md)）。

<a id="temporary-composer-entries"></a>
## 临时 composer entry

`conversation.composer` 是通用 chain，其完整 owner currency 为： 输入栏为 `'conversation.input.plan'`（位于本地 access 模式控件右侧）和 `'conversation.input.model'`（渲染在 pending 指示器与发送／停止控件之前）声明会话作用域的单实例 seat，并为 overlay、dock、left 和 right 输入扩展声明列表 slot。各功能包拥有相应控件及其状态；ui-conversation 提供放置位置、`locked` owner prop 和标准 slot share。前置加号按钮打开紧凑的 Codex 风格「添加」菜单，但仍复用 ui-input-trigger 的唯一 `MenuView` 与 pick 路径：`composer-add` source 提供文件／文件夹和图片，既有 command source 完整保留原命令并把 Goal／Plan 提升到添加分区，skill source 继续列出当前可调用插件。文件／文件夹沿用现有 `@` 引用流程，图片经隐藏 file input 进入既有附件 intake、限制与预览栏；不新增上传协议或第二套菜单组件。当 `plan` 投影的有效目标为 plan mode 时，InputBar 将文本框 placeholder 切换为 plan 任务措辞，经本包注册的 `conversation` locale 命名空间（`placeholder.plan` / `hint.plan` 键）本地化，并与已认领 `/plan` 命令的提示逐字共用同一份文案（经标准套件 `useProjection` 读取的 host 折叠值；owner 提供的 placeholder 优先）。另一个会话视图活跃时，待处理的 composer 接管仍保持挂载，使被阻塞的 agent（智能体）仍能收到回答；没有待处理交互时，活跃会话的 composer 归 Chat 所有。composer bar slot 本身为 `session-maybe`：没有当前会话时，同一个 bar 会让消息操作保持不可交互（machine face 均缺席、`disabled` owner prop），整张虚线卡片可经指针打开现有 Workspace picker，只读 textarea 也可通过 Enter 或 Space 打开。禁用控件会把指针事件交给卡片，卡片也会拦下 `pointerdown`，避免已打开 picker 的外点关闭与重新打开发生竞态。它不会换入一棵平行树，因此选择 Workspace 时 textarea DOM 不会被销毁；严格会话作用域的控件 seat 在会话存在之前保持为空。

```ts type-equiv
/** Owner values used to elect a composer takeover. */
interface ComposerChainProps {
  /** Current Session identity used by temporary business-owned entries. */
  sessionId: SessionId | undefined
  /** Current Session lifecycle state, absent without a selected Session. */
  session: SessionSnapshot | undefined
  /** Effective business-owned interaction awaiting the user in this Session. */
  pendingInteraction: SessionPendingInteraction | undefined
}
```

业务 package 可仅在一个 Remote waterfall request pending 期间安装 entry：

```tsx
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChainSelect, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface Request {
  readonly sessionId: SessionId
}

type RequestComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: Request }

const select: ChainSelect<ComposerChainProps, Request> = owner =>
  owner.sessionId === request.sessionId ? request : null

const dispose = ctx.slots.register(
  { name: 'conversation.composer', select },
  RequestComposer,
)

try {
  return await request.result
} finally {
  dispose()
}
```

selector 必须是 owner currency 的纯函数。非 null 返回值作为 `matched` 传给组件；`PropsRuntime<'conversation.composer'>` 提供标准 Session 与 global props。Chain 顺序仍按 `priority` 升序，再按注册顺序；首个返回非 null 的 selector 获选。Shell 会在 takeover 下保持默认 composer 挂载。Request 状态、listener、response encoding 和任何 request-specific child slot 都属于业务 package，不进入 `SessionSnapshot`，也不由 core package 声明。

<a id="model-experience"></a>
## 模型体验

无，因为本包渲染浏览器状态，并通过 Session Controller API 发送用户确认提交的输入，而不构造模型请求。

#### KV Cache 影响

无；Conversation 组装和浏览器输入状态不会改变提供方侧的 prompt cache。

## 已知限制与暂缓事项

- **统计行的回退折算只覆盖窗口内消息流**：未组合 `sessionStats` 投影单元的装配中，所有数字由快照的 assistant `timing` 与工具 call/result 配对折算，落在已加载事件窗口之外的节点（更早的历史）不计入，数字随加载页数增长。
- **详情面板没有入口**：`ChatViewInjected.openDetails` 虽已实现却无人调用，因此以原始形式显示已选择调用的那部分在组装后的应用中不可达。没有 Input/Output/Metadata 切换、Prev/Next 步进，也没有 trajectory 深链接。
- **assistant 逐消息分页是预留 slot**：设计中已有图稿，尚未实现。已定稿的内容 IconActions 行（复制／时钟／分支）只挂在每个已结束轮次中最后一条带 text 内容的 assistant 下；轮次中间的叙述、纯 Think 节点，以及仍在产出步骤的轮次里的所有节点都不带 chrome。除非该消息同时也是已完成轮次的最后一个 transcript 节点，否则分支保持禁用；启用后，它会 fork 到该轮次末尾，在 client 端递增继承标题并打开子会话。fork 或改名失败时源会话保持选中（[决策](../../../.agents/notes/implemented/bug-fix/2026-08-02-message-fork-actions-require-completed-turn-tail.zh.md)）。
- **已发送的 user 消息无法编辑**：user 气泡保留时钟和复制；分支只存在于 assistant 回答之下（[决策](../../../.agents/notes/implemented/simplification/2026-08-06-user-bubbles-drop-the-branch-action.zh.md)）。编辑功能要与其背后的能力一起回归：既需要针对已定稿 user 消息的 client 变更，也需要 host 侧对已经消费过它的轮次给出行为（[决策](../../../.agents/notes/implemented/simplification/2026-07-31-drop-user-message-edit-stub.zh.md)）。
- **others 工具行的闪光图标是手绘近似版本**：无法在本地导出设计字形的矢量几何；等到存在精确导出后再将其提升到 ui-primitives。
- **TodoPanel 将过长条目截成单行省略号**：figma 条没有换行或展开入口，完整文本无法在行内读完。
- **Queue 编辑仅支持文本**：包含非文本块的行仍显示扁平化预览，但由于内联编辑器无法保留这些块，其编辑控件会被禁用。文本行进入编辑模式后，删除和严格 steering 操作会被保存和取消取代；Enter 保存，Escape 取消。
- **Queue 严格 steering 会保留完整消息**：agent 运行期间，steering 操作会以原子方式把所寻址的 Queue 单次入队项转移到当前 next-step 窗口。包含混合内容的行仍可使用此操作，因为它会转发不可变消息，而非文本投影。带 placement 的 Host 快照会在会话流末尾渲染待处理 steering，直到已消费的 `user/message` 折叠进持久 transcript（文本记录），因此立即展示、重连和回放共享同一个线性权威。

<a id="known-limitations-and-deferred-work"></a>

- **只有已注册 target 可以渲染**——除已注册的 `chat` 偏好外，shell 刻意不提供隐式 fallback target。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Conversation Definition、target builder 与 View 已由其所属注册表和 Slot ledger 校验。
