# 跨平台桌面加载实现计划

[English](2026-08-23-cross-platform-desktop-loading.md) | 中文

> **面向 agent 工作者：** 必需的子 skill：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实现本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 让 Windows 与 macOS 使用相同的 DeepSeek Harness 启动和真实插件进度展示，同时让普通浏览器用户继续看到通用 Web 启动页。

**架构：** 用一个自包含的 Desktop 加载页替换按平台选择的两份本地 HTML。泛化 Web 内核的 `surface=desktop` 检测器，使两个原生平台都能显示图标、浅色主题、线性进度与真实的当前项/总数；平台差异只保留在 Electron 窗口外框中。

**技术栈：** Electron、无框架 HTML/CSS、TypeScript DOM、Vitest/jsdom。

---

### 任务 1：定义统一的原生 Desktop 启动文档

**文件：**
- 修改：`apps/desktop/tests/renderer-pages.spec.ts`
- 修改：`apps/desktop/renderer/loading.html`
- 删除：`apps/desktop/renderer/loading-macos.html`
- 修改：`apps/desktop/src/main.ts`

- [x] **步骤 1：编写失败的共享页面测试**

将分离的通用/macOS 断言替换为一项读取 `loading.html` 并要求以下内容的测试：

```ts ignore-check
expect(html).toContain('data-desktop-startup')
expect(html).toContain('data-desktop-local-progress')
expect(html).toContain('../assets/icon-source.png')
expect(html).toContain('正在准备你的工作区')
expect(html).toContain('启动本地服务')
expect(html).toContain('height: 5px')
expect(html).toContain('#4d6bfe')
expect(html).toContain('color-scheme: light')
expect(html).not.toMatch(/https?:\/\//u)
```

同时读取 `src/main.ts`，并要求其中不包含 `loading-macos.html`，也不包含围绕本地加载文档的 `process.platform` 分支。

- [x] **步骤 2：运行渲染器测试并验证 RED**

运行：`pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts`

预期：失败，因为 Windows 仍然收到旧的通用文档，且 `main.ts` 仍会选择仅限 macOS 的文件。

- [x] **步骤 3：让精修后的文档与平台无关**

将 `loading-macos.html` 的完整内容移入 `loading.html`，把 `data-macos-startup` 重命名为 `data-desktop-startup`，把 `data-macos-local-progress` 重命名为 `data-desktop-local-progress`，并删除 `loading-macos.html`。

将主进程路径设置为一个常量：

```ts ignore-check
const loadingPath = fileURLToPath(new URL('../renderer/loading.html', import.meta.url))
```

- [x] **步骤 4：运行渲染器测试并验证 GREEN**

运行：`pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts apps/desktop/tests/main-lifecycle.spec.ts`

预期：两个文件都通过；启动并发和显示时序保持不变。

### 任务 2：为两个原生平台提供真实的插件进度

**文件：**
- 修改：`packages/client/web/src/desktop-surface.ts`
- 修改：`packages/client/web/src/boot-page.ts`
- 修改：`packages/client/web/src/boot-page.module.css`
- 修改：`packages/client/web/src/DesktopBootSurface.tsx`
- 修改：`packages/client/web/tests/boot-page.client.spec.ts`
- 修改：`packages/client/web/tests/DesktopBootSurface.client.spec.tsx`
- 修改：`apps/desktop/tests/renderer-pages.spec.ts`

- [x] **步骤 1：编写失败的 Windows Desktop 启动断言**

定义预期的检测器行为：

```ts ignore-check
expect(isDesktopSurface('?surface=desktop')).toBe(true)
expect(isDesktopSurface('')).toBe(false)
```

在类似 Windows 的环境中使用 `{ search: '?surface=desktop' }` 挂载 `BootPage`，并要求存在 `data-dsh-boot-desktop`、`data-dsh-boot-linear`、Desktop 图标，以及四项中的一项激活后得到真实的 `25%`。保留一项独立的普通 Web 测试，继续要求 `HARNESS` 与圆形加载指示器。

- [x] **步骤 2：运行 Web 启动测试并验证 RED**

运行：`pnpm exec vitest run packages/client/web/tests/boot-page.client.spec.ts packages/client/web/tests/DesktopBootSurface.client.spec.tsx`

预期：失败，因为当前检测器拒绝 Windows 用户代理，并且只在 macOS 上发出 `data-dsh-boot-mac`。

- [x] **步骤 3：泛化显式 Desktop 标记**

实现封闭式标记检查：

```ts
export function isDesktopSurface(search: string): boolean {
  return new URLSearchParams(search).get('surface') === 'desktop'
}
```

在 `BootPage` 中，把 `macDesktop` 替换为 `desktop`，使用 `data-dsh-boot-desktop`，并保留现有图标、浅色背景、线性进度、当前项/总数、百分比、失败替换及普通 Web 回退。将 CSS 选择器从 `[data-dsh-boot-mac]` 重命名为 `[data-dsh-boot-desktop]`；内部类名可以保留，以减少无关改动。

- [x] **步骤 4：运行聚焦的 Web/Desktop 测试并验证 GREEN**

运行：`pnpm exec vitest run packages/client/web/tests/boot-page.client.spec.ts packages/client/web/tests/DesktopBootSurface.client.spec.tsx apps/desktop/tests/renderer-pages.spec.ts apps/desktop/tests/window-options.spec.ts`

预期：原生 Windows 和 macOS 共享 Desktop 界面，普通 Web 保持通用样式，原生窗口外框行为仍然因平台而异。

- [x] **步骤 5：提交可独立测试的加载改动**

```bash
git add apps/desktop/renderer apps/desktop/src/main.ts apps/desktop/tests/renderer-pages.spec.ts packages/client/web/src packages/client/web/tests
git commit -m "fix(desktop): unify native loading surfaces"
```

### 任务 3：跨界面回归验证

**文件：**
- 修改：`PROJECT_CONTEXT.md`

- [x] **步骤 1：运行完整的聚焦回归集**

运行：

```bash
pnpm exec vitest run \
  packages/session/usage-insights/tests/aggregate.spec.ts \
  packages/client/ui-settings-usage/tests/charts.client.spec.ts \
  packages/client/ui-settings-usage/tests/components.client.spec.tsx \
  packages/client/ui-settings-usage/tests/styles.client.spec.ts \
  packages/client/web/tests/boot-page.client.spec.ts \
  packages/client/web/tests/DesktopBootSurface.client.spec.tsx \
  apps/desktop/tests/renderer-pages.spec.ts \
  apps/desktop/tests/main-lifecycle.spec.ts \
  apps/desktop/tests/window-options.spec.ts
```

预期：所有聚焦测试均通过。

- [x] **步骤 2：构建生产 Host、Client、Web 与 Desktop 主进程**

运行：`pnpm run build:lib && pnpm run build:web && pnpm run build:desktop:main`

预期：以状态码 0 退出，且没有缺失渲染器资源或 TypeScript 错误。

- [x] **步骤 3：记录当前实现边界**

更新 `PROJECT_CONTEXT.md`，记录共享 Desktop 加载决策、Usage 聚合强度行为、已测试平台，以及在发布 Windows 产物前仍需完成原生 Windows 安装包验收这一事实。

- [x] **步骤 4：提交文档与验证边界**

```bash
git add PROJECT_CONTEXT.md docs/superpowers/plans/2026-08-23-*.md
git commit -m "docs: record shared desktop loading plan"
```
