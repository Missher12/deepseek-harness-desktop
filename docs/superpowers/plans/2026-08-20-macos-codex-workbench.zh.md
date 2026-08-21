# Intel Mac Codex 风格工作区实施计划

> **面向 agentic workers：** 必须使用子 skill：推荐使用 superpowers:subagent-driven-development，或使用 superpowers:executing-plans，逐项实施本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 交付一个可移除的 Intel Mac 工作区，通过 `Session log` 旁边的单一按钮打开，包含 Terminal、Browser、Files、Side Chat、Review、稳定的 DeepSeek Harness 品牌和有界的推理打字机动效。

**架构：** 先给 `ui-layout` 增加通用的可选工具栏，再把一个 Desktop 专用 Host／Client 扩展挂载进去。Files、Review、Terminal 和 Side Chat 继续由 Host 提供，并限制在工作区／会话作用域内；只有隔离的 Browser `WebContentsView` 穿过 Electron preload 边界。

**技术栈：** TypeScript、React 18、Cordis Host／Client 插件、Node 流与 PTY 子进程服务、Electron 43 `WebContentsView`、CSS Modules、Vitest／jsdom、Playwright 打包冒烟测试、electron-builder、macOS `hdiutil`。

[English](2026-08-20-macos-codex-workbench.md) | 中文

---

### 任务一：把产品名锁定为 DeepSeek Harness

**文件：**
- 修改：`packages/client/ui-renderer/src/client/DocumentTitle.tsx`
- 修改：`packages/client/ui-renderer/tests/document-title.client.spec.tsx`
- 修改：`packages/client/ui-sidebar/src/client/SidebarRoot.tsx`
- 修改：`packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx`
- 修改：`apps/web/vite.config.ts`

- [ ] **步骤一：编写失败的回退值测试**

```text
expect(document.title).toBe('DeepSeek Harness')
expect(view.getByText('DeepSeek Harness')).toBeTruthy()
expect(document.title).toBe('Session title — DeepSeek Harness')
```

- [ ] **步骤二：运行测试并确认 RED**

```bash
pnpm exec vitest run packages/client/ui-renderer/tests/document-title.client.spec.tsx packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx --config vitest.config.ts
```

预期：回退值断言实际收到 `DSH Local Build`。

- [ ] **步骤三：替换三个通用回退值**

```text
const DEFAULT_CLIENT_TITLE = 'DeepSeek Harness'
```

保留官方品牌覆盖和会话标题后缀。

- [ ] **步骤四：重新运行步骤二并确认 GREEN**

预期：两个文件都通过。

- [ ] **步骤五：提交**

```bash
git add apps/web/vite.config.ts packages/client/ui-renderer packages/client/ui-sidebar
git commit -m "fix(client): keep DeepSeek Harness branding"
```

### 任务二：增加通用工具栏

**文件：**
- 修改：`packages/client/ui-layout/src/client/index.ts`
- 修改：`packages/client/ui-layout/src/client/service.ts`
- 修改：`packages/client/ui-layout/src/client/stores.ts`
- 修改：`packages/client/ui-layout/src/client/columns.ts`
- 修改：`packages/client/ui-layout/src/client/AppFrame.tsx`
- 修改：`packages/client/ui-layout/src/client/AppFrame.module.css`
- 修改：`packages/client/ui-layout/tests/apply.client.spec.ts`
- 修改：`packages/client/ui-layout/tests/service.client.spec.ts`
- 修改：`packages/client/ui-layout/tests/layout-store.client.spec.ts`
- 修改：`packages/client/ui-layout/tests/app-frame.client.spec.tsx`

- [ ] **步骤一：编写失败的控制器和几何测试**

```text
expect(layout.snapshot()).toMatchObject({ utilityOpen: false, utilityMode: 'terminal', utilityWidth: 420 })
layout.openUtility('browser')
expect(layout.snapshot()).toMatchObject({ utilityOpen: true, utilityMode: 'browser', details: 0 })
layout.openDetails()
expect(layout.snapshot().utilityOpen).toBe(false)
```

同时要求存在 `layout.utility`、320–720 的宽度限制、右侧尺寸调整手柄，并且窄于断点时带有 `data-utility-drawer`。

- [ ] **步骤二：运行布局测试并确认 RED**

```bash
pnpm exec vitest run packages/client/ui-layout/tests --config vitest.config.ts
```

- [ ] **步骤三：实现封闭 API 和 store**

```text
export const UTILITY_MODES = ['terminal', 'browser', 'files', 'side-chat', 'review'] as const
export type UtilityMode = typeof UTILITY_MODES[number]
```

给 `ILayout` 增加 `openUtility`、`closeUtility`、`toggleUtility` 和 `setUtilityWidth`。打开工具栏时关闭详情栏，打开详情栏时关闭工具栏。宽屏布局变为 `sidebar | center | details | utility`；窄屏布局把工具栏渲染为右侧固定抽屉。关闭时保留宽度，Escape 恢复入口焦点，reduced motion 会移除过渡。

- [ ] **步骤四：重新运行步骤二并确认 GREEN**

- [ ] **步骤五：提交**

```bash
git add packages/client/ui-layout
git commit -m "feat(layout): add optional utility panel"
```

### 任务三：挂载 Desktop 工作区外壳

**文件：**
- 创建：`packages/extensions/desktop-workbench/package.json`
- 创建：`packages/extensions/desktop-workbench/tsconfig.json`
- 创建：`packages/extensions/desktop-workbench/tsconfig.host.json`
- 创建：`packages/extensions/desktop-workbench/tsconfig.client.json`
- 创建：`packages/extensions/desktop-workbench/tsdown.config.ts`
- 创建：`packages/extensions/desktop-workbench/cordis.patch.yml`
- 创建：`packages/extensions/desktop-workbench/src/index.ts`
- 创建：`packages/extensions/desktop-workbench/src/invariant.ts`
- 创建：`packages/extensions/desktop-workbench/src/client/index.tsx`
- 创建：`packages/extensions/desktop-workbench/src/client/WorkbenchPanel.tsx`
- 创建：`packages/extensions/desktop-workbench/src/client/WorkbenchPanel.module.css`
- 创建：`packages/extensions/desktop-workbench/src/client/HeaderButton.tsx`
- 创建：`packages/extensions/desktop-workbench/src/client/locales.ts`
- 创建：`packages/extensions/desktop-workbench/src/client/preferences.ts`
- 创建：`packages/extensions/desktop-workbench/tests/client.client.spec.tsx`
- 修改：`apps/desktop/package.json`
- 修改：`apps/desktop/desktop.cordis.patch.yml`

- [ ] **步骤一：编写失败的组合测试**

```text
expect(utilityIds).toEqual(['session-log-download', 'desktop-workbench'])
expect(button).toHaveAttribute('aria-expanded', 'false')
fireEvent.click(button)
expect(button).toHaveAttribute('aria-expanded', 'true')
expect(tabs.map(tab => tab.textContent)).toEqual(['终端', '浏览器', '文件', '侧边聊天', '审阅'])
```

- [ ] **步骤二：运行新测试并确认 RED**

```bash
pnpm exec vitest run packages/extensions/desktop-workbench/tests/client.client.spec.tsx --config vitest.config.ts
```

- [ ] **步骤三：实现拆分的 Host／Client 包**

遵循 `session-messenger` 的拆分构建约定。在 `session-log-download` 后注册只显示图标的 `desktop-workbench` 条目，并把 `WorkbenchPanel` 注册到 `layout.utility`。使用 `dsh.desktop-workbench.width.v1` 持久化受限制宽度，实现 tablist 方向键和 Escape，并采用连续的 Harness 表面，不使用卡片或永久动画。

```text
export function loadWidth(storage: Storage): number {
  const value = Number(storage.getItem('dsh.desktop-workbench.width.v1'))
  return Number.isFinite(value) ? Math.min(720, Math.max(320, value)) : 420
}
```

- [ ] **步骤四：只把包加入 Desktop 组合**

增加依赖，并在 `desktop.cordis.patch.yml` 中把 `@deepseek-ai/dsh-desktop-workbench` 插到 session-messenger 后面；不修改普通 Web profile。

- [ ] **步骤五：重新运行步骤二并确认 GREEN**

- [ ] **步骤六：提交**

```bash
git add apps/desktop/package.json apps/desktop/desktop.cordis.patch.yml packages/extensions/desktop-workbench
git commit -m "feat(desktop): add Codex-style workbench shell"
```

### 任务四：让 Side Chat 在两个会话中都可见

**文件：**
- 修改：`packages/extensions/session-messenger/src/types.ts`
- 修改：`packages/extensions/session-messenger/src/coordinator.ts`
- 修改：`packages/extensions/session-messenger/src/client/index.tsx`
- 修改：`packages/extensions/session-messenger/src/client/store.ts`
- 删除：`packages/extensions/session-messenger/src/client/MessengerDrawer.tsx`
- 删除：`packages/extensions/session-messenger/src/client/MessengerHeaderButton.tsx`
- 删除：`packages/extensions/session-messenger/src/client/MessengerUiController.ts`
- 创建：Desktop 工作台侧边聊天组件（后续已移除）
- 创建：对应的局部样式模块（后续已移除）
- 修改：`packages/client/ui-conversation/src/client/chat/RelayNodeView.tsx`
- 修改：`packages/client/ui-conversation/src/client/chat/RelayNodeView.module.css`
- 修改：`packages/extensions/session-messenger/tests/coordinator.client.spec.ts`
- 修改：`packages/extensions/session-messenger/tests/client.client.spec.tsx`
- 修改：`packages/extensions/desktop-workbench/tests/client.client.spec.tsx`

- [ ] **步骤一：编写失败的持久化可见性测试**

```text
expect(source.events.at(-1)).toMatchObject({
  type: 'session-messenger/outgoing',
  ignorable: true,
  data: { targetSessionId: target.id, body: 'hello', status: 'delivered' },
})
expect(target.events.some(event => event.type === 'user/message')).toBe(true)
```

同时证明回复关联、唤醒／不唤醒、准确目标 id，以及不会产生打开、归档、删除或导航副作用。

- [ ] **步骤二：运行 messenger／workbench 测试并确认 RED**

```bash
pnpm exec vitest run packages/extensions/session-messenger/tests packages/extensions/desktop-workbench/tests/client.client.spec.tsx --config vitest.config.ts
```

- [ ] **步骤三：增加一个只供 UI 使用的事件及 renderer**

```text
'session-messenger/outgoing': {
  deliveryId: DeliveryId
  targetSessionId: SessionId
  body: string
  status: 'delivered' | 'delivery-recovery-pending'
  replyToDeliveryId?: DeliveryId
}
```

只在协调器接受投递后以 `ignorable: true` 追加该事件。为源侧内联行注册 Client 会话定义；绝不把它加入模型历史。目标 relay 与关联回复继续作为普通可见 relay 节点。

- [ ] **步骤四：只恢复传输／store 并构建 Side Chat**

提供现有 messenger store／send／reply 接口，但不注册旧页头按钮、抽屉或 overlay。把当前 Session ID／复制、目标 Session ID、消息、唤醒、回复上下文、发送和只含元数据的近期状态渲染为一个连续面板。

- [ ] **步骤五：重新运行步骤二并确认 GREEN**

- [ ] **步骤六：提交**

```bash
git add packages/extensions/session-messenger packages/extensions/desktop-workbench packages/client/ui-conversation/src/client/chat
git commit -m "feat(messenger): show cross-session conversation flow"
```

### 任务五：增加有界 Files 与 Review 模式

**文件：**
- 创建：`packages/extensions/desktop-workbench/src/protocol.ts`
- 创建：`packages/extensions/desktop-workbench/src/http.ts`
- 创建：`packages/extensions/desktop-workbench/src/workspace-path.ts`
- 创建：`packages/extensions/desktop-workbench/src/files.ts`
- 创建：`packages/extensions/desktop-workbench/src/review.ts`
- 创建：`packages/extensions/desktop-workbench/src/client/transport.ts`
- 创建：`packages/extensions/desktop-workbench/src/client/FilesMode.tsx`
- 创建：`packages/extensions/desktop-workbench/src/client/ReviewMode.tsx`
- 创建：`packages/extensions/desktop-workbench/src/client/ReadOnlyModes.module.css`
- 创建：`packages/extensions/desktop-workbench/tests/workspace-path.host.spec.ts`
- 创建：`packages/extensions/desktop-workbench/tests/read-only.host.spec.ts`
- 创建：`packages/extensions/desktop-workbench/tests/client.client.spec.tsx`

- [ ] **步骤一：编写失败的包含关系和边界测试**

```text
await expect(resolveWorkspacePath(root, '../secret')).rejects.toThrow(/outside workspace/)
await expect(resolveWorkspacePath(root, 'linked-outside')).rejects.toThrow(/outside workspace/)
expect((await readFilePreview(sessionId, 'large.txt')).truncated).toBe(true)
expect((await gitDiff(sessionId, 'changed.ts')).text.length).toBeLessThanOrEqual(MAX_DIFF_BYTES)
```

- [ ] **步骤二：运行新测试并确认 RED**

```bash
pnpm exec vitest run packages/extensions/desktop-workbench/tests/workspace-path.host.spec.ts packages/extensions/desktop-workbench/tests/read-only.host.spec.ts packages/extensions/desktop-workbench/tests/client.client.spec.tsx --config vitest.config.ts
```

- [ ] **步骤三：实现受能力凭据约束的只读 Host 路由**

在 Host 解析实时会话，规范化 `session.header.cwd`，再规范化每个请求的子路径，并拒绝路径穿越／符号链接逃逸。目录上限为 200 个条目，文本预览上限为 256 KiB；二进制文件只返回元数据。只用参数数组调用 Git：

```text
['git', '-C', workspaceRoot, 'status', '--porcelain=v2', '--branch', '-z']
['git', '-C', repositoryRoot, 'diff', '--no-ext-diff', '--unified=3', '--', relativePath]
```

- [ ] **步骤四：实现 Client 模式**

Files 支持懒加载目录、筛选、预览、复制路径和只写入草稿的 `@path`。Review 支持状态、选中文件的有界 diff、复制、刷新和只写入草稿的 `在当前聊天中审阅`。两个模式都不修改文件或 Git。

- [ ] **步骤五：重新运行步骤二并确认 GREEN**

- [ ] **步骤六：提交**

```bash
git add packages/extensions/desktop-workbench
git commit -m "feat(workbench): add files and review modes"
```

### 任务六：增加由用户拥有的 Terminal

**文件：**
- 创建：`packages/extensions/desktop-workbench/src/terminal.ts`
- 创建：`packages/extensions/desktop-workbench/src/client/TerminalMode.tsx`
- 创建：`packages/extensions/desktop-workbench/src/client/TerminalMode.module.css`
- 创建：`packages/extensions/desktop-workbench/tests/terminal.host.spec.ts`
- 修改：`packages/extensions/desktop-workbench/tests/client.client.spec.tsx`
- 修改：`packages/extensions/desktop-workbench/src/http.ts`
- 修改：`packages/extensions/desktop-workbench/src/client/transport.ts`

- [ ] **步骤一：编写失败的所有权和清理测试**

```text
const opened = await terminals.open(clientA, sessionA.id, { rows: 24, cols: 80 })
await expect(terminals.write(clientB, opened.id, 'pwd\n')).rejects.toThrow(/foreign terminal/)
await terminals.disconnect(clientA)
expect(fakeHandle.terminate).toHaveBeenCalledOnce()
expect(opened.cwd).toBe(sessionA.header.cwd)
```

同时锁定四终端上限、16 KiB 输入上限、1 MiB 保留输出上限、尺寸范围、信号词汇和 Host dispose 清理。

- [ ] **步骤二：运行 Terminal 测试并确认 RED**

```bash
pnpm exec vitest run packages/extensions/desktop-workbench/tests/terminal.host.spec.ts packages/extensions/desktop-workbench/tests/client.client.spec.tsx --config vitest.config.ts
```

- [ ] **步骤三：实现独立的用户终端注册表**

从 `ctx.sessions` 解析 cwd，在 macOS 优先选择 `/bin/zsh`，并以 `/bin/bash` 作为回退，然后直接调用 `ctx.subprocess.spawnTerminal`：

```text
const handle = await ctx.subprocess.spawnTerminal({
  argv: [shell, '-l'], cwd, rows, cols, graceMs: 1_500,
  env: { TERM: 'xterm-256color', DSH_UI_TERMINAL: '1' },
})
```

使用生成的客户端连接 id 约束所有权，发出有界输出事件，并在关闭、断开连接、移除会话、插件 dispose 和 Host 关闭时等待 `terminate()`。绝不把这些终端注册到 `ctx.terminals`。

- [ ] **步骤四：增加路由和 Client 终端界面**

暴露受能力凭据约束的 open／list／input／resize／signal／close 和一条 SSE 流。渲染最多四个终端标签、ANSI 安全的有界输出、准确 UTF-8 输入、复制、清空视图、重启、关闭和 ResizeObserver 尺寸。非活动模式暂停 DOM 批处理，但不停止 Host 进程。

- [ ] **步骤五：重新运行步骤二并确认 GREEN**

- [ ] **步骤六：提交**

```bash
git add packages/extensions/desktop-workbench
git commit -m "feat(workbench): add user terminal mode"
```

### 任务七：增加隔离的 Electron Browser

**文件：**
- 创建：`apps/desktop/src/browser/controller.ts`
- 创建：`apps/desktop/src/browser/contracts.ts`
- 创建：`apps/desktop/tests/browser-contracts.spec.ts`
- 修改：`apps/desktop/src/preload-api.ts`
- 修改：`apps/desktop/src/preload.ts`
- 修改：`apps/desktop/src/main.ts`
- 修改：`apps/desktop/tests/preload-api.spec.ts`
- 创建：`packages/extensions/desktop-workbench/src/client/BrowserMode.tsx`
- 创建：`packages/extensions/desktop-workbench/src/client/BrowserMode.module.css`
- 修改：`packages/extensions/desktop-workbench/tests/client.client.spec.tsx`

- [ ] **步骤一：编写失败的校验和生命周期测试**

```text
expect(isWorkbenchBrowserRequest({ kind: 'navigate', value: 'https://example.com' })).toBe(true)
expect(isWorkbenchBrowserRequest({ kind: 'navigate', value: 'file:///tmp/a' })).toBe(false)
expect(isTrustedHarnessMainFrame(mainContents, mainFrame, activeOrigin)).toBe(true)
expect(isTrustedHarnessMainFrame(mainContents, childFrame, activeOrigin)).toBe(false)
```

同时要求有限且被裁剪的边界，拒绝弹窗／下载／权限请求，切换前隐藏，崩溃状态和窗口关闭时销毁。

- [ ] **步骤二：运行 Browser 测试并确认 RED**

```bash
pnpm exec vitest run apps/desktop/tests/browser-contracts.spec.ts packages/extensions/desktop-workbench/tests/client.client.spec.tsx --config vitest.config.ts
```

- [ ] **步骤三：实现控制器与 preload 桥接**

首次使用时才创建 `WebContentsView`，启用 sandbox、context isolation、web security、禁用 Node，并使用 `persist:dsh-workbench-browser`。只接受显示／隐藏、HTTP(S) 导航／搜索、后退、前进、重新加载、停止和有界状态。每次调用都校验准确 main `webContents`、main frame 以及活动随机回环 origin。只暴露：

```text
showWorkbenchBrowser(bounds: DesktopBrowserBounds): Promise<DesktopBrowserSnapshot>
hideWorkbenchBrowser(): Promise<void>
controlWorkbenchBrowser(request: DesktopBrowserRequest): Promise<DesktopBrowserSnapshot>
onWorkbenchBrowserState(listener: (snapshot: DesktopBrowserSnapshot) => void): () => void
```

- [ ] **步骤四：实现 Browser 模式**

渲染地址／搜索、后退、前进、重新加载／停止、外部打开和原生视图占位区。活动时通过 ResizeObserver 上报 `getBoundingClientRect()`，每次卸载或切换模式前先隐藏原生像素。

- [ ] **步骤五：重新运行步骤二并确认 GREEN**

- [ ] **步骤六：提交**

```bash
git add apps/desktop/src apps/desktop/tests packages/extensions/desktop-workbench
git commit -m "feat(desktop): add isolated workbench browser"
```

### 任务八：用打字机动效替换推理扫光

**文件：**
- 修改：`packages/client/ui-conversation/src/client/chat/ReasoningRow.tsx`
- 修改：`packages/client/ui-conversation/src/client/chat/ReasoningRow.module.css`
- 修改：`packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx`

- [ ] **步骤一：编写失败的节奏和清理测试**

```text
expect(summary.textContent).not.toBe('Newest reasoning tokens keep arriving')
flushAnimationFrames(4)
expect(summary.textContent?.length).toBeGreaterThan(0)
rerenderSettled()
expect(summary.textContent).toBe('Inspect the session')
expect(animationFrames.size).toBe(0)
```

覆盖展开文本、文档隐藏、卸载和 reduced motion。

- [ ] **步骤二：运行聚焦测试并确认 RED**

```bash
pnpm exec vitest run packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx --config vitest.config.ts
```

- [ ] **步骤三：实现有界字素展示**

每帧至少显示一个字素，积压超过 48 个字素时加速，延迟上限为 120 ms；完成、展开、文档隐藏或 reduced motion 时立即刷新。取消每个已安排的帧。把扫光伪元素替换为仅在正在展示时出现的克制光标。

```text
const summary = running && !expanded ? displayed : running ? latestLine(text) : firstLine(text)
```

- [ ] **步骤四：重新运行步骤二并确认 GREEN**

- [ ] **步骤五：提交**

```bash
git add packages/client/ui-conversation/src/client/chat packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx
git commit -m "feat(conversation): smooth reasoning typewriter"
```

### 任务九：审计、文档、构建并安装 0.3.0

**文件：**
- 创建：`.agents/notes/implemented/feature/2026-08-20-macos-codex-workbench.md`
- 创建：`.agents/notes/implemented/feature/2026-08-20-macos-codex-workbench.zh.md`
- 创建：`.agents/notes/implemented/feature/2026-08-20-macos-codex-workbench.i18n.yaml`
- 创建：`packages/extensions/desktop-workbench/README.md`
- 创建：`packages/extensions/desktop-workbench/README.zh.md`
- 创建：`packages/extensions/desktop-workbench/README.i18n.yaml`
- 修改：`packages/extensions/session-messenger/README.md`
- 修改：`packages/extensions/session-messenger/README.zh.md`
- 修改：`packages/extensions/session-messenger/README.i18n.yaml`
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 修改：`apps/desktop/README.i18n.yaml`
- 修改：`apps/desktop/tests/packaged-smoke.ts`
- 修改：`apps/desktop/package.json`
- 修改：`PROJECT_CONTEXT.md`

- [ ] **步骤一：扩展打包验收**

```text
await expect(page.getByText('DeepSeek Harness', { exact: true })).toBeVisible()
await expect(sessionLog.locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-desktop-workbench-trigger', '')
await expect(page.locator('[data-workbench-mode]')).toHaveCount(5)
expect(await processTreeGone(harnessPid)).toBe(true)
```

增加宽度持久化、窄屏布局、Side Chat 可见流、Files／Review 不修改数据、Terminal 打开／写入／关闭、Browser 拒绝／清理、推理光标／无扫光、随机监听端口、干净退出和 `DSH_HOME` 不变的验收。

- [ ] **步骤二：运行聚焦回归**

```bash
pnpm exec vitest run packages/client/ui-renderer/tests/document-title.client.spec.tsx packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx packages/client/ui-layout/tests packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx packages/extensions/session-messenger/tests packages/extensions/desktop-workbench/tests apps/desktop/tests/preload-api.spec.ts apps/desktop/tests/navigation.spec.ts apps/desktop/tests/browser-contracts.spec.ts --config vitest.config.ts
```

- [ ] **步骤三：运行生产门禁**

```bash
pnpm run typecheck
pnpm run build:official
pnpm run build:desktop:main
pnpm run doc-sync
```

修复由本功能造成的失败。单独记录与本功能无关的既有全库失败。

- [ ] **步骤四：把 Desktop 升级到 0.3.0 并构建 Intel 产物**

```bash
pnpm run desktop:dmg
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts --config vitest.config.ts
hdiutil verify apps/desktop/release/DeepSeek-Harness-0.3.0-mac-x64.dmg
```

- [ ] **步骤五：通过已验证的 helper 安装并审计运行中的应用**

```text
CFBundleShortVersionString = 0.3.0
Mach-O architecture = x86_64
listener = 127.0.0.1:<random>
sidebar brand = DeepSeek Harness
renderer console errors = 0
~/.dsh preserved = true
```

实际操作全部模式、跨会话回复、Browser 隔离、终端清理、不修改数据、推理动效、更新器、原生退出，以及资源关闭后的空闲 CPU。

- [ ] **步骤六：记录证据并提交**

记录准确测试总数、审计发现、产物路径、大小、SHA-256、`hdiutil`、安装版本、监听地址、架构、控制台证据和数据保留情况。

```bash
git add .agents/notes/implemented/feature packages/extensions/desktop-workbench packages/extensions/session-messenger apps/desktop PROJECT_CONTEXT.md
git commit -m "docs(desktop): record workbench acceptance"
```

- [ ] **步骤七：只做最终分支审阅，不发布**

```bash
git diff --check
git status --short --branch
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

预期：worktree 干净，没有 Windows 改动，没有疑似 secret 的值，也没有 GitHub push、PR、tag 或 Release 修改。
