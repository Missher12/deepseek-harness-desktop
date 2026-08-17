# 自适应推理强度插件实施计划

[English](2026-08-17-adaptive-reasoning-effort-plugin.md) | 中文

> **供 agent 工作者使用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实施本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 交付一个可独立移除、符合 Harness 风格的模型选择器，保留 HanaAyane 的 Canvas 推理强度特效，弹层默认向下，并把可选人物偏好保存在当前 profile。

**架构：** 在 `packages/extensions/reasoning-effort` 增加一个双端 workspace 包：Host 端拥有单一布尔偏好和精确 loopback 路由，Client 端以优先级 `-100` 占用 `conversation.input.model`，并且只从 `ModelDirectory` 读取 model 与 effort。Desktop 通过现有 patch 和 staging 流水线挂载该包；停用该配置项会释放 slot，让优先级为 `0` 的原生选择器恢复。

**技术栈：** TypeScript、React 18、Cordis、Harness Client slots 与 ModelDirectory、Canvas 2D、`react-dom` portal、Vitest、Testing Library、Electron staging。

---

### 任务 1：导入带完整声明的插件包

**文件：**
- 新建：`packages/extensions/reasoning-effort/package.json`
- 新建：`packages/extensions/reasoning-effort/tsconfig.json`
- 新建：`packages/extensions/reasoning-effort/tsdown.config.ts`
- 新建：`packages/extensions/reasoning-effort/cordis.patch.yml`
- 新建：`packages/extensions/reasoning-effort/src/invariant.ts`
- 新建：`packages/extensions/reasoning-effort/LICENSE`
- 新建：`packages/extensions/reasoning-effort/THIRD_PARTY_NOTICES.md`
- 复制：`packages/extensions/reasoning-effort/assets/chibi-runner-strip.png`
- 修改：`tsconfig.client.json`

- [ ] **步骤 1：添加失败的包结构测试**

创建 `packages/extensions/reasoning-effort/tests/package-shape.spec.ts`，断言包版本为 `0.1.0-rc.5`、导出 `./client`、`dsh.client.platform` 为 `web`、许可证包含 `Copyright (c) 2026 HanaAyane`，并且 sprite hash 与锁定的上游文件相同。

```ts
import { expect } from 'vitest'

declare const manifest: { dsh: { client: { platform: string } } }
declare const license: string
declare const spriteSha256: string
declare const PINNED_SPRITE_SHA256: string

expect(manifest.dsh.client.platform).toBe('web')
expect(license).toContain('Copyright (c) 2026 HanaAyane')
expect(spriteSha256).toBe(PINNED_SPRITE_SHA256)
```

- [ ] **步骤 2：运行聚焦测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/reasoning-effort/tests/package-shape.spec.ts`

预期：因为包文件不存在而 FAIL。

- [ ] **步骤 3：只导入锁定的上游源码并声明 rc.5 peer**

使用上游提交 `f94622b46078ac8c064f91bdc10ab27e8cf32270`。保留 MIT 全文、作者声明、Canvas 绘制代码和 sprite。包名设为 `@deepseek-ai/dsh-reasoning-effort`，版本为 `0.1.0-rc.5`，声明 `react`、`react-dom` peer 与精确 rc.5 Harness workspace peer。声明 `dsh.bundle.patch: ./cordis.patch.yml`，让打包后的插件仍可独立安装。配置 `clientBundle()`，让普通双端构建生成 `lib/index.js`、`lib/invariant.js` 和 `lib/client.js`。

```ts ignore-check
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-reasoning-effort',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { lib: { copy: [{ from: 'assets/*', to: 'lib/assets' }] } },
)
```

- [ ] **步骤 4：运行包结构与约束检查**

运行：`pnpm exec vitest run packages/extensions/reasoning-effort/tests/package-shape.spec.ts && pnpm run constraints`

预期：两条命令都 PASS。

- [ ] **步骤 5：提交包骨架**

```bash
git add packages/extensions/reasoning-effort tsconfig.client.json
git commit -m "feat: scaffold attributed reasoning effort plugin"
```

### 任务 2：实现确定性的向下优先 portal 定位

**文件：**
- 新建：`packages/extensions/reasoning-effort/src/client/placement.ts`
- 新建：`packages/extensions/reasoning-effort/src/client/use-popup-placement.ts`
- 新建：`packages/extensions/reasoning-effort/tests/placement.client.spec.ts`

- [ ] **步骤 1：编写失败的定位矩阵**

覆盖向下可容纳、翻到上方、两侧都受限、横向钳制、非零 `visualViewport.offsetTop/offsetLeft`，以及拖动期间方向稳定。

```ts
import { expect } from 'vitest'

interface PopupPlacementResult {
  side: 'below' | 'above'
  top: number
}

declare const anchor: { bottom: number }
declare const nearBottom: { bottom: number }
declare const popup: unknown
declare const viewport: unknown
declare function placePopup(input: {
  anchor: { bottom: number }
  popup: unknown
  viewport: unknown
  preferred: 'below'
}): PopupPlacementResult

expect(placePopup({ anchor, popup, viewport, preferred: 'below' })).toMatchObject({
  side: 'below', top: anchor.bottom + 8,
})
expect(placePopup({ anchor: nearBottom, popup, viewport, preferred: 'below' }).side).toBe('above')
```

- [ ] **步骤 2：运行测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/reasoning-effort/tests/placement.client.spec.ts`

预期：因为缺少 `placePopup` 而 FAIL。

- [ ] **步骤 3：实现纯定位约定**

返回 fixed `top`、`left`、`maxHeight` 与 `side`。使用 8 像素间距、8 像素 viewport 边距和实际矩形；当前侧仍保有至少 120 像素时用它作为滞回方向。

```ts ignore-check
export interface PopupPlacement {
  side: 'below' | 'above'
  top: number
  left: number
  maxHeight: number
}

export function placePopup(input: PlacementInput): PopupPlacement
```

- [ ] **步骤 4：实现生命周期安全的测量**

`usePopupPlacement` 必须订阅 `window` resize、捕获阶段 scroll、`visualViewport` resize 与 scroll，并用 `ResizeObserver` 观察 anchor 和 popup。effect disposer 要移除每个监听器、observer 与已安排的 animation frame。

- [ ] **步骤 5：运行定位测试**

运行：`pnpm exec vitest run packages/extensions/reasoning-effort/tests/placement.client.spec.ts`

预期：PASS。

- [ ] **步骤 6：提交定位逻辑**

```bash
git add packages/extensions/reasoning-effort/src/client/placement.ts packages/extensions/reasoning-effort/src/client/use-popup-placement.ts packages/extensions/reasoning-effort/tests/placement.client.spec.ts
git commit -m "feat: add down-first effort popup placement"
```

### 任务 3：增加 profile 持久化的人物偏好

**文件：**
- 新建：`packages/extensions/reasoning-effort/src/preference.ts`
- 新建：`packages/extensions/reasoning-effort/src/http.ts`
- 新建：`packages/extensions/reasoning-effort/src/index.ts`
- 新建：`packages/extensions/reasoning-effort/tests/preference.client.spec.ts`
- 新建：`packages/extensions/reasoning-effort/tests/http.client.spec.ts`

- [ ] **步骤 1：编写失败的偏好与请求边界测试**

断言缺失或损坏的设置读取为 `false`；PUT 只接受 `{ "chibiThumb": boolean }`；错误 method、host、origin、capability、超大 body 和额外字段都拒绝；dispose 会移除精确路由和 index tap。

```ts
import { expect } from 'vitest'

declare function readPreference(value: unknown): { chibiThumb: boolean }
declare function request(input: { origin: string }): Promise<{ status: number }>

expect(readPreference(undefined)).toEqual({ chibiThumb: false })
await expect(request({ origin: 'http://localhost:5000' })).resolves.toMatchObject({ status: 403 })
```

- [ ] **步骤 2：运行测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/reasoning-effort/tests/preference.client.spec.ts packages/extensions/reasoning-effort/tests/http.client.spec.ts`

预期：因为 Host 端缺失而 FAIL。

- [ ] **步骤 3：注册设置 namespace 与精确路由**

使用只有一个默认布尔字段的设置 schema。注册一条精确 `/plugins/dsh-reasoning-effort/preference` 路由，在其中分派 GET 与 PUT，其他 method 返回 `405`；向 index 注入每代 capability，并把 `<` 转义为 `\u003c`；要求 Host 与 Origin 精确匹配 `127.0.0.1:<active-port>`；不输出 CORS header；请求正文限制为 1 KiB。

```ts
export const DEFAULT_REASONING_EFFORT_PREFERENCE = Object.freeze({ chibiThumb: false })
export const PREFERENCE_PATH = '/plugins/dsh-reasoning-effort/preference'
```

- [ ] **步骤 4：运行 Host 测试**

运行：`pnpm exec vitest run packages/extensions/reasoning-effort/tests/preference.client.spec.ts packages/extensions/reasoning-effort/tests/http.client.spec.ts`

预期：PASS。

- [ ] **步骤 5：提交偏好存储**

```bash
git add packages/extensions/reasoning-effort/src packages/extensions/reasoning-effort/tests/preference.client.spec.ts packages/extensions/reasoning-effort/tests/http.client.spec.ts
git commit -m "feat: persist effort character preference"
```

### 任务 4：构建 Harness 风格选择器与上游 Canvas 特效

**文件：**
- 新建：`packages/extensions/reasoning-effort/src/client/index.tsx`
- 新建：`packages/extensions/reasoning-effort/src/client/EffortControl.tsx`
- 新建：`packages/extensions/reasoning-effort/src/client/EffortControl.module.css`
- 新建：`packages/extensions/reasoning-effort/src/client/draw-radiation.ts`
- 新建：`packages/extensions/reasoning-effort/src/client/locales.ts`
- 新建：`packages/extensions/reasoning-effort/src/client/css-modules.d.ts`
- 新建：`packages/extensions/reasoning-effort/tests/client.client.spec.tsx`
- 新建：`packages/extensions/reasoning-effort/tests/canvas.client.spec.ts`

- [ ] **步骤 1：编写失败的 ModelDirectory 与交互测试**

覆盖打开时刷新、select 前使用最新 snapshot 校验、Host 拒绝后的回滚、少于两个 effort 时不显示滑块、addressed subagent 隐藏、键盘／触摸／指针输入、Escape 恢复焦点、外部点击，以及优先级 `-100` 注册。

```ts
import { expect } from 'vitest'

declare const register: (...args: unknown[]) => unknown
declare const controller: {
  select: (value: { provider: string, model: string, reasoningEffort: string }) => unknown
}

expect(register).toHaveBeenCalledWith(expect.objectContaining({
  name: 'conversation.input.model', priority: -100,
}), expect.any(Function))
expect(controller.select).toHaveBeenCalledWith({ provider: 'deepseek', model: 'chat', reasoningEffort: 'high' })
```

- [ ] **步骤 2：编写失败的 Canvas 来源测试**

mock `CanvasRenderingContext2D`，断言保留的上游 renderer 发出 14 条 streak path，以及 wave 和 glow 操作。断言减少动画时停止 `requestAnimationFrame`，但不移除 effort 控件。

- [ ] **步骤 3：运行 Client 测试并确认 RED**

运行：`pnpm exec vitest run packages/extensions/reasoning-effort/tests/client.client.spec.tsx packages/extensions/reasoning-effort/tests/canvas.client.spec.ts`

预期：因为 Client 端缺失而 FAIL。

- [ ] **步骤 4：实现 Client slot 与 portal**

只通过 `ctx.modelDirectory.directoryFor(sessionId)` 读取 model 与 effort。打开时和选择前调用 `load()`；在 `select()` 前拒绝陈旧 effort。用 `createPortal` 把弹层渲染到 `document.body`；按钮与错误继续使用 Harness primitives；产品 chrome 只使用 `--dsw-*` token。保留完全相同的上游 Canvas 绘制算法；人物默认关闭，并从 Host 路由读取偏好。

- [ ] **步骤 5：运行 Client 与 GUI 测试**

运行：`pnpm exec vitest run packages/extensions/reasoning-effort/tests && pnpm run test:gui`

预期：所有聚焦测试与 GUI 测试 PASS。

- [ ] **步骤 6：提交 Client**

```bash
git add packages/extensions/reasoning-effort/src/client packages/extensions/reasoning-effort/tests/client.client.spec.tsx packages/extensions/reasoning-effort/tests/canvas.client.spec.ts
git commit -m "feat: add Harness-native effort selector"
```

### 任务 5：集成、记录并打包插件

**文件：**
- 新建：`packages/extensions/reasoning-effort/README.md`
- 新建：`packages/extensions/reasoning-effort/README.zh.md`
- 新建：`packages/extensions/reasoning-effort/README.i18n.yaml`
- 修改：`apps/desktop/package.json`
- 修改：`apps/desktop/desktop.cordis.patch.yml`
- 修改：`scripts/stage-desktop.ts`
- 修改：`scripts/stage-desktop.spec.ts`
- 修改：`scripts/gen-third-party-notices.ts`
- 修改：`THIRD_PARTY_NOTICES.md`
- 修改：`PROJECT_CONTEXT.md`
- 新建：`.agents/notes/proposed/feature/2026-08-17-adaptive-reasoning-effort-plugin.md`
- 新建：`.agents/notes/proposed/feature/2026-08-17-adaptive-reasoning-effort-plugin.zh.md`
- 新建：`.agents/notes/proposed/feature/2026-08-17-adaptive-reasoning-effort-plugin.i18n.yaml`

- [ ] **步骤 1：添加失败的 Desktop 闭包测试**

断言 Desktop 通过 `workspace:^` 依赖 `@deepseek-ai/dsh-reasoning-effort`、patch 只有一个 `reasoning-effort` 配置项、staging 要求 Host／Client／license／sprite 产物、原版与 fork 重复配置会让 preflight 失败、缺失 module／service 与 apply 失败会拒绝激活，并且第三方声明包含上游作者与提交。

- [ ] **步骤 2：运行闭包测试并确认 RED**

运行：`pnpm exec vitest run scripts/stage-desktop.spec.ts scripts/gen-third-party-notices.spec.ts apps/desktop/tests/manifest.spec.ts`

预期：在缺少依赖和产物检查处 FAIL。

- [ ] **步骤 3：接入包且不修改核心模型选择**

添加 workspace 依赖，在 Client runtime 服务后插入 `{ id: reasoning-effort, name: '@deepseek-ai/dsh-reasoning-effort' }`，并扩展 staging 与第三方声明。记录停用／卸载 fallback、精确上游来源和 rc.5 兼容边界。

- [ ] **步骤 4：运行仓库门禁**

运行：`pnpm install && pnpm run build && pnpm exec vitest run packages/extensions/reasoning-effort scripts/stage-desktop.spec.ts apps/desktop/tests/manifest.spec.ts && pnpm run verify-third-party-notices && pnpm run doc-sync && git diff --check`

预期：每条命令退出码都是 `0`。

- [ ] **步骤 5：证明组装后的 fallback 与视觉行为**

使用临时 `DSH_HOME`，在随机端口启动 staged Desktop Host。验证空间足够时滑块向下打开、底部边缘翻到上方、选择真实 Host 提供的 effort、人物 opt-in 重启后保留，并且停用插件后原生模型选择器恢复。捕获深色、浅色、200% 缩放和减少动画截图，浏览器 console 无错误。

- [ ] **步骤 6：提交集成**

```bash
git add apps/desktop scripts THIRD_PARTY_NOTICES.md PROJECT_CONTEXT.md packages/extensions/reasoning-effort .agents/notes/proposed/feature/2026-08-17-adaptive-reasoning-effort-plugin*
git commit -m "feat: integrate adaptive reasoning effort plugin"
```
