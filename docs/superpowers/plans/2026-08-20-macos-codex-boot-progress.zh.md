# macOS Codex 风格启动进度实施计划

[English](2026-08-20-macos-codex-boot-progress.md) | 中文

> **供智能体执行者使用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 子 skill，逐项实施本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 交付已批准的 Codex 风格 Intel Mac 启动界面：先立即显示 indeterminate 原生运行时进度条，再显示真实插件激活进度。

**架构：** 内核本地 Electron 页面保持自包含并使用 indeterminate 进度，因为运行时启动没有可信的分母。为不依赖框架的 Web `BootPage` 增加仅限 macOS Desktop 的线性变体，通过已有的已激活条目集合与完整 roster 推导进度；普通浏览器和非 Mac 界面保留圆形加载器。

**技术栈：** Electron 本地 renderer HTML/CSS、TypeScript DOM API、使用 jsdom 的 Vitest、pnpm、electron-builder、macOS `hdiutil`。

---

### 任务 1：用已批准的极简界面替换本地 Mac 启动画面

**文件：**
- 修改：`apps/desktop/tests/renderer-pages.spec.ts`
- 修改：`apps/desktop/renderer/loading-macos.html`

- [ ] **步骤 1：编写失败的 renderer 约定测试**

用以下要求替换 Mac 加载页面断言，同时保留现有外部 URL 拒绝检查：

```text
expect(html).toContain("default-src 'none'")
expect(html).toContain("img-src 'self'")
expect(html).toContain('data-macos-startup')
expect(html).toContain('data-macos-local-progress')
expect(html).toContain('../assets/icon-source.png')
expect(html).toContain('正在准备你的工作区')
expect(html).toContain('启动本地服务')
expect(html).toContain('aria-valuetext="正在启动本地服务"')
expect(html).toContain('height: 5px')
expect(html).toContain('prefers-reduced-motion: reduce')
expect(html).not.toContain('class="grid"')
expect(html).not.toContain('class="rail"')
expect(html).not.toMatch(/https?:\/\//u)
```

- [ ] **步骤 2：运行 renderer 测试并确认 RED**

运行：

```bash
pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts --config vitest.config.ts
```

预期：Mac 用例失败，因为旧页面缺少打包白鲸图片、易读状态、五像素轨道和极简结构。

- [ ] **步骤 3：实现极简本地阶段**

修改 CSP，只允许打包的本地图片和内联样式：

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'">
```

用以下语义结构替换 body：

```html
<main class="startup" data-macos-startup aria-label="DeepSeek Harness 正在启动">
  <section class="brand">
    <img class="icon" src="../assets/icon-source.png" alt="">
    <h1>DeepSeek Harness</h1>
    <p class="subtitle">正在准备你的工作区</p>
    <div
      class="progress"
      data-macos-local-progress
      role="progressbar"
      aria-label="正在启动"
      aria-valuetext="正在启动本地服务"
    ><i aria-hidden="true"></i></div>
    <div class="meta"><span>启动本地服务</span><span>准备中</span></div>
  </section>
</main>
```

采用已批准的极简几何与动画：

```css
body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  overflow: hidden;
  background: radial-gradient(circle at 50% 38%, rgb(77 107 254 / 10%), transparent 35%), #07090f;
}
.startup { display: grid; width: 100vw; min-height: 100vh; place-items: center; }
.brand { display: grid; width: min(300px, calc(100vw - 48px)); justify-items: center; }
.icon { width: 48px; height: 48px; border-radius: 12px; box-shadow: 0 8px 24px rgb(77 107 254 / 24%); }
h1 { margin: 17px 0 6px; font-size: 25px; font-weight: 600; letter-spacing: -.035em; }
.subtitle { margin: 0; color: #818ca5; font-size: 12px; }
.progress { position: relative; width: 100%; height: 5px; margin-top: 27px; overflow: hidden; border-radius: 999px; background: #171d2a; }
.progress i { position: absolute; inset: 0 auto 0 0; width: 34%; border-radius: inherit; background: linear-gradient(90deg, #4d6bfe, #6f8dff 68%, #79e8ff); box-shadow: 0 0 12px rgb(77 107 254 / 56%); animation: progress-sweep 1.35s cubic-bezier(.4, 0, .2, 1) infinite; }
.meta { display: flex; justify-content: space-between; width: 100%; margin-top: 10px; color: #8d98ae; font-family: "SF Mono", ui-monospace, monospace; font-size: 10px; }
.meta span:last-child { color: #d1d9ea; }
@keyframes progress-sweep { from { transform: translateX(-110%); } to { transform: translateX(400%); } }
@media (prefers-reduced-motion: reduce) { .progress i { animation: none; transform: translateX(0); } }
```

- [ ] **步骤 4：运行 renderer 测试并确认 GREEN**

运行步骤 2 的命令。预期：全部本地 renderer-page 用例通过。

- [ ] **步骤 5：提交本地阶段**

```bash
git add apps/desktop/tests/renderer-pages.spec.ts apps/desktop/renderer/loading-macos.html
git commit -m "feat(desktop): simplify macOS startup progress"
```

### 任务 2：在 Mac Desktop Web 启动界面显示真实插件进度

**文件：**
- 新建：`packages/client/web/src/desktop-surface.ts`
- 修改：`packages/client/web/src/DesktopBootSurface.tsx`
- 修改：`packages/client/web/src/boot-page.ts`
- 修改：`packages/client/web/src/boot-page.module.css`
- 修改：`packages/client/web/tests/boot-page.client.spec.ts`

- [ ] **步骤 1：编写失败的 Mac Desktop 进度测试**

添加一个贴近生产形态的 mount helper：

```text
function mountMacDesktop() {
  const el = document.createElement('div')
  document.body.append(el)
  return {
    el,
    page: new BootPage(el, { search: '?surface=desktop', userAgent: 'Macintosh' }),
  }
}
```

添加一个进度行为测试：

```text
it('shows truthful linear plugin progress on the Mac Desktop surface', () => {
  const { el, page } = mountMacDesktop()
  page.setTotal(4)
  const progress = el.querySelector<HTMLElement>('[data-dsh-boot-linear]')
  expect(el.firstElementChild?.getAttribute('data-dsh-boot-mac')).toBe('')
  expect(el.querySelector<HTMLImageElement>('[data-dsh-boot-icon]')?.src).toMatch(/\/favicon\.svg$/u)
  expect(progress?.getAttribute('aria-valuenow')).toBe('0')
  expect(el.textContent).toContain('正在加载组件 0 / 4')
  page.setState('a', 'active')
  page.setState('a', 'active')
  expect(progress?.getAttribute('aria-valuenow')).toBe('25')
  expect(el.textContent).toContain('25%')
  page.setState('b', 'active')
  page.setState('c', 'active')
  page.setState('d', 'active')
  expect(progress?.getAttribute('aria-valuenow')).toBe('100')
  expect(el.textContent).toContain('正在加载组件 4 / 4')
})
```

用一个 Mac instance 扩展失败测试，并断言现有失败报告会替换线性进度元素。

- [ ] **步骤 2：运行 Web 启动测试并确认 RED**

```bash
pnpm exec vitest run packages/client/web/tests/boot-page.client.spec.ts --config vitest.config.ts
```

预期：TypeScript／运行时失败，因为 `BootPage` 没有 environment 输入或线性 Mac 进度节点。

- [ ] **步骤 3：提取共享界面判定函数**

创建 `desktop-surface.ts`：

```text
/** Identify the native macOS Desktop renderer without affecting ordinary Web. */
export function isMacDesktopSurface(search: string, userAgent: string): boolean {
  return new URLSearchParams(search).get('surface') === 'desktop'
    && /Macintosh|Mac OS X/u.test(userAgent)
}
```

从 `DesktopBootSurface.tsx` 导入该函数，移除重复实现，并在原处重新导出以保留现有模块 API：

```text
import { isMacDesktopSurface } from './desktop-surface.ts'
export { isMacDesktopSurface } from './desktop-surface.ts'
```

- [ ] **步骤 4：实现不依赖框架的 Mac 进度节点**

为 `BootPage` 添加可选 environment：

```text
export interface BootPageEnvironment {
  search: string
  userAgent: string
}

const browserEnvironment = (): BootPageEnvironment => ({
  search: globalThis.location.search,
  userAgent: globalThis.navigator.userAgent,
})

constructor(container: HTMLElement, environment: BootPageEnvironment = browserEnvironment()) {
  this.macDesktop = isMacDesktopSurface(environment.search, environment.userAgent)
  // existing construction continues
}
```

Mac 分支构造并追加以下内容：

```text
this.root.dataset.dshBootMac = ''
this.icon = document.createElement('img')
this.icon.src = '/favicon.svg'
this.icon.alt = ''
this.icon.dataset.dshBootIcon = ''
this.wordmark.textContent = 'DeepSeek Harness'
this.hint.textContent = '正在准备你的工作区'
this.linear = div(css.macProgress)
this.linear.dataset.dshBootLinear = ''
this.linear.setAttribute('role', 'progressbar')
this.linear.setAttribute('aria-valuemin', '0')
this.linear.setAttribute('aria-valuemax', '100')
this.linearFill = div(css.macProgressFill)
this.linear.append(this.linearFill)
this.macStatus = div(css.macStatus)
this.macCount = div(undefined, '正在加载组件 0 / 0')
this.macPercent = div(undefined, '0%')
this.macStatus.append(this.macCount, this.macPercent)
this.card.replaceChildren(this.icon, this.wordmark, this.hint, this.linear, this.macStatus)
```

在现有 arc 计算后扩展 `updateProgress()`：

```text
const percent = Math.round(ratio * 100)
this.linear?.setAttribute('aria-valuenow', String(percent))
this.linearFill?.style.setProperty('--dsh-boot-progress', `${String(percent)}%`)
if (this.macCount !== undefined) this.macCount.textContent = `正在加载组件 ${String(this.active.size)} / ${String(this.total)}`
if (this.macPercent !== undefined) this.macPercent.textContent = `${String(percent)}%`
```

把 constructor 和 `render()` 都收敛到同一个 `renderLoading()` helper，以便失败后恢复正确的 generic 或 Mac 加载子节点。

- [ ] **步骤 5：添加仅限 Mac 的 CSS，不改变通用启动页面**

追加：

```css
.boot[data-dsh-boot-mac] {
  --dsh-boot-bg: #07090f;
  --dsh-boot-label-primary: #f5f7fc;
  --dsh-boot-label-secondary: #d1d9ea;
  --dsh-boot-label-tertiary: #818ca5;
  background: radial-gradient(circle at 50% 38%, rgb(77 107 254 / 10%), transparent 35%), var(--dsh-boot-bg);
}
.boot[data-dsh-boot-mac] .card { width: min(300px, calc(100% - 48px)); gap: 0; }
.macIcon { box-sizing: border-box; width: 48px; height: 48px; padding: 7px; border-radius: 12px; background: #4d6bfe; box-shadow: 0 8px 24px rgb(77 107 254 / 24%); }
.boot[data-dsh-boot-mac] .wordmark { margin-top: 17px; font-size: 25px; line-height: 30px; font-weight: 600; letter-spacing: -.035em; }
.boot[data-dsh-boot-mac] .hint { margin-top: 6px; }
.macProgress { position: relative; width: 100%; height: 5px; margin-top: 27px; overflow: hidden; border-radius: 999px; background: #171d2a; }
.macProgressFill { width: var(--dsh-boot-progress, 0%); height: 100%; border-radius: inherit; background: linear-gradient(90deg, #4d6bfe, #6f8dff 68%, #79e8ff); box-shadow: 0 0 12px rgb(77 107 254 / 56%); transition: width 240ms ease-out; }
.macStatus { display: flex; justify-content: space-between; width: 100%; margin-top: 10px; color: #8d98ae; font-family: var(--ds-font-family-code, "SF Mono", ui-monospace, monospace); font-size: 10px; }
.macStatus > :last-child { color: #d1d9ea; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .macProgressFill { transition: none; } }
```

- [ ] **步骤 6：运行聚焦测试并确认 GREEN**

```bash
pnpm exec vitest run \
  packages/client/web/tests/boot-page.client.spec.ts \
  apps/desktop/tests/renderer-pages.spec.ts \
  --config vitest.config.ts
```

预期：两个文件都通过，现有通用圆形加载器断言保持不变。

- [ ] **步骤 7：提交真实插件阶段**

```bash
git add packages/client/web/src/desktop-surface.ts packages/client/web/src/DesktopBootSurface.tsx packages/client/web/src/boot-page.ts packages/client/web/src/boot-page.module.css packages/client/web/tests/boot-page.client.spec.ts
git commit -m "feat(web): show real macOS boot progress"
```

### 任务 3：回归、视觉、打包与已安装应用验收

**文件：**
- 修改：`PROJECT_CONTEXT.md`
- 仅验证：任务 1 和 2 的全部实施文件

- [ ] **步骤 1：运行聚焦的新功能矩阵**

运行本次改动前使用的同一套 44 文件功能矩阵，并加入两个新启动测试套件。预期：至少 368 项旧测试和新增断言全部通过。

- [ ] **步骤 2：运行生产构建**

```bash
pnpm run build:lib:host
pnpm run build:lib:client
pnpm run build:web
pnpm run build:desktop:main
```

预期：四条命令都以 0 退出。

- [ ] **步骤 3：构建并运行 Intel Mac 包**

```bash
pnpm run desktop:dmg
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts --config vitest.config.ts
hdiutil verify "$(find apps/desktop/release -maxdepth 1 -name 'DeepSeek-Harness-*-mac-x64.dmg' -print | sort | tail -n 1)"
```

预期：x64 DMG 构建、packaged smoke 和磁盘映像验证全部通过。

- [ ] **步骤 4：在 736 与 360 像素宽度验证视觉界面**

在真实浏览器中分别以两个宽度渲染打包的本地启动页面。确认白鲸图标加载、进度条始终在窗口内、文本不裁切，并且 reduced-motion 仍保留轨道。启动打包应用，确认 Mac Web 启动阶段使用相同的居中构图和单调百分比。

- [ ] **步骤 5：安装且不改变用户数据**

选择下一个发布版本后（不同字节不得复用 0.2.1），使用现有已验证 macOS 更新 helper 替换 `/Applications/DeepSeek Harness.app`，保留可恢复备份，并确认：

```text
CFBundleShortVersionString = the chosen version newer than 0.2.1
Mach-O architecture = x86_64
child arguments include --no-open --host 127.0.0.1 --port 0
listener address is 127.0.0.1:<random>
~/.dsh remains present
```

- [ ] **步骤 6：更新项目证据并提交**

在 `PROJECT_CONTEXT.md` 中记录准确测试总数、DMG 大小、SHA-256、`hdiutil`、packaged smoke、已安装版本和视觉验收，然后提交：

```bash
git add PROJECT_CONTEXT.md
git commit -m "docs(desktop): record macOS boot progress acceptance"
```

- [ ] **步骤 7：发布前审查**

检查 `git diff origin/main...HEAD`，运行 secret-path／高信号扫描，并确认没有 Windows 源码或资源改动。仅在此前所有复选项通过后 push 分支并创建仅 Mac 的 pull request。只在合并且公开字节验证后发布新的 Mac release；绝不能用相同版本下的不同字节覆盖已经验证的 0.2.1 资产。
