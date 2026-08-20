# macOS 插件市场、使用统计与启动体验优化实施计划

[English](2026-08-19-macos-market-usage-startup-polish.md) | 中文

> **供 agent worker 使用：** 必须使用子 skill：通过 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐项实施本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 交付已批准的 DeepSeek 配色 macOS 启动转场、使用统计骨架与进程内存刷新、B2 插件市场行，以及可信的 DeepSeek 费用／余额信息，不改变无关后端行为或 Windows 交付。

**架构：** Darwin 原生启动页负责一次性入场动画，现有运行时启动继续并发进行。内核自有 Web `AppRoot` 渲染一致的 Desktop 专用停留界面，在退出覆盖层下方挂载已完全停稳的应用，并通过 CSS 移除覆盖层，不增加第二个窗口或插件依赖。使用统计拥有一个进程内存快照缓存，锁定的 dshmarket 补丁只修改 Client 行展示并重新生成其构建产物。现有持久 token 投影提供明确标注为估算的会话费用，能力令牌保护的同源 Host 桥仅暴露 DeepSeek 官方接口返回且已验证的余额事实。

**技术栈：** Electron、TypeScript、React、CSS Modules、HTML/CSS、pnpm 依赖补丁、Vitest、Testing Library、Playwright 打包冒烟测试、双语 Markdown。

---

### 任务 1：增加 macOS 启动动画与 Web 直接揭示

**文件：**
- 新建：`apps/desktop/renderer/loading-macos.html`
- 新建：`packages/client/web/src/DesktopBootSurface.tsx`
- 新建：`packages/client/web/src/DesktopBootSurface.module.css`
- 修改：`apps/desktop/src/main.ts`
- 修改：`apps/desktop/tests/renderer-pages.spec.ts`
- 修改：`packages/client/web/src/{AppRoot.tsx}`
- 修改：`packages/client/web/src/{AppRoot.module.css}`
- 修改：`packages/client/web/src/{boot.tsx}`
- 测试：`packages/client/web/tests/{app-root.client.spec.tsx}`

- [ ] **步骤 1：编写失败的 macOS renderer 和内核转场测试**

要求 Darwin renderer 自包含、使用严格 CSP、带 DeepSeek 色彩标记、不包含远程 URL、不显示虚假 progressbar，并包含减少动态效果 CSS。为 `AppRoot` fixture 增加 `macDesktop`；完全停稳前断言 Desktop 停留界面存在且 `renderApp` 未运行，然后切换 `settled`，断言真实 UI 与退出阶段覆盖层同时渲染。`macDesktop` 为 false 时保留现有通用 Web 断言。

```tsx
expect(macosHtml).toContain('data-macos-startup')
expect(macosHtml).toContain('#4d6bfe')
expect(macosHtml).not.toContain('role="progressbar"')
expect(macosHtml).not.toMatch(/https?:\/\//u)

const bed = mount({ macDesktop: true })
expect(bed.container.querySelector('[data-desktop-boot-phase="hold"]')).not.toBeNull()
act(() => { bed.settled.set(true) })
expect(bed.getByTestId('real-ui')).toBeTruthy()
expect(bed.container.querySelector('[data-desktop-boot-phase="exit"]')).not.toBeNull()
```

- [ ] **步骤 2：运行聚焦测试并确认 RED**

运行：`pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts packages/client/web/tests/{app-root.client.spec.tsx}`

预期：FAIL，因为 Darwin 页面、Desktop 启动组件和直接揭示状态尚不存在。

- [ ] **步骤 3：实现自包含原生入场动画**

只在 `process.platform === 'darwin'` 时选择 `loading-macos.html`；其他平台继续使用 `loading.html`。通过内联 SVG／文字与本地 CSS 构建动画：接近黑色的背景、`#4d6bfe` 主蓝、冷青色高光、白色字阶、一次扫描，以及 900 毫秒组装后无限停留。装饰层不进入无障碍树，文字只描述真实本地运行时，减少动态效果模式立即显示停留画面。

```ts
import { fileURLToPath } from 'node:url'

const loadingPath = fileURLToPath(new URL(
  process.platform === 'darwin' ? '../renderer/loading-macos.html' : '../renderer/loading.html',
  import.meta.url,
))
```

- [ ] **步骤 4：实现内核停留与退出界面**

增加自包含 `DesktopBootSurface`，接受 `phase: 'hold' | 'exit'`、失败条目 ID 和范围明确的启动错误。`boot.tsx` 只在 `surface=desktop` 且浏览器 user agent 是 macOS 时识别 Mac Desktop，再把 `macDesktop` 传给 `AppRoot`。`AppRoot` 只在完全停稳后调用 `renderApp()`；在 Mac 上，它把覆盖层保留在真实 UI 上方并把阶段改为 `exit`，其 240–320 毫秒动画最终设置 `visibility: hidden` 和 `pointer-events: none`。通用 Web 和 Windows 保持现有转圈与一次切换行为。

```tsx
if (props.macDesktop) {
  return (
    <div className={css.desktopRoot}>
      {settled ? props.renderApp() : null}
      <DesktopBootSurface phase={settled ? 'exit' : 'hold'} failed={failed} error={error} />
    </div>
  )
}
```

- [ ] **步骤 5：运行启动测试并提交**

运行：`pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts apps/desktop/tests/main-lifecycle.spec.ts packages/client/web/tests/{app-root.client.spec.tsx} apps/web/tests/settings-chrome.e2e.ts`

预期：PASS；现有生命周期仍让加载页与冲突检查及运行时启动重叠。

提交：`git add apps/desktop packages/client/web && git commit -m "feat(desktop): add macOS startup reveal"`

### 任务 2：用结构骨架和缓存刷新替换使用统计加载文字

**文件：**
- 新建：`packages/client/ui-settings-usage/src/client/snapshot-cache.ts`
- 修改：`packages/client/ui-settings-usage/src/client/UsageInsightsSection.tsx`
- 修改：`packages/client/ui-settings-usage/src/client/UsageInsightsSection.module.css`
- 修改：`packages/client/ui-settings-usage/src/client/locales.ts`
- 测试：`packages/client/ui-settings-usage/tests/components.client.spec.tsx`
- 测试：`packages/client/ui-settings-usage/tests/styles.client.spec.ts`
- 测试：`packages/client/ui-settings-usage/tests/browser-usage.client.spec.tsx`

- [ ] **步骤 1：编写失败的骨架和刷新保留测试**

每项测试后重置内部缓存。断言第一次未结算请求显示一个忙碌结构骨架，不显示本地化加载句子或虚假数字。一次成功挂载后卸载，再用未结算请求重新挂载；断言最近快照立即渲染。让该刷新失败，断言快照继续可见，同时出现本地化陈旧状态与重试。让后续重试成功，断言新值替换旧值。

```tsx
expect(view.container.querySelector('[data-usage-skeleton]')?.getAttribute('aria-busy')).toBe('true')
expect(screen.queryByText(en.loading)).toBeNull()
expect(view.container.textContent).not.toContain('0')

first.unmount()
render(<UsageInsightsSection {...props(() => refresh.promise)} />)
expect(screen.getByText('96.5K')).toBeTruthy()
await act(async () => { refresh.reject(new Error('offline')) })
expect(screen.getByText('96.5K')).toBeTruthy()
expect(screen.getByRole('status').textContent).toBe(en.refreshFailed)
```

- [ ] **步骤 2：运行使用统计测试并确认 RED**

运行：`pnpm exec vitest run packages/client/ui-settings-usage/tests/components.client.spec.tsx packages/client/ui-settings-usage/tests/styles.client.spec.ts`

预期：FAIL，因为组件仍渲染 `loading` 文字，并在重试失败时丢弃可见快照。

- [ ] **步骤 3：增加进程内存快照所有者**

实现模块私有的 `UsageInsightsSnapshot | undefined` 以及内部读取、写入和测试重置函数。从该缓存初始化 `ViewState`。每次挂载仍调用一次 `load()`；成功读取会原子更新状态和缓存。失败读取使用函数式状态更新：存在 ready 快照时保留它并设置 `refresh: 'failed'`，不存在快照时进入现有首次加载错误状态。快照可见时，重试只改变刷新状态。

```ts
type UsageInsightsSnapshot = Readonly<Record<string, unknown>>

let lastSnapshot: UsageInsightsSnapshot | undefined

export function readUsageSnapshot(): UsageInsightsSnapshot | undefined { return lastSnapshot }
export function writeUsageSnapshot(snapshot: UsageInsightsSnapshot): void { lastSnapshot = snapshot }
export function resetUsageSnapshotForTest(): void { lastSnapshot = undefined }
```

- [ ] **步骤 4：实现最终几何一致的骨架和本地化陈旧状态**

在 `aria-busy="true"` 下渲染五个空白 KPI 单元、53×7 中性活动区，以及两组详情列占位。使用 Harness 骨架和业务主色 token，预留最终尺寸，只在允许动态效果时运行轻微扫光。增加英文和中文 `refreshFailed`。缓存仪表盘保持可交互，其上方显示范围明确的陈旧状态和重试。

```tsx
if (state.status === 'loading') return <UsageSkeleton />

{state.refresh === 'failed' ? (
  <div className={css.refreshFailure} role="status">
    <span>{t('refreshFailed')}</span>
    <button type="button" onClick={retry}>{t('retry')}</button>
  </div>
) : null}
```

- [ ] **步骤 5：运行使用统计组件与浏览器测试并提交**

运行：`pnpm exec vitest run packages/client/ui-settings-usage/tests`

预期：首次加载、缓存再访、刷新成功／失败、图表行为、窄布局和样式 token 全部 PASS。

提交：`git add packages/client/ui-settings-usage && git commit -m "feat(usage): add skeleton and cached refresh"`

### 任务 3：完成 B2 高密度插件市场行

**文件：**
- 通过 pnpm patch workspace 修改：`node_modules/dshmarket/src/client/MarketSection.tsx`
- 通过 pnpm patch workspace 修改：`node_modules/dshmarket/src/client/Market.module.css`
- 修改生成的 patch workspace：`node_modules/dshmarket/client/client.js`
- 修改生成的 patch workspace：`node_modules/dshmarket/client/client.js.map`
- 修改：`patches/dshmarket@1.10.1.patch`
- 修改：`scripts/dshmarket-client-layout.spec.ts`
- 修改：`scripts/dshmarket-client-artifact.spec.ts`

- [ ] **步骤 1：编写失败的 B2 source 和 artifact 测试**

要求 42 像素图片、名称旁的内联分类标签、单行描述、独立元数据行、DeepSeek 主色紧凑操作区、仅图标的 `IconEllipsisOutline16` 溢出控件及包含插件名的无障碍标签、窄宽度下标题／分类／操作／溢出菜单仍在第一行对齐，并要求 source、bundle 和 source map 具有相同语义标记。

```ts ignore-check
for (const artifact of [source, bundle, sourceMap]) {
  expect(artifact).toContain('data-dshmarket-layout="b2"')
  expect(artifact).toContain('data-dshmarket-plugin-category')
  expect(artifact).toContain('data-dshmarket-plugin-description')
}
expect(css).toMatch(/\.av\{width:42px;height:42px/)
expect(source).toContain('IconEllipsisOutline16')
```

- [ ] **步骤 2：运行插件市场测试并确认 RED**

运行：`pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts`

预期：FAIL，因为当前行使用 40 像素图片、两行描述、描述下方分类和文字 `More` 按钮。

- [ ] **步骤 3：编辑精确锁定的上游 source 并重新构建 Client artifact**

使用精确的上游 `dshmarket@1.10.1` checkout 或 pnpm patch 编辑目录。保留后端路由与操作语义。导入 `IconEllipsisOutline16`，把分类标签放在标题行，所有者／星标／日期留在元数据行，把描述限制为一行，让安装与溢出菜单在窄宽度下仍与标题行对齐，使用 42 像素圆角图片及确定性回退，并为仅图标的溢出触发器提供 `aria-label={`${t('moreActions')}: ${p.name}`}`。使用现有 `--dsw-alias-*` token 处理 DeepSeek 主色和深色模式。

```tsx
<div className={css.pluginTitleRow}>
  <div className={css.nm}>{p.name}</div>
  <span className={css.tag} data-dshmarket-plugin-category>{categoryLabel}</span>
</div>
<div className={css.owner}>{metadata}</div>
<div className={css.desc} data-dshmarket-plugin-description>{desc}</div>
```

- [ ] **步骤 4：重新生成 pnpm patch，不手工编辑压缩输出**

在精确上游 checkout 中运行包的 Client 构建，把 `src/client/MarketSection.tsx`、`src/client/Market.module.css`、`client/client.js` 和 `client/client.js.map` 复制到 pnpm 编辑目录，然后运行 `pnpm patch-commit <absolute-pnpm-edit-directory> --patches-dir patches`。使用锁文件重新安装，确认精确上游 tarball integrity 不变而 patch hash 更新。

运行：`pnpm install --frozen-lockfile`

预期：已安装 Desktop 依赖包含 B2 source 和匹配的生成 artifact。

- [ ] **步骤 5：运行插件市场、stage 和自保护测试并提交**

运行：`pnpm exec vitest run scripts/dshmarket-baseline.spec.ts scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts scripts/dshmarket-self-protection.spec.ts scripts/stage-desktop.spec.ts`

预期：PASS；source／bundle／map 一致，只 stage 一个插件市场，并继续拒绝自身更新、停用和删除。

提交：`git add patches/dshmarket@1.10.1.patch pnpm-lock.yaml scripts && git commit -m "feat(market): refine the B2 plugin row"`

### 任务 4：增加官方会话费用估算和精确账户余额

**文件：**
- 新建：`packages/client/ui-conversation/src/client/chat/usage-money.ts`
- 修改：`packages/client/ui-conversation/src/client/chat/StatsLine.tsx`
- 修改：`packages/client/ui-conversation/src/client/locales.ts`
- 测试：`packages/client/ui-conversation/tests/usage-money.client.spec.ts`
- 测试：`packages/client/ui-conversation/tests/chat-stats.client.spec.tsx`
- 新建：`packages/llm/llm-deepseek/src/balance.ts`
- 修改：`packages/llm/llm-deepseek/src/index.ts`
- 测试：`packages/llm/llm-deepseek/tests/balance.spec.ts`

- [ ] **步骤 1：编写失败的官方计价和混用模型测试**

断言当前官方人民币价格且不存在分时计价，缓存写入按缓存未命中计价，金额紧凑格式正确，未知模型或混用模型不提供估算。要求持久计费路由投影仅在整段日志中全部已计费 usage 记录一致时返回单一模型。

```ts ignore-check
expect(priceOfModel('deepseek-v4-flash')).toEqual({ cacheHit: 0.02, cacheMiss: 1, output: 2 })
expect(priceOfModel('deepseek-v4-pro')).toEqual({ cacheHit: 0.025, cacheMiss: 3, output: 6 })
expect(projectedBillingModel([flashUsage, proUsage])).toEqual({ kind: 'mixed' })
expect(sessionCostCny(usage, undefined)).toBeNull()
```

- [ ] **步骤 2：运行 Client 金额测试并确认 RED**

运行：`pnpm exec vitest run packages/client/ui-conversation/tests/usage-money.client.spec.ts packages/client/ui-conversation/tests/chat-stats.client.spec.tsx`

预期：FAIL，因为当前草稿仍使用过时的峰谷价格，并以最后一个模型给整个会话计价。

- [ ] **步骤 3：实现最小且可信的 Client 投影**

用一个不可变的官方价目表替换分时价目表，删除时钟参数和高峰辅助函数。把计费 provider／model 路由元数据折叠进持久的整段日志 `tokenBillingModel` 投影；只有全部已观察的计费记录一致时才返回一个路由。仅在存在非零计费用量且模型已知时追加本地化“本会话估算 ≈ ¥{cost}”。挂载时并每 60 秒通过可选桥读取一次余额；仅成功时显示返回的精确币种／总额，缺少桥或失败时保持安静。

```ts
const V4_PRICES = {
  'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 },
  'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3, output: 6 },
} as const
```

- [ ] **步骤 4：编写失败的 Host 余额桥测试**

覆盖人民币优先、美元回退、无效／不可用响应、GET／HEAD、缺失或错误能力令牌返回 403、修改请求返回 405、60 秒成功缓存、并发请求合并、10 秒超时、销毁、HTML 注入转义，以及缺少 `webServer` 时不挂载。测试只用占位凭据，绝不打印真实值。

```ts ignore-check
expect(parseDeepSeekBalance(providerBody, 100)).toMatchObject({ currency: 'CNY', totalBalance: 110 })
expect(await requestWithoutCapability()).toMatchObject({ status: 403 })
expect(providerFetch).toHaveBeenCalledTimes(1)
```

- [ ] **步骤 5：实现并验证能力令牌保护的余额桥**

仅在 `webServer` 存在时挂载一个精确同源路由。复用 `resolveApiKey`，随机能力令牌仅绑定当前页面代际并只放请求头；验证供应商字符串可转换为有限非负数，使用恒定时间比较，成功快照缓存 60 秒，合并并发读取，10 秒后中止，并通过 Cordis effect 注销路由和 HTML tap。

运行：`pnpm exec vitest run packages/llm/llm-deepseek/tests/balance.spec.ts packages/client/ui-conversation/tests/usage-money.client.spec.ts packages/client/ui-conversation/tests/chat-stats.client.spec.tsx`

预期：PASS；快照、错误和测试输出均不包含凭据。

### 任务 5：记录已交付决策与当前项目状态

**文件：**
- 新建：`.agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.md`
- 新建：`.agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.zh.md`
- 新建：`.agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.i18n.yaml`
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 修改：`apps/desktop/README.i18n.yaml`
- 修改：`packages/client/ui-settings-usage/README.md`
- 修改：`packages/client/ui-settings-usage/README.zh.md`
- 修改：`packages/client/ui-settings-usage/README.i18n.yaml`
- 修改：`PROJECT_CONTEXT.md`

- [ ] **步骤 1：编写已实现 Agent Note 对**

记录现在时决策：一个原生窗口、仅 Darwin 选择入场动画、内核自有直接揭示、如实的失败行为、进程内存使用统计快照和仅 Client 的 B2 展示。包含被拒绝的第二启动窗口、固定虚假进度、持久浏览器使用统计数据和修改插件市场后端行为，以及在不宣称冷启动加速前提下的小段视觉退出间隔成本。

- [ ] **步骤 2：更新所属双语 README 和项目上下文**

在 Desktop README 中记录 macOS 启动顺序，在使用统计 README 中记录首次加载／缓存刷新状态。用当前文件、范围、已完成测试和明确 Windows 排除项更新 `PROJECT_CONTEXT.md`。保留现有历史和无关进度项。

- [ ] **步骤 3：记录并验证每个双语对**

运行：`pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.md apps/desktop/README.md packages/client/ui-settings-usage/README.md`

运行：`pnpm run verify-agent-note-format && pnpm run verify-translation-pairing .agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.md apps/desktop/README.md packages/client/ui-settings-usage/README.md`

预期：三个配对结构一致且内容为当前状态。

- [ ] **步骤 4：提交文档**

提交：`git add .agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.md .agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.zh.md .agents/notes/implemented/feature/2026-08-19-macos-startup-and-settings-polish.i18n.yaml apps/desktop/README.md apps/desktop/README.zh.md apps/desktop/README.i18n.yaml packages/client/ui-settings-usage/README.md packages/client/ui-settings-usage/README.zh.md packages/client/ui-settings-usage/README.i18n.yaml PROJECT_CONTEXT.md && git commit -m "docs: record macOS UI polish"`

### 任务 6：运行接近发布形态的 macOS 验证

**文件：**
- 如验收覆盖需要则修改：`apps/desktop/tests/packaged-smoke.ts`
- 如验收覆盖需要则修改：`apps/desktop/tests/packaged-smoke.spec.ts`

- [ ] **步骤 1：一起运行全部聚焦 source 测试**

运行：`pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts apps/desktop/tests/main-lifecycle.spec.ts apps/desktop/tests/readiness.spec.ts packages/client/web/tests/{app-root.client.spec.tsx} packages/client/ui-settings-usage/tests scripts/dshmarket-baseline.spec.ts scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts scripts/dshmarket-self-protection.spec.ts scripts/stage-desktop.spec.ts packages/extensions/session-messenger/tests`

预期：PASS，跨会话消息、启动所有权、使用统计聚合展示或插件市场保护均无回归。

- [ ] **步骤 2：运行构建、类型、lint 和文档门禁**

运行：`pnpm run build && pnpm run build:desktop:main && pnpm run typecheck && pnpm run lint && pnpm run doc-sync && git diff --check`

预期：每条命令以 0 退出，没有生成文件或 vendor 文件意外变脏。

- [ ] **步骤 3：stage 并打包 Intel macOS 应用**

运行：`pnpm run desktop:pack`

预期：Electron Builder 生成未签名的 x64 macOS `.app` 目录，其 resources 包含 Darwin 启动页、当前 Web bundle、使用统计包和唯一的已修补 dshmarket 包。

- [ ] **步骤 4：运行隔离打包冒烟与视觉验收**

运行：`pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts`

预期：隔离 `DSH_HOME` 证明一个原生窗口、一棵受控 Harness 进程树、随机 loopback origin、启动直接进入应用、使用统计首次加载与再访行为、B2 插件市场几何、跨会话消息可用性、干净退出且无控制台错误。截取启动、使用统计和插件市场图片做人工几何检查，不点击破坏性控件。

- [ ] **步骤 5：检查最终 diff，并提交仅用于验收的测试改动**

运行：`git status --short && git diff --check && git log --oneline origin/main..HEAD`

预期：只有已记录的 macOS 启动、使用统计、插件市场、测试和文档文件存在差异；没有 Windows workflow、安装器、artifact、凭据、真实会话或应用安装发生变化。

任务 5 修改测试时提交：`git add apps/desktop/tests && git commit -m "test(desktop): cover macOS UI polish"`
