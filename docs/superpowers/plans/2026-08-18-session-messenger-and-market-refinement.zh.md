# 会话通信与插件市场优化实施计划

[English](2026-08-18-session-messenger-and-market-refinement.md) | 中文

> **供 Agent 工作者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务实施本计划。各步骤使用复选框（`- [ ]`）跟踪。

**目标：** 在 Desktop 0.1.6 中交付可见的跨会话 relay 卡片、具备安全发送与回复操作的受约束可调宽通信抽屉，以及顺序稳定并支持横向滚动的插件分类轨道。

**架构：** 持久 `user/message` 继续作为 relay 唯一记录。Host coordinator 拥有来源验证和一次性回复权限；精确同源 POST 路由只暴露有界用户输入与投递结果。可移除 Client 插件注册一个会话标题栏入口和一个 shell overlay 抽屉，`ui-conversation` 识别结构化 messenger relay source 并展示正文，不复制会话事件。dshmarket 补丁保持 registry 顺序与原生横向滚动。

**技术栈：** TypeScript、Cordis、React 18、Harness slot/runtime API、Node HTTP、CSS Modules、pnpm patch、Vitest、Electron Builder、GitHub Actions。

---

### 任务 1：结构化 relay 记录，并让回复权限只留在 Host

**文件：**
- 修改：`packages/extensions/session-messenger/src/envelope.ts`
- 修改：`packages/extensions/session-messenger/src/coordinator.ts`
- 修改：`packages/extensions/session-messenger/src/tools.ts`
- 修改：`packages/extensions/session-messenger/src/types.ts`
- 测试：`packages/extensions/session-messenger/tests/coordinator.client.spec.ts`
- 测试：`packages/extensions/session-messenger/tests/tools.client.spec.ts`

- [ ] **步骤 1：编写失败的结构化 relay 与 token 隐私测试**

断言第一个文本块包含有界 Harness 元数据，第二个文本块是精确的不可信正文；source 携带 `senderSessionId`、`deliveryId`、`mode` 和 `bodyBlockIndex: 1`。断言序列化消息不包含 `replyToken`，`reply_to_session` 只需要已寻址 caller 与 delivery ID。

```text
expect(message.source).toMatchObject({
  kind: 'plugin', plugin: 'dsh-session-messenger', form: 'relay',
  senderSessionId: source.id, deliveryId: receipt.id, mode: 'inject', bodyBlockIndex: 1,
})
expect(message.content[1]).toEqual({ type: 'text', text: 'hello' })
expect(JSON.stringify(message)).not.toContain(String(receipt.replyToken))
```

- [ ] **步骤 2：运行聚焦测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/coordinator.client.spec.ts packages/extensions/session-messenger/tests/tools.client.spec.ts`

预期：FAIL，因为当前 relay 是一个 opaque 文本块，回复工具还要求模型或浏览器可见 token。

- [ ] **步骤 3：实现结构化 source 与 receipt 绑定回复适配器**

用两个 block 构建冻结消息，并通过本地 source 类型转换保持可扩展消息来源。增加 `replyToDelivery(caller, { deliveryId, message, wake })`，从保留的 receipt 取得内部 token，再委托现有串行 `reply()` 路径；token 继续留在持久存储，但从模型文本和工具参数移除。

```text
content: [
  { type: 'text', text: relayMetadata(receipt) },
  { type: 'text', text: receipt.envelope.body },
],
source: {
  kind: 'plugin', plugin: 'dsh-session-messenger', form: 'relay',
  senderSessionId: receipt.sourceSessionId, deliveryId: receipt.id,
  mode: receipt.mode, bodyBlockIndex: 1,
} as UserMessage['source']
```

- [ ] **步骤 4：运行聚焦测试并提交**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/coordinator.client.spec.ts packages/extensions/session-messenger/tests/tools.client.spec.ts`

预期：PASS。

提交：`git commit -am "feat: structure cross-session relay messages"`

### 任务 2：增加零副作用拒绝的精确同源操作路由

**文件：**
- 修改：`packages/extensions/session-messenger/src/http.ts`
- 修改：`packages/extensions/session-messenger/src/protocol.ts`
- 修改：`packages/extensions/session-messenger/src/target-resolver.ts`
- 修改：`packages/extensions/session-messenger/src/index.ts`
- 测试：`packages/extensions/session-messenger/tests/http.client.spec.ts`
- 测试：`packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

- [ ] **步骤 1：编写失败的发送／回复信任矩阵**

为 `SEND_PATH` 与 `REPLY_PATH` 增加路由测试：精确 loopback Host、精确 Origin、单个 capability header、仅 POST、仅 JSON、16 KiB UTF-8 正文、可打印 ID、在线普通非空 source、普通 target、归档／子 Agent／self／缺失拒绝，以及回复所有权。每次拒绝前记录 receipt 数、inbox 调用、wake 调用与会话事件长度，拒绝后断言完全相等。

```text
const before = { receipts: source.receiptEntries().length, events: target.session.events.length }
const rejected = await invoke(route(surface, SEND_PATH), validHeaders(true), JSON.stringify(body))
expect(rejected.status).toBe(409)
expect({ receipts: source.receiptEntries().length, events: target.session.events.length }).toEqual(before)
```

- [ ] **步骤 2：运行 HTTP 测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/http.client.spec.ts packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

预期：FAIL，因为操作路由和 source resolver 尚不存在。

- [ ] **步骤 3：实现 source 权限与有界路由**

只通过 `ctx.agents.get(SessionId(raw))` 解析界面当前 source；拒绝归档项、`origin: 'subagent'`、受拥有 child，以及没有 `turn/start` 的会话。按操作正文上限 `MAX_MESSAGE_BYTES + 2048` 解析 `{ sourceSessionId, targetSessionId, message, wake }` 和 `{ sourceSessionId, deliveryId, message, wake }`。只返回 `{ deliveryId, messageId, status, wakeRequested }` 或 `{ errorCode }`，绝不返回 receipt、正文或 reply token。

```text
const source = resolveOrdinaryOperatorSource(ctx, body.sourceSessionId)
const result = await coordinator.deliver(source, {
  targetSessionId: body.targetSessionId,
  message: body.message,
  mode: body.wake ? 'followup' : 'inject',
})
json(res, 200, result)
```

- [ ] **步骤 4：运行 HTTP 测试并提交**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/http.client.spec.ts packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

预期：PASS，包括完整拒绝零副作用矩阵。

提交：`git commit -am "feat: add safe session messaging routes"`

### 任务 3：渲染一个可见的 Harness relay 卡片

**文件：**
- 新建目标：`packages/client/ui-conversation/src/client/chat/<RelayMessageCard.tsx>`
- 新建目标：`packages/client/ui-conversation/src/client/chat/<RelayMessageCard.module.css>`
- 修改：`packages/client/ui-conversation/src/client/chat/MessageItem.tsx`
- 修改：`packages/client/ui-conversation/src/client/locales.ts`
- 测试：`packages/client/ui-conversation/tests/chat-branch-tails.client.spec.tsx`

- [ ] **步骤 1：编写失败的卡片与 fallback 测试**

渲染结构化 messenger relay，断言无需展开 disclosure 就能看到发送方、精确第二 block 正文、投递时间、复制来源操作和回复事件。渲染缺少 `bodyBlockIndex` 的旧 relay 与外部 relay，断言两者继续使用 `ContextInjectionRow`。

```text
expect(view.container.querySelector('[data-session-relay-card]')).not.toBeNull()
expect(screen.getByText('hello from another session')).toBeTruthy()
fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ deliveryId: 'delivery-1' }))
```

- [ ] **步骤 2：运行会话测试并确认 RED**

运行：`pnpm exec vitest run packages/client/ui-conversation/tests/chat-branch-tails.client.spec.tsx`

预期：FAIL，因为所有 relay 仍使用折叠 context 行。

- [ ] **步骤 3：实现严格识别与可见卡片**

只接受 `kind: 'plugin'`、plugin 为 `dsh-session-messenger`、form 为 `relay`、可打印 sender/delivery ID、`inject|followup` mode，以及落在范围内的文本 `bodyBlockIndex`。渲染精确正文 block，派发携带 delivery ID 的 `dsh-session-messenger:reply`，用 `writeClipboard` 复制 sender ID，并把元数据放进有界原生 disclosure。所有不可读形状原样 fallback。

```text
return relay === null
  ? <ContextInjectionRow {...props} />
  : <RelayMessageCard relay={relay} time={data.time} t={t} />
```

- [ ] **步骤 4：运行会话测试并提交**

运行：`pnpm exec vitest run packages/client/ui-conversation/tests/chat-branch-tails.client.spec.tsx packages/client/ui-conversation/tests/chat-view.client.spec.tsx`

预期：PASS。

提交：`git add packages/client/ui-conversation && git commit -m "feat: show cross-session relay cards"`

### 任务 4：用可调宽标题栏抽屉替换穿出的底部弹层

**文件：**
- 新建目标：`packages/extensions/session-messenger/src/client/<MessengerUiController.ts>`
- 新建目标：`packages/extensions/session-messenger/src/client/<MessengerHeaderButton.tsx>`
- 新建目标：`packages/extensions/session-messenger/src/client/<MessengerDrawer.tsx>`
- 修改：`packages/extensions/session-messenger/src/client/index.tsx`
- 修改：`packages/extensions/session-messenger/src/client/store.ts`
- 修改：`packages/extensions/session-messenger/src/client/MessengerStatus.module.css`
- 修改：`packages/extensions/session-messenger/src/client/locales.ts`
- 修改：`packages/extensions/session-messenger/package.json`
- 测试：`packages/extensions/session-messenger/tests/client.client.spec.tsx`
- 测试：`packages/extensions/session-messenger/tests/loader-composition.client.spec.ts`

- [ ] **步骤 1：编写失败的注册、几何与操作测试**

断言一个 `conversation.session.header.utilities` 入口和一个 `shell.overlay` 抽屉，并且没有 footer occupant。覆盖 badge 计数、精确复制 Session ID、Escape 恢复焦点、切换会话关闭、宽度限制 `320..560`、数值宽度持久化、窄屏全宽、listener 清理、发送与回复请求、禁止重复提交、失败草稿保留、标记已读，以及 relay 卡片事件打开回复。

```text
expect(ctx.slots.entries('sidebar.footer.action')).toEqual([])
expect(ctx.slots.entries('conversation.session.header.utilities')).toHaveLength(1)
expect(ctx.slots.entries('shell.overlay')).toHaveLength(1)
expect(localStorage.getItem('dsh-session-messenger.drawer-width')).toBe('480')
```

- [ ] **步骤 2：运行 Client 测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/client.client.spec.tsx packages/extensions/session-messenger/tests/loader-composition.client.spec.ts`

预期：FAIL，因为仍然是 footer 注册与固定 popover。

- [ ] **步骤 3：扩展 transport 并增加微型 UI controller**

增加使用现有 capability header 和 abort 生命周期的 `send()` 与 `reply()` transport 方法。controller 发布 `{ openSessionId, replyDeliveryId, width }`，把宽度限制为 `320..560`，只持久化数字，并在关闭或切换会话时清理回复状态。

```text
async send(input, signal) {
  return operatorRequest(bootstrap.sendPath, input, signal)
}
async reply(input, signal) {
  return operatorRequest(bootstrap.replyPath, input, signal)
}
```

- [ ] **步骤 4：实现标题栏按钮与 overlay 抽屉**

标题栏入口使用 `sessionId` 注册，overlay 使用 `useSessions`。抽屉显示当前会话 receipt 行、目标／正文／wake composer、receipt 绑定回复模式、有界诊断，以及复制／确认操作。左侧把手使用 pointer capture 和 CSS variable 控制宽度；`max-width: 720px` 时使用 `inset: 38px 0 0` 并隐藏把手。overlay 根保持点击穿透，抽屉恢复 pointer event。

```text
ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(headerOptions, MessengerHeaderButton))
ctx.slots.inject('shell.overlay', () => ctx.slots.register(overlayOptions, MessengerDrawer))
```

- [ ] **步骤 5：运行 Client、GUI 与生命周期测试并提交**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests/client.client.spec.tsx packages/extensions/session-messenger/tests/loader-composition.client.spec.ts packages/extensions/session-messenger/tests/overlay-composition.spec.ts && pnpm run test:gui`

预期：PASS，不再有 footer overflow，也没有泄漏 listener 或请求。

提交：`git add packages/extensions/session-messenger && git commit -m "feat: add session communication drawer"`

### 任务 5：让插件市场全部分类保持稳定横向顺序

**文件：**
- 通过 pnpm patch 修改：`node_modules/dshmarket/src/client/MarketSection.tsx`
- 通过 pnpm patch 修改：`node_modules/dshmarket/src/client/Market.module.css`
- 修改：`patches/dshmarket@1.10.1.patch`
- 修改：`scripts/dshmarket-client-layout.spec.ts`
- 修改：`scripts/dshmarket-client-artifact.spec.ts`

- [ ] **步骤 1：编写失败的稳定顺序与滚动测试**

断言 `orderedCategories(categories, active, open)` 原样返回 registry 数组，`全部` 后渲染 registry 全部分类，选择不会改变 DOM 顺序或 `scrollLeft`，边缘按钮正确禁用，键盘焦点执行最小滚动，减少动画关闭平滑滚动，并且页面不产生横向溢出。

```text
expect(orderedCategories(['ui', 'tools', 'fun'], 'fun', false)).toEqual(['ui', 'tools', 'fun'])
expect(after.map(node => node.dataset.category)).toEqual(before.map(node => node.dataset.category))
expect(rail.scrollLeft).toBe(beforeScrollLeft)
```

- [ ] **步骤 2：运行市场测试并确认 RED**

运行：`pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts`

预期：FAIL，因为当前会把选中分类移动到第一位。

- [ ] **步骤 3：修补 dshmarket 并重新生成已提交 pnpm patch**

按 registry 顺序返回浅拷贝，移除由选择导致的排序，保留原生单行滚动区，增加左右边缘控制与渐隐，只在键盘焦点时调用 `scrollIntoView({ inline: 'nearest', block: 'nearest', behavior })`。筛选状态更新时保留 `scrollLeft`。使用 `pnpm patch-commit <patch-directory>` 重新生成补丁，使 source 与打包 client artifact 保持一致。

```text
export function orderedCategories(categories: readonly string[]): string[] {
  return [...categories]
}
```

- [ ] **步骤 4：运行市场与 stage guard 并提交**

运行：`pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts scripts/stage-desktop.spec.ts`

预期：PASS，同时支持当前二十类和未来任意数量。

提交：`git add patches/dshmarket@1.10.1.patch scripts && git commit -m "fix: keep market categories in stable order"`

### 任务 6：更新文档并运行回归门禁

**文件：**
- 修改：`packages/extensions/session-messenger/README.md`
- 修改：`packages/extensions/session-messenger/README.zh.md`
- 修改：`packages/extensions/session-messenger/README.i18n.yaml`
- 修改：`packages/client/ui-conversation/README.md`
- 修改：`packages/client/ui-conversation/README.zh.md`
- 修改：`packages/client/ui-conversation/README.i18n.yaml`
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 修改：`apps/desktop/README.i18n.yaml`
- 修改：`PROJECT_CONTEXT.md`

- [ ] **步骤 1：更新双语 ownership 与行为文档**

记录标题栏 utility、shell overlay 抽屉、结构化单记录 relay 卡片、Host-only 回复权限、稳定分类轨道、资源清理 ownership，以及不变的安装／更新／回滚行为。两边一致后记录每组翻译配对。

运行：`pnpm run verify-translation-pairing --write packages/extensions/session-messenger/README.md && pnpm run verify-translation-pairing --write packages/client/ui-conversation/README.md && pnpm run verify-translation-pairing --write apps/desktop/README.md`

预期：三条更新后的配对记录。

- [ ] **步骤 2：运行聚焦与全仓验证**

运行：`pnpm exec vitest run packages/extensions/session-messenger/tests packages/client/ui-conversation/tests/chat-branch-tails.client.spec.tsx scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts scripts/stage-desktop.spec.ts`

运行：`pnpm run typecheck && pnpm run lint && pnpm run doc-sync && git diff --check`

预期：全部命令以 0 退出。

- [ ] **步骤 3：提交文档**

提交：`git add packages/extensions/session-messenger/README.md packages/extensions/session-messenger/README.zh.md packages/extensions/session-messenger/README.i18n.yaml packages/client/ui-conversation/README.md packages/client/ui-conversation/README.zh.md packages/client/ui-conversation/README.i18n.yaml apps/desktop/README.md apps/desktop/README.zh.md apps/desktop/README.i18n.yaml PROJECT_CONTEXT.md && git commit -m "docs: describe desktop messaging refinement"`

### 任务 7：构建、安装、验证并发布 Desktop 0.1.6

**文件：**
- 修改：`apps/desktop/package.json`
- 修改：`apps/desktop/tests/manifest.spec.ts`
- 修改：`apps/desktop/tests/packaged-smoke.ts`
- 修改：`apps/desktop/tests/packaged-smoke.spec.ts`
- 修改：`apps/desktop/tests/windows-packaged-smoke.spec.ts`
- 修改：`.github/workflows/desktop-windows-release.yml`

- [ ] **步骤 1：为新界面增加打包验收**

使用两个临时普通会话验证：精确发送、一张可见已领取卡片、一次 receipt 绑定回复、一个 no-wake 待处理状态，以及归档／子 Agent 拒绝且 receipt 与事件保持不变。选择非首位分类前后捕获分类 DOM 顺序与轨道偏移，把抽屉调整到两个边界，重启后确认保存宽度。全部测试使用临时 `DSH_HOME` profile。

```text
expect(await page.locator('[data-session-relay-card]').textContent()).toContain(body)
expect(await categoryIds(page)).toEqual(registryCategoryIds)
expect(await categoryIds(page)).toEqual(beforeSelection)
```

- [ ] **步骤 2：升级版本并运行 Mac Intel 打包验收**

把 `apps/desktop/package.json` 设为 `0.1.6`，构建 stage app 与 x64 DMG，在不触碰 `~/.dsh` 的前提下覆盖安装 `/Applications/DeepSeek Harness.app`，验证新 UI 与随机端口清理，然后计算 `stat` 大小和 `shasum -a 256`。

运行：`pnpm run desktop:stage && pnpm --dir apps/desktop run pack:dmg`

预期：Intel x64 DMG 的已安装 app 通过 packaged smoke，并保留现有 profile。

- [ ] **步骤 3：从同一提交构建并验证 Windows x64**

推送分支并运行原生 `windows-2025` workflow。要求真实安装 Setup、快捷方式、自动启动、精确跨会话发送／卡片／回复、稳定分类顺序、宽度持久化、进程树清理、卸载，以及保留 `DSH_HOME` 和 Electron 数据。

运行：`gh workflow run desktop-windows-release.yml --ref codex/fix-slider-market-layout`

预期：workflow 以 `success` 结束，并从与 Mac DMG 相同的提交产出 Setup 与 LF checksum artifact。

- [ ] **步骤 4：发布并验证公开字节**

合并已审阅分支，创建 `desktop-v0.1.6`，上传 Mac DMG、Windows Setup 与 LF-only `.sha256`，等待全部 asset state 成为 `uploaded`，再从公开地址下载每个 asset，核对精确大小和 SHA-256。Release body 写明双平台与验收范围。

运行：`gh release view desktop-v0.1.6 --json assets,url && shasum -a 256 -c SHA256SUMS`

预期：每个公开下载与本地验收字节一致。

- [ ] **步骤 5：只关闭本任务拥有的资源消耗项**

卸载本任务挂载的 DMG，停止本任务拥有的 mock／build server 与重复候选 app 进程，移除临时 smoke profile，并确认没有本任务端口残留。不终止 Codex、远程访问软件、Hermes 或其他无关应用。

运行：`ps -axo pid=,ppid=,%cpu=,command= | sort -k3 -nr | head -30`

预期：不再有本任务 build 或 smoke 进程；无关高 CPU 进程只报告、不触碰。
