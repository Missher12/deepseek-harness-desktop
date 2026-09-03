# 跨会话 Agent 通信插件实施计划

[English](2026-08-17-cross-session-agent-messaging-plugin.md) | 中文

> **供 agent 工作者使用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实施本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 让一条普通 Harness 会话可以通过 Session ID 向另一条普通会话发送消息、唤醒、回复并显式等待，同时提供持久 receipt 与紧凑的站内通知入口。

**架构：** 增加一个双端 `@deepseek-ai/dsh-session-messenger` 包。Host 端使用 ApiProxy 配置的 Typert `agent` lookup、一个 `storageDomain` receipt 表、四个全局工具，以及精确同源的 snapshot／ack／SSE 路由；Client 端只占用 `sidebar.footer.action`。投递遵循 write-ahead，并由预先创建的 Message ID 标识；等待只由 receipt 绑定的回复解决。

**技术栈：** TypeScript、Cordis、Harness Agent／Tools／Typert／Storage Domain API、React 18、基于 streaming fetch 的 SSE、Harness UI primitives、Vitest。

---

### 任务 1：搭建双端包与持久 receipt schema

**文件：**
- 新建：`packages/extensions/session-messenger/package.json`
- 新建：`packages/extensions/session-messenger/tsconfig.json`
- 新建：`packages/extensions/session-messenger/tsdown.config.ts`
- 新建：`packages/extensions/session-messenger/cordis.patch.yml`
- 新建：`packages/extensions/session-messenger/src/invariant.ts`
- 新建：`packages/extensions/session-messenger/src/spec.ts`
- 新建：`packages/extensions/session-messenger/src/types.ts`
- 新建：`packages/extensions/session-messenger/tests/spec.client.spec.ts`
- 修改：`tsconfig.host.json`
- 修改：`tsconfig.client.json`

- [ ] **步骤 1：编写失败的持久边界测试**

测试状态判别、16 KiB UTF-8 限制、24 小时过期、hop `0..8`、未解决 relay 信封必须存在，以及完成记录移除正文。

```ts ignore-check
expect(receiptSchema.safeParse({ ...prepared, envelope: undefined }).success).toBe(false)
expect(receiptSchema.parse(delivered)).not.toHaveProperty('envelope')
```

- [ ] **步骤 2：运行测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/spec.client.spec.ts`

预期：因为包和 schema 不存在而 FAIL。

- [ ] **步骤 3：定义一个版本化 domain 与包构建**

声明 `session_messenger` version `1`、`receipts` 表，以及 `prepared` 和 `delivery-recovery-pending` 成员必须包含受限 relay 信封的记录 union。包导出 `.`、`./invariant`、`./client` 和 `./cordis.patch.yml`，声明 `dsh.bundle.patch` 与 `dsh.client.platform: web`，并用 `clientBundle()` 生成 Host 与 Client 产物。

```ts ignore-check
export const sessionMessengerDomainSpec = defineDomain({
  name: 'session_messenger',
  version: 1,
  tables: { receipts: domainTable<DeliveryId, Receipt>(receiptSchema) },
})
```

- [ ] **步骤 4：运行 schema 与 workspace 检查**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/spec.client.spec.ts && pnpm run constraints`

预期：PASS。

- [ ] **步骤 5：提交包边界**

```bash
git add packages/extensions/session-messenger tsconfig.host.json tsconfig.client.json
git commit -m "feat: define session messenger receipts"
```

### 任务 2：通过 Harness 策略解析普通目标

**文件：**
- 新建：`packages/extensions/session-messenger/src/target-resolver.ts`
- 新建：`packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

- [ ] **步骤 1：编写失败的拒绝矩阵**

覆盖格式错误、self、lookup 前已归档、缺失、已删除、live subagent、cold subagent 和 lookup 后归档目标。断言所有拒绝分支都不产生 receipt、inbox 事件、wake 或模型请求。覆盖 live ordinary Agent 和按记录 preset 恢复的 cold ordinary 会话。

```ts ignore-check
await expect(resolveOrdinaryTarget(ctx, caller, raw)).rejects.toMatchObject({ code: 'target-archived' })
expect(agentLookup.resolve).not.toHaveBeenCalled()
```

- [ ] **步骤 2：运行测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

预期：因为缺少 `resolveOrdinaryTarget` 而 FAIL。

- [ ] **步骤 3：实现精确策略复用**

校验非空、可打印且不超过 256 字节的 Session ID，拒绝 `caller.id`，检查 `workspaceRegistry.archivedSessionIds`，调用 `ctx.typert.lookups.get('agent')?.resolve(SessionId(raw))`，归一化 `TypertLookupFailure`，并在返回 Agent 前立即再次检查归档集合。绝不调用 `ctx.agents.resume()`。

```ts ignore-check
const lookup = ctx.typert.lookups.get('agent')
if (lookup === undefined) throw messengerError('target-lookup-unavailable')
const target = await lookup.resolve(SessionId(raw)) as Agent | undefined
```

- [ ] **步骤 4：运行解析器测试**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

预期：PASS。

- [ ] **步骤 5：提交目标解析**

```bash
git add packages/extensions/session-messenger/src/target-resolver.ts packages/extensions/session-messenger/tests/target-resolver.client.spec.ts
git commit -m "feat: resolve safe ordinary session targets"
```

### 任务 3：实现 write-ahead 投递与崩溃恢复

**文件：**
- 新建：`packages/extensions/session-messenger/src/envelope.ts`
- 新建：`packages/extensions/session-messenger/src/receipt-store.ts`
- 新建：`packages/extensions/session-messenger/src/coordinator.ts`
- 新建：`packages/extensions/session-messenger/tests/coordinator.client.spec.ts`
- 新建：`packages/extensions/session-messenger/tests/recovery.client.spec.ts`

- [ ] **步骤 1：编写失败的 no-wake 与 wake 投递测试**

测试 live idle／running／cold 目标的 `inject()`、idle／running 目标的 `followup()`、FIFO、单一 driver、精确 Message ID、`prepared -> delivered`，以及已处理入队拒绝在返回前变为 terminal。

```ts ignore-check
expect(target.inject).toHaveBeenCalledWith(expect.objectContaining({ id: receipt.messageId }))
expect(target.followup).not.toHaveBeenCalled()
expect(await store.get(receipt.id)).toMatchObject({ status: 'delivered' })
```

- [ ] **步骤 2：编写失败的崩溃窗口测试**

模拟 `prepared` 后、入队后和写 delivered 状态期间的进程死亡。恢复必须用 `freezeMessage()` 和 `MessageId(receipt.messageId)` 重建原始 frozen `UserMessage`，先在 live inbox／session 事件与 cold persistence 中搜索该精确 ID，绝不重复入队同一个 ID。不得使用 `createUserMessage()`，因为它会在恢复时生成不同 ID。

- [ ] **步骤 3：运行测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/coordinator.client.spec.ts packages/extensions/session-messenger/tests/recovery.client.spec.ts`

预期：因为投递协调器缺失而 FAIL。

- [ ] **步骤 4：实现 write-ahead 协调器**

通过 `ctx.storageDomain.open()` 打开 `sessionMessengerDomainSpec`，并通过插件 effect disposer 关闭 domain。预先创建精确 Message ID 并持久化包含完整未解决信封的 receipt；在等待 `prepared` 写入后、真正入队前执行第三次归档检查，再通过 `inject` 或 `followup` 同步入队，随后用不含正文的 delivered 记录替换 receipt。第三次检查失败时必须把 prepared receipt 结算为 rejected，不能留下可恢复投递。若入队后的存储写入结果不确定，持久化或返回 `delivery-recovery-pending`。订阅精确的 inbox inserted／claimed／discarded 事件和 Agent 失败／取消边界，按 Message ID 更新非回复状态。每个来源在滚动一分钟内最多 30 次投递，未解决 receipt 最多 256 个；在启动时和一个有界定时器中让未解决 receipt 于 24 小时后过期，并在七天后压缩已完成元数据。

```ts ignore-check
await receipts.put(prepared)
await assertTargetStillOrdinaryAndUnarchived(target.id)
target[mode === 'send' ? 'inject' : 'followup'](message)
await receipts.put(toDelivered(prepared))
```

- [ ] **步骤 5：运行协调器测试**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/coordinator.client.spec.ts packages/extensions/session-messenger/tests/recovery.client.spec.ts`

预期：PASS。

- [ ] **步骤 6：提交投递引擎**

```bash
git add packages/extensions/session-messenger/src/envelope.ts packages/extensions/session-messenger/src/receipt-store.ts packages/extensions/session-messenger/src/coordinator.ts packages/extensions/session-messenger/tests/coordinator.client.spec.ts packages/extensions/session-messenger/tests/recovery.client.spec.ts
git commit -m "feat: add durable cross-session delivery"
```

### 任务 4：注册发送、跟进、回复和显式等待工具

**文件：**
- 新建：`packages/extensions/session-messenger/src/tools.ts`
- 新建：`packages/extensions/session-messenger/src/waits.ts`
- 新建：`packages/extensions/session-messenger/src/index.ts`
- 新建：`packages/extensions/session-messenger/tests/tools.client.spec.ts`
- 新建：`packages/extensions/session-messenger/tests/reply-wait.client.spec.ts`

- [ ] **步骤 1：编写失败的工具注册与发送方测试**

断言准确的四个全局名称、canonical output schema、来自 `exec.agent` 的调用方身份、稳定的缺失调用方拒绝、不存在 sender 参数、send 与 follow-up 模式，以及工具冲突在存储写入前失败。

- [ ] **步骤 2：编写失败的 reply 与 wait 测试**

覆盖错误调用方、伪造／过期／已消费 token、hop 8、默认不唤醒回复、显式唤醒回复、token 单次消费、回复到达竞态、timeout `1_000..55_000`、默认 `30_000`、工具 timeout `60_000`、转发 `exec.signal`、dispose 和无关 assistant 输出。spy `whenIdle()` 并断言零调用。

```ts ignore-check
expect(waitTool.timeoutMs).toBe(60_000)
expect(agent.whenIdle).not.toHaveBeenCalled()
```

- [ ] **步骤 3：运行测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/tools.client.spec.ts packages/extensions/session-messenger/tests/reply-wait.client.spec.ts`

预期：因为工具未注册而 FAIL。

- [ ] **步骤 4：实现四个 `defineTool` 定义**

通过 `ctx.tools.register()` 注册。渲染简洁文本，返回含 `deliveryId`、`messageId`、`status`、`wakeRequested` 和稳定错误码的 JSON-safe 值。`reply_to_session` 必须把调用方绑定到原 receipt 的目标侧，并从 receipt 推导目的地。`wait_for_session_reply` 只订阅协调器结算，并与 timeout、abort 和插件 dispose 竞速。

- [ ] **步骤 5：运行工具测试**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/tools.client.spec.ts packages/extensions/session-messenger/tests/reply-wait.client.spec.ts`

预期：PASS。

- [ ] **步骤 6：提交工具**

```bash
git add packages/extensions/session-messenger/src/tools.ts packages/extensions/session-messenger/src/waits.ts packages/extensions/session-messenger/src/index.ts packages/extensions/session-messenger/tests/tools.client.spec.ts packages/extensions/session-messenger/tests/reply-wait.client.spec.ts
git commit -m "feat: add cross-session messaging tools"
```

### 任务 5：增加认证通知路由与 footer UI

**文件：**
- 新建：`packages/extensions/session-messenger/src/http.ts`
- 新建：`packages/extensions/session-messenger/src/events.ts`
- 新建：`packages/extensions/session-messenger/src/client/index.tsx`
- 新建：`packages/extensions/session-messenger/src/client/MessengerStatus.tsx`
- 新建：`packages/extensions/session-messenger/src/client/MessengerStatus.module.css`
- 新建：`packages/extensions/session-messenger/src/client/store.ts`
- 新建：`packages/extensions/session-messenger/src/client/locales.ts`
- 新建：`packages/extensions/session-messenger/src/client/css-modules.d.ts`
- 新建：`packages/extensions/session-messenger/tests/http.client.spec.ts`
- 新建：`packages/extensions/session-messenger/tests/client.client.spec.tsx`

- [ ] **步骤 1：编写失败的 HTTP 信任与重连测试**

覆盖 mutation／stream 请求的精确 Host 与 Origin、cross-site 拒绝、capability 缺失／错误、无 ACAO header、4 KiB ack 上限、SSE client 数量上限、仅元数据 frame、单调 event ID、Last-Event-ID replay、权威 snapshot 和路由／连接 dispose。snapshot 与事件流必须使用 POST，确保真实同源 Chromium 会可靠附带 Origin。

- [ ] **步骤 2：编写失败的 Client slot 测试**

断言只注册 `sidebar.footer.action`；复制当前 Session ID 使用 `writeClipboard`；clipboard 返回 false 时绝不显示成功；unread／pending／error 同时使用文字和图标；ack 清除通知状态但不删除 receipt 或会话消息。

- [ ] **步骤 3：运行测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/http.client.spec.ts packages/extensions/session-messenger/tests/client.client.spec.tsx`

预期：因为通知界面缺失而 FAIL。

- [ ] **步骤 4：实现路由与 streaming-fetch SSE**

在 `/plugins/dsh-session-messenger` 下注册精确的 POST snapshot、ack 和事件流路由。向 index HTML 注入经过转义的每代 capability。Client 用带 capability header 的 POST `fetch` 解析 SSE frame，避免把 token 放入 URL；重连从 snapshot 开始，并按 event ID 去重。不得依赖 GET／EventSource 自定义 Origin，因为 Chromium 可能省略它，脚本也不能设置该 forbidden header。

- [ ] **步骤 5：实现紧凑的 Harness footer 入口**

使用 Harness primitives，并且只使用 `--dsw-*` 变量。展示状态、未读数、最近错误与“复制当前 Session ID”；不显示消息正文，也不替换会话行。增加键盘、`aria-live`、200% 缩放和减少动画覆盖。

- [ ] **步骤 6：运行 HTTP 与 Client 测试**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/http.client.spec.ts packages/extensions/session-messenger/tests/client.client.spec.tsx && pnpm run test:gui`

预期：PASS。

- [ ] **步骤 7：提交通知**

```bash
git add packages/extensions/session-messenger/src/http.ts packages/extensions/session-messenger/src/events.ts packages/extensions/session-messenger/src/client packages/extensions/session-messenger/tests/http.client.spec.ts packages/extensions/session-messenger/tests/client.client.spec.tsx
git commit -m "feat: add session message notifications"
```

### 任务 6：在 Desktop 挂载、记录并验收插件

**文件：**
- 新建：`packages/extensions/session-messenger/README.md`
- 新建：`packages/extensions/session-messenger/README.zh.md`
- 新建：`packages/extensions/session-messenger/README.i18n.yaml`
- 修改：`apps/desktop/package.json`
- 修改：`apps/desktop/desktop.cordis.patch.yml`
- 修改：`scripts/stage-desktop.ts`
- 修改：`scripts/stage-desktop.spec.ts`
- 修改：`PROJECT_CONTEXT.md`
- 新建：`.agents/notes/proposed/feature/2026-08-17-cross-session-agent-messaging-plugin.md`
- 新建：`.agents/notes/proposed/feature/2026-08-17-cross-session-agent-messaging-plugin.zh.md`
- 新建：`.agents/notes/proposed/feature/2026-08-17-cross-session-agent-messaging-plugin.i18n.yaml`

- [ ] **步骤 1：添加失败的组装 profile 测试**

断言只有一个 Desktop Loader 配置项、所有 Host／Client 产物进入 stage、四个工具在 native 与 code mode 可见、三条路由存在，并且停用后所有贡献都消失。普通 Web composition 必须保持不变。

- [ ] **步骤 2：运行组装测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/loader-composition.client.spec.ts scripts/stage-desktop.spec.ts apps/desktop/tests/manifest.spec.ts`

预期：因缺少 Desktop 集成而 FAIL。

- [ ] **步骤 3：接入并记录插件**

添加 workspace 依赖和一个 `session-messenger` patch 配置项。扩展 staging，纳入 `lib/index.js`、`lib/client.js` 和包元数据。记录 no-wake 语义、cold 内存恢复、归档竞态边界、receipt 保留期、不提供原生通知，以及四个准确工具约定。

- [ ] **步骤 4：运行插件与仓库完整门禁**

运行：`pnpm install && pnpm run build && pnpm exec vitest run packages/extensions/session-messenger scripts/stage-desktop.spec.ts apps/desktop/tests/manifest.spec.ts && pnpm run typecheck && pnpm run lint && pnpm run verify-package-invariants && pnpm run verify-cordis-config && pnpm run doc-sync && git diff --check`

预期：每条命令退出码都是 `0`。

- [ ] **步骤 5：执行真实双会话 Mac 验收**

在临时 `DSH_HOME` 中创建两条普通会话。复制 A 的精确 Session ID，A→B 发送 no-wake 消息并证明 B 没有模型请求；发送 follow-up 并证明单一 driver；B→A 回复并解决显式等待。重启后验证 receipt 恢复，再证明 self、归档、缺失和 subagent 目标不会改变日志、inbox、运行状态或 receipt。停用插件后，工具、路由、wait 和 footer 入口消失，已提交的会话消息保留。

- [ ] **步骤 6：提交 Desktop 集成**

```bash
git add apps/desktop scripts PROJECT_CONTEXT.md packages/extensions/session-messenger .agents/notes/proposed/feature/2026-08-17-cross-session-agent-messaging-plugin*
git commit -m "feat: integrate session messenger plugin"
```
