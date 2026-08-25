# `dsh-lark` 飞书远程 Session 插件实现计划

[English](2026-08-25-dsh-lark-remote-session-plugin.md) | 中文

> **供 Agent 执行者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。步骤用复选框（`- [ ]`）追踪。

**目标：** 交付独立可安装的 Harness Bundle，让唯一配对的飞书 owner 通过 `/` 选择普通 Harness Session，严格按顺序提交开发回合，并用安全的流式卡片观察和控制同一个 Session。

**架构：** 双端包 `@deepseek-ai/dsh-lark` 包含 Host 传输/运行时和 Client 设置页。Host 复用 `ctx.apiProxy` 的 Session 列表、mux 投影、工具展示、审批及响应；飞书长连接和卡片使用官方 Node SDK；owner 绑定、去重、FIFO、卡片 revision 和暂存文件元数据进入插件专属 Storage Domain。插件不嵌入 OpenClaw，也不创建第二套 Agent Runtime。

**技术栈：** TypeScript 6、Cordis、Harness ApiProxy/Agent/Attachment/Settings/Credentials/Storage Domain API、`@larksuiteoapi/node-sdk`、Schemastery、React 18、Harness UI primitives、Vitest。

---

## 文件职责

- `src/config.ts`：Schemastery 设置、凭据引用和安全默认值。
- `src/state.ts`：版本化 Storage Domain 记录和仓储。
- `src/transport.ts`：官方 SDK Client、WebSocket 生命周期、消息/卡片/媒体操作。
- `src/identity.ts`：owner 配对及全部私聊/回调身份防线。
- `src/binding.ts`：项目/Session 列表、普通 Session 校验和绑定 generation。
- `src/commands.ts`：精确 slash 快路径和签名卡片操作。
- `src/inbox.ts`：飞书持久去重/FIFO 与 Harness Message ID 对账。
- `src/projection.ts`：ApiProxy mux 的文本、工具、耗时、用量及审批投影。
- `src/cards.ts`：单卡片渲染、单调节流更新和文本降级。
- `src/attachments.ts`：AttachmentStore 图片及普通文件私有暂存。
- `src/runtime.ts`：激活、暂停/恢复/清空、事件所有权和完整拆卸。
- `src/http.ts`：设置页使用的同源 capability 桥。
- `src/client/*`：本地化 Harness 设置页及 controller/store。
- `tests/*.host.spec.ts`：Host 行为与集成边界。
- `tests/*.client.spec.tsx`：Client slot、状态和凭据单向写入行为。

### 任务 1：定义可安装包、配置和持久状态

**文件：**
- 新建：`packages/extensions/lark/package.json`
- 新建：`packages/extensions/lark/tsconfig.json`
- 新建：`packages/extensions/lark/tsdown.config.ts`
- 新建：`packages/extensions/lark/cordis.patch.yml`
- 新建：`packages/extensions/lark/src/config.ts`
- 新建：`packages/extensions/lark/src/state.ts`
- 新建：`packages/extensions/lark/src/invariant.ts`
- 新建：`packages/extensions/lark/tests/package-shape.host.spec.ts`
- 新建：`packages/extensions/lark/tests/state.host.spec.ts`
- 修改：`tsconfig.host.json`
- 修改：`tsconfig.client.json`

- [ ] **步骤 1：先写包和状态合同的失败测试**

验证公开包名/版本、`dsh.bundle.patch`、Web Client 注入、唯一 `lark` patch 行、无 OpenClaw 依赖/import/状态路径，以及 owner、binding、queue、card、callback nonce、staged file 的精确 v1 记录。

代表性断言会检查 `manifest.name === '@deepseek-ai/dsh-lark'`，拒绝序列化 manifest 中出现任何 `openclaw`，并解析 sequence 为 `1` 的 `prepared` 队列记录。

- [ ] **步骤 2：确认 RED**

运行：`pnpm exec vitest run packages/extensions/lark/tests/package-shape.host.spec.ts packages/extensions/lark/tests/state.host.spec.ts`

预期：包和 schema 尚不存在，测试失败。

- [ ] **步骤 3：添加最小包与 schema**

使用仓库版本 `0.1.1-rc.2`、官方 SDK 依赖 `^1.64.0`、Harness workspace peers、`clientBundle()` 和 `defineDomain({ name: 'dsh_lark', version: 1, ... })`。只存凭据引用，绝不存 App Secret 内容。

用 `credentialRef('DSH_LARK_APP_SECRET')` 定义 `LARK_APP_SECRET_REF`，并把 `larkDomainSpec` 定义为拥有 owner、binding、inbox 和 card 表的 v1 `dsh_lark` domain。

- [ ] **步骤 4：运行 GREEN 并提交**

运行：`pnpm exec vitest run packages/extensions/lark/tests/package-shape.host.spec.ts packages/extensions/lark/tests/state.host.spec.ts && pnpm run constraints`

预期：通过。提交：`feat: define dsh lark bundle state`

### 任务 2：增加 owner-only SDK 传输和精确 `/` 入口

**文件：**
- 新建：`packages/extensions/lark/src/transport.ts`
- 新建：`packages/extensions/lark/src/identity.ts`
- 新建：`packages/extensions/lark/src/commands.ts`
- 新建：`packages/extensions/lark/src/cards.ts`
- 新建：`packages/extensions/lark/tests/transport.host.spec.ts`
- 新建：`packages/extensions/lark/tests/commands.host.spec.ts`
- 新建：`packages/extensions/lark/LICENSE`
- 修改：`packages/extensions/lark/LICENSE`

- [ ] **步骤 1：先写传输与身份失败测试**

覆盖缺失凭据、飞书/Lark 域名、SDK 启动/强制关闭、自回声拒绝、只接受 p2p、精确 owner/chat 校验、回调 generation/nonce/过期、重复 Message ID 和日志脱敏。

- [ ] **步骤 2：先写 `/` 失败测试**

精确 `/`、`/进入` 和菜单 `进入项目` 必须调用 `sendProjectCard()`，不得触发 `Agent.followup`、`Agent.steer`、模型 API 或 Session 变更。覆盖 `/切换`、`/解绑`、`/状态` 和 `/帮助`；未配对用户只能得到短配对码，不能得到任何项目事实；未知 slash 命令返回有界帮助。

核心断言发送 `ownerDm('/')`，要求 `sendProjectCard()` 恰好调用一次，并要求 `Agent.followup()` 完全不调用。

- [ ] **步骤 3：确认 RED**

运行：`pnpm exec vitest run packages/extensions/lark/tests/transport.host.spec.ts packages/extensions/lark/tests/commands.host.spec.ts`

预期：缺少 transport/router，测试失败。

- [ ] **步骤 4：实现最小官方 SDK 传输**

创建 `Client`、`EventDispatcher`、`WSClient`，只注册 `im.message.receive_v1` 和 `card.action.trigger`；映射飞书/Lark 域名；abort 时使用 `{ force: true }` 关闭。只移植 MIT 允许的宿主无关队列/刷新思想并记录归属。

- [ ] **步骤 5：实现 owner 防线和签名卡片值**

读取项目数据前校验 app、sender `open_id`、`chat_type === 'p2p'`、`chat_id`、当前 generation、随机一次性 nonce 和 TTL；接受输入必须先持久去重再确认。

- [ ] **步骤 6：运行 GREEN 并提交**

运行：`pnpm exec vitest run packages/extensions/lark/tests/transport.host.spec.ts packages/extensions/lark/tests/commands.host.spec.ts`

预期：通过。提交：`feat: add owner gated lark transport`

### 任务 3：选择项目和普通 Session，并持久绑定

**文件：**
- 新建：`packages/extensions/lark/src/binding.ts`
- 新建：`packages/extensions/lark/tests/binding.host.spec.ts`
- 修改：`packages/extensions/session-messenger/src/target-resolver.ts`
- 修改：`packages/extensions/session-messenger/package.json`
- 修改：`packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

- [ ] **步骤 1：先写解析器提升失败测试**

从 session-messenger 导出不依赖 source 的 `resolveOrdinarySession(ctx, sessionId)` 和 `assertOrdinarySession`。覆盖 live/cold 普通、归档、删除、缺失、subagent、cwd 不符和 lookup 失败，禁止直接创建 driver。

- [ ] **步骤 2：先写卡片选择失败测试**

使用 `ctx.apiProxy.workspace.list` 和 `ctx.apiProxy.sessions.list`；保持项目顺序；显示完整路径；隐藏归档/空白/subagent/cwd 不符 Session；运行中优先；每次 action 重验；只持久一个 owner/chat binding 并递增 generation。

- [ ] **步骤 3：确认 RED**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/target-resolver.client.spec.ts packages/extensions/lark/tests/binding.host.spec.ts`

预期：新公共解析器和 BindingController 尚缺，测试失败。

- [ ] **步骤 4：实现解析器复用和 BindingController**

每次 ApiProxy list 调用生成 `RpcId`，拒绝失败 RPC；把 Session summary 与 Workspace 账户连接；提交前调用提升后的 Typert resolver。重启恢复比较 owner、chat、canonical cwd、archive set、source 和 generation。

通过 `resolveOrdinarySession(ctx, SessionId(action.sessionId))` 解析所选目标，再用 `generation: previousGeneration + 1` 持久化 candidate。

- [ ] **步骤 5：运行 GREEN 并提交**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/target-resolver.client.spec.ts packages/extensions/lark/tests/binding.host.spec.ts`

预期：通过。提交：`feat: bind lark chats to ordinary sessions`

### 任务 4：严格持久 FIFO 和远程控制命令

**文件：**
- 新建：`packages/extensions/lark/src/inbox.ts`
- 新建：`packages/extensions/lark/tests/inbox.host.spec.ts`
- 新建：`packages/extensions/lark/tests/recovery.host.spec.ts`
- 修改：`packages/extensions/lark/src/commands.ts`

- [ ] **步骤 1：先写 FIFO 失败测试**

覆盖单调序号、event ID 去重、ack 前 write-ahead、每 binding 单消费者、预生成 Harness Message ID、`prepared -> queued -> claimed -> terminal`，并证明 N 对应的 turn 结束前不会提交 N+1。

- [ ] **步骤 2：先写恢复和控制失败测试**

模拟 enqueue 前、inbox 插入后、claim 后和 `turn/end` 后崩溃；恢复必须复用同一 Message ID。`/插话` 只调用 `steer`；`/停止` 取消未投递远程记录、移除未 claim 的匹配 ID，并调用 `cancel({ kind: 'user' }, { keepInbox: true })`，不得删除其他来源 inbox。

- [ ] **步骤 3：确认 RED**

运行：`pnpm exec vitest run packages/extensions/lark/tests/inbox.host.spec.ts packages/extensions/lark/tests/recovery.host.spec.ts`

预期：DurableInbox 尚缺，测试失败。

- [ ] **步骤 4：实现严格终止边界投递**

创建 `source: { kind: 'plugin', plugin: 'dsh-lark' }` 的 `UserMessage`，持久化 ID，只调用一次 `Agent.followup()`；将 `agent/inbox/claimed` 关联到 turn，仅在该 turn 的 `turn/end` 推进。重试前对账 live inbox 和 Session events。

- [ ] **步骤 5：运行 GREEN 并提交**

运行：`pnpm exec vitest run packages/extensions/lark/tests/inbox.host.spec.ts packages/extensions/lark/tests/recovery.host.spec.ts`

预期：通过。提交：`feat: add durable lark session fifo`

### 任务 5：把 Harness 流式输出投影到一张单调卡片

**文件：**
- 新建：`packages/extensions/lark/src/projection.ts`
- 新建：`packages/extensions/lark/tests/projection.host.spec.ts`
- 新建：`packages/extensions/lark/tests/cards.host.spec.ts`
- 修改：`packages/extensions/lark/src/cards.ts`

- [ ] **步骤 1：先写投影失败测试**

输入真实 ApiProxy mux 的 `assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`turn/end`、Host 工具 view、usage 和 approval frame。隐藏推理、system 内容、环境值和原始工具参数不得进入卡片状态。

- [ ] **步骤 2：先写卡片调度失败测试**

验证每 turn 一张卡、稳定占位先绘制、打字机文本增长、revision 单调、可配置节流、并发更新后 reflush、耗时、真实 Token 或 `暂不可用`、final 去重，以及卡片失败后的有界文本降级。

- [ ] **步骤 3：确认 RED**

运行：`pnpm exec vitest run packages/extensions/lark/tests/projection.host.spec.ts packages/extensions/lark/tests/cards.host.spec.ts`

预期：Projection/CardController 尚缺，测试失败。

- [ ] **步骤 4：实现 mux fold 和卡片 Controller**

用同一个 activation abort signal 打开 `ctx.apiProxy.events.mux`，按当前 binding 过滤，只向前 fold；工具只渲染 Host view；Token 只累加 Harness `TokenUsage`；SDK 更新由 mutex 和 `needsReflush` 控制。

- [ ] **步骤 5：运行 GREEN 并提交**

运行：`pnpm exec vitest run packages/extensions/lark/tests/projection.host.spec.ts packages/extensions/lark/tests/cards.host.spec.ts`

预期：通过。提交：`feat: stream harness turns to lark cards`

### 任务 6：增加附件和单赢家审批

**文件：**
- 新建：`packages/extensions/lark/src/attachments.ts`
- 新建：`packages/extensions/lark/tests/attachments.host.spec.ts`
- 新建：`packages/extensions/lark/tests/approval.host.spec.ts`
- 修改：`packages/extensions/lark/src/projection.ts`
- 修改：`packages/extensions/lark/src/commands.ts`

- [ ] **步骤 1：先写附件失败测试**

覆盖下载前 owner 校验、默认 30 MiB、图片媒体校验和 `ctx.attachments.saveImages`、Harness home 下随机普通文件暂存、安全文件名、SHA-256、原子发布、`0600`、零项目写入、部分失败拒绝和七天有界清理。

- [ ] **步骤 2：先写审批失败测试**

从现有 mux 捕获 `approval/requested` 的 rpcId/approvalId。飞书只可返回 `allowed-once` 或 `rejected`；校验 owner/chat/session/generation/nonce/TTL；调用 `ctx.apiProxy.respond`；`not-pending` 表示已处理；确保没有注册第二个 `approval/request` listener。

- [ ] **步骤 3：确认 RED**

运行：`pnpm exec vitest run packages/extensions/lark/tests/attachments.host.spec.ts packages/extensions/lark/tests/approval.host.spec.ts`

预期：适配器尚缺，测试失败。

- [ ] **步骤 4：实现附件和审批**

图片留在 AttachmentStore；普通文件留在插件 staging root。用原 rpcId 和精确 Session/Approval ID 构造 ApiProxy `client-response`，使桌面和飞书竞争同一 pending entry。

- [ ] **步骤 5：运行 GREEN 并提交**

运行：`pnpm exec vitest run packages/extensions/lark/tests/attachments.host.spec.ts packages/extensions/lark/tests/approval.host.spec.ts`

预期：通过。提交：`feat: add lark attachments and approvals`

### 任务 7：增加 Harness 设置页和生命周期 Controller

**文件：**
- 新建：`packages/extensions/lark/src/http.ts`
- 新建：`packages/extensions/lark/src/runtime.ts`
- 新建：`packages/extensions/lark/src/index.ts`
- 新建：`packages/extensions/lark/src/client/index.ts`
- 新建：`packages/extensions/lark/src/client/index.tsx`
- 新建：`packages/extensions/lark/src/client/LarkSettingsSection.tsx`
- 新建：`packages/extensions/lark/src/client/LarkSettingsSection.module.css`
- 新建：`packages/extensions/lark/src/client/store.ts`
- 新建：`packages/extensions/lark/src/client/locales.ts`
- 新建：`packages/extensions/lark/src/client/css-modules.d.ts`
- 新建：`packages/extensions/lark/tests/http.host.spec.ts`
- 新建：`packages/extensions/lark/tests/runtime.host.spec.ts`
- 新建：`packages/extensions/lark/tests/client.client.spec.tsx`

- [ ] **步骤 1：先写 Host 生命周期失败测试**

覆盖同源随机 capability 路由、有界 body、App Secret 单向写入凭据、配对码确认、测试连接、启停、重新启用仍暂停、显式恢复/清空、数据清理、暂存清理、脱敏诊断和 disposer 完整性。

- [ ] **步骤 2：先写 Client 失败测试**

验证唯一 `settings.section`、本地化标签、数据前稳定占位、无 secret 回显、credential `set` 单向写入、配对/连接/binding/queue 状态、危险操作禁用逻辑和清除/重配确认。

- [ ] **步骤 3：确认 RED**

运行：`pnpm exec vitest run packages/extensions/lark/tests/http.host.spec.ts packages/extensions/lark/tests/runtime.host.spec.ts packages/extensions/lark/tests/client.client.spec.tsx`

预期：runtime/Client surface 尚缺，测试失败。

- [ ] **步骤 4：实现运行时组合和设置 UI**

注册 Settings 和凭据引用，注入 generation-scoped bootstrap capability，只暴露窄状态/动作，挂载 `settings.section` id `lark`。关闭顺序：拒绝 ingress、abort WebSocket/mux、取消 timer、排空卡片刷新和状态写入、释放 route/listener。

- [ ] **步骤 5：运行 GREEN 并提交**

运行：`pnpm exec vitest run packages/extensions/lark/tests/http.host.spec.ts packages/extensions/lark/tests/runtime.host.spec.ts packages/extensions/lark/tests/client.client.spec.tsx && pnpm run test:gui`

预期：通过。提交：`feat: add dsh lark settings lifecycle`

### 任务 8：文档、打包、安装和完整验证

**文件：**
- 新建：`packages/extensions/lark/README.md`
- 新建：`packages/extensions/lark/README.zh.md`
- 新建：`packages/extensions/lark/README.i18n.yaml`
- 修改：`packages/extensions/README.md`
- 修改：`packages/extensions/README.zh.md`
- 修改：`packages/extensions/README.i18n.yaml`
- 修改：`PROJECT_CONTEXT.md`
- 新建：`packages/extensions/lark/tests/loader-composition.client.spec.ts`
- 新建：`packages/extensions/lark/tests/profile-install.host.spec.ts`

- [ ] **步骤 1：先写组合/安装失败测试**

验证 built Host/Client/invariant exports、唯一可移除 Loader row、安装事务同时写 dependency 和 `dsh.profile.bundles`、不加入 Desktop 默认 patch、停用/卸载不触碰 Session，以及移除后 Web Profile 正常启动。

- [ ] **步骤 2：确认 RED**

运行：`pnpm exec vitest run packages/extensions/lark/tests/loader-composition.client.spec.ts packages/extensions/lark/tests/profile-install.host.spec.ts`

预期：导出和文档未完成前失败。

- [ ] **步骤 3：补齐双语文档和包校验**

记录飞书应用权限/事件、凭据录入、配对、精确 `/` 行为、命令、队列语义、离线边界、停用/重启行为和卸载。注明参考的 OpenClaw-Lark npm `2026.7.16` MIT 逻辑，不捆绑该包。

- [ ] **步骤 4：运行完整离线门禁**

运行：`pnpm install --frozen-lockfile && pnpm run build && pnpm exec vitest run packages/extensions/lark packages/extensions/session-messenger/tests/target-resolver.client.spec.ts && pnpm run typecheck:contracts-ready && pnpm run lint:contracts-ready && pnpm run verify-package-invariants && pnpm run verify-cordis-config && pnpm run doc-sync && git diff --check`

预期：全部退出码为 `0`。

- [ ] **步骤 5：打包并运行真实 Profile 预检**

打包 workspace 包，把 tarball 安装到临时真实 `web` Profile，重启确认设置页/Host 激活；关闭后确认零运行资源；移除后确认 Profile 仍可启动。禁止从 OpenClaw 或 Hermes 导入凭据。

- [ ] **步骤 6：有凭据时运行飞书实测**

只使用用户在 Harness 中录入的凭据：配对 owner、发送 `/`、选择项目/Session、连续发多条验证 FIFO/重启、验证流式文本/工具/时间/Token、图片/文件、一次审批、`/插话`、`/停止` 和关闭插件。没有用户录入凭据时明确标记此层未运行，不读取其他 Runtime 的 secret。

- [ ] **步骤 7：提交最终交付**

提交：`feat: ship dsh lark remote sessions`
