# 插件市场展示实施计划

[English](2026-08-17-plugin-market-presentation.md) | 中文

> **供 agent 工作者使用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实施本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 把现有插件市场卡片网格替换为紧凑的 Harness 原生列表，同时保留锁定的 `dshmarket@1.10.1` 包身份与所有普通包操作。

**架构：** 保留 npm 依赖、Loader id、Settings id、Host 路由与包运行器。pnpm `patchedDependencies` 补丁修改上游 Client 源码和生成 bundle，并增加一个 Host 防护，拒绝以 `dshmarket` 自身为目标的更新。稳定 data attribute 与 source-map 内容检查证明 staged 和 packaged 产物包含已审计补丁，不依赖 CSS-module hash。

**技术栈：** pnpm patched dependencies、`dshmarket@1.10.1`、TypeScript、React 18、Harness UI primitives 与设计 token、tsdown／lightningcss、Vitest、Playwright／Electron smoke。

---

### 任务 1：锁定并验证准确的上游基线

**文件：**
- 新建：`scripts/dshmarket-baseline.spec.ts`
- 新建：`scripts/fixtures/dshmarket-1.10.1-baseline.json`
- 修改：`PROJECT_CONTEXT.md`

- [ ] **步骤 1：编写失败的来源测试**

从 Desktop importer 解析 `dshmarket/package.json` 并断言 version `1.10.1`，从 `pnpm-lock.yaml` 读取 npm integrity `sha512-8AWM8RT2tttJsozTBm6mAfI+cNpCIbeBdP9IoydJdHlH/+x72aNqmv3AWdbNfKDDwkkqM2Ce/XRDhha9HG0Q5Q==`，断言已记录的上游 git head `6970a6f801108c04234eb953ff0f707feffa621a`，并从源码验证 Loader name `dsh-market` 与 Settings id `market`。

```ts
import { expect } from 'vitest'

declare const manifest: { name: string, version: string }
declare const clientSource: string

expect(manifest).toMatchObject({ name: 'dshmarket', version: '1.10.1' })
expect(clientSource).toContain("export const name = 'dsh-market'")
expect(clientSource).toContain("id: 'market'")
```

- [ ] **步骤 2：运行测试并确认 RED**

运行：`pnpm exec vitest run scripts/dshmarket-baseline.spec.ts`

预期：因为缺少已记录基线 fixture 而 FAIL。

- [ ] **步骤 3：记录源码 hash 且不使用 bundle CSS hash**

fixture 记录包身份，以及 `src/routes.ts`、`src/client/MarketSection.tsx`、`src/client/Market.module.css` 和 `src/client/index.ts` 的 SHA-256。不要断言生成的 CSS module 前缀，因为上游构建会把绝对源码路径带入 lightningcss hash。

- [ ] **步骤 4：运行基线测试**

运行：`pnpm exec vitest run scripts/dshmarket-baseline.spec.ts`

预期：PASS。

- [ ] **步骤 5：提交来源锁定**

```bash
git add scripts/dshmarket-baseline.spec.ts scripts/fixtures/dshmarket-1.10.1-baseline.json PROJECT_CONTEXT.md
git commit -m "test: lock marketplace patch baseline"
```

### 任务 2：把 Discover 转换为紧凑 Harness 列表

**文件：**
- 补丁源码：`node_modules/dshmarket/src/client/MarketSection.tsx`
- 补丁源码：`node_modules/dshmarket/src/client/Market.module.css`
- 可见文字变化时补丁：`node_modules/dshmarket/src/client/locales.ts`
- 新建：`scripts/dshmarket-client-layout.spec.ts`

- [ ] **步骤 1：编写失败的语义布局测试**

断言源码包含 `data-dshmarket-layout="compact"` 和 `data-dshmarket-plugin-row`，保留现有安装／更新／确认 callback，只渲染一个主操作，并把源码／详情／复制包名移入一个更多菜单。断言 CSS 使用单列列表、40 像素图标、两行截断、sticky 工具栏、横向分类，以及 `--dsw-*` 颜色。

```ts
import { expect } from 'vitest'

declare const source: string
declare const css: string

expect(source).toContain('data-dshmarket-layout="compact"')
expect(source).toContain('data-dshmarket-plugin-row')
expect(css).toContain('grid-template-columns:1fr')
expect(css).toContain('-webkit-line-clamp:2')
```

- [ ] **步骤 2：运行测试并确认 RED**

运行：`pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts`

预期：在缺少 compact marker 处 FAIL。

- [ ] **步骤 3：只重构展示**

把 Discover renderer 改为 `PluginRow`，同时保留相同的市场数据、action callback、分页、确认 dialog、theme、installed／groups／backup 流程与错误处理。使用现有 `Menu`、`Tooltip`、`Button`、`SearchInput` 和 `Toast` primitives。每行只保留一个主操作。

```tsx
<div className={s.pluginRow} data-dshmarket-plugin-row data-package={plugin.package}>
  <img className={s.pluginIcon} width={40} height={40} alt="" />
  <div className={s.pluginCopy}>...</div>
  <div className={s.pluginAction}>{primaryAction}</div>
  <Menu>{overflowActions}</Menu>
</div>
```

- [ ] **步骤 4：让工具栏稳定且符合 Harness 风格**

在 sticky 区域保留标题／刷新、`Discover / Installed / Updates / Activity` 分段标签、搜索／筛选和单行横向滚动分类。使用 token 驱动的边框、背景、文字、品牌色、成功、警告和错误状态；状态同时使用文字与图标。

- [ ] **步骤 5：运行上游与语义测试**

在 git head 为 `6970a6f801108c04234eb953ff0f707feffa621a` 的临时上游 checkout 中运行 `npm test -- tests/client/market-section.client.spec.tsx tests/client/primitives-guard.spec.ts`。

随后运行：`pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts`

预期：所有测试 PASS。

- [ ] **步骤 6：只在任务 4 生成 pnpm patch 后提交源码工作**

不要提交 `node_modules` 下的编辑；任务 4 会把它们捕获到 `patches/dshmarket@1.10.1.patch`。

### 任务 3：在 Host 强制活动市场自我保护

**文件：**
- 补丁源码：`node_modules/dshmarket/src/routes.ts`
- 补丁生成 Host：`node_modules/dshmarket/lib/routes.js`
- 新建：`scripts/dshmarket-self-protection.spec.ts`

- [ ] **步骤 1：编写失败的路由防护测试**

用 `package: 'dshmarket'` 调用更新路由，断言在 runner 调用前返回稳定的 409 类拒绝。重新运行现有停用／删除自身保护，并验证一个普通包更新成功。

```ts
import { expect } from 'vitest'

declare function update(input: { package: string }): Promise<{ ok: boolean, code?: string }>
declare const runPlugin: (...args: unknown[]) => unknown

expect(await update({ package: 'dshmarket' })).toMatchObject({ ok: false, code: 'self-protected' })
expect(runPlugin).not.toHaveBeenCalled()
expect(await update({ package: 'dsh-reasoning-effort' })).toMatchObject({ ok: true })
```

- [ ] **步骤 2：运行测试并确认 RED**

运行：`pnpm exec vitest run scripts/dshmarket-self-protection.spec.ts`

预期：因为上游允许自身更新而 FAIL。

- [ ] **步骤 3：增加窄范围更新拒绝**

复用停用／删除保护已经使用的准确包名归一化。在任何包运行器或文件系统操作前，只拒绝活动市场包。不要修改权限、来源、安装、回滚、备份或普通更新路由。

- [ ] **步骤 4：构建 Host 输出并运行业务测试**

在临时上游 checkout 中运行 `npm run typecheck && npm test && npm run build`。

随后运行：`pnpm exec vitest run scripts/dshmarket-self-protection.spec.ts`

预期：所有测试 PASS。

### 任务 4：生成并锁定 pnpm 依赖补丁

**文件：**
- 新建：`patches/dshmarket@1.10.1.patch`
- 修改：`pnpm-workspace.yaml`
- 修改：`pnpm-lock.yaml`
- 新建：`scripts/dshmarket-client-artifact.spec.ts`

- [ ] **步骤 1：重新构建真实 Client 产物**

在精确上游 checkout 中运行 `npm run build:client && node scripts/preflight.mjs`。把修改后的源码，以及生成的 `client/client.js` 和 `client/client.js.map` 复制到 pnpm patch edit 目录。不要复用 Git tag bundle，也不要手改压缩输出。

- [ ] **步骤 2：通过 pnpm 提交补丁**

运行：`pnpm patch-commit <absolute-pnpm-edit-directory> --patches-dir patches`

预期：`pnpm-workspace.yaml` 增加 `dshmarket@1.10.1: patches/dshmarket@1.10.1.patch`；lockfile dependency snapshot 增加 `patch_hash`，同时保留原始 tarball integrity。

- [ ] **步骤 3：增加产物一致性测试**

解析 Desktop 使用的真实包，断言 source、`client.js` 和 `client.js.map` 的 `sourcesContent` 都包含 compact layout marker。断言 `lib/routes.js` 包含 self-protection marker。不要检查 hash 类名。

```ts
import { expect } from 'vitest'

declare const source: string
declare const bundle: string
declare const sourceMap: string
declare const hostBundle: string

for (const text of [source, bundle, sourceMap]) {
  expect(text).toContain('data-dshmarket-layout')
}
expect(hostBundle).toContain('self-protected')
```

- [ ] **步骤 4：从 lock 重新安装并运行产物测试**

运行：`pnpm install --frozen-lockfile && pnpm exec vitest run scripts/dshmarket-baseline.spec.ts scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-self-protection.spec.ts scripts/dshmarket-client-artifact.spec.ts`

预期：PASS；`apps/desktop/node_modules/dshmarket/client/client.js` 包含稳定 marker。

- [ ] **步骤 5：提交已审计补丁**

```bash
git add patches/dshmarket@1.10.1.patch pnpm-workspace.yaml pnpm-lock.yaml scripts/dshmarket-*.spec.ts
git commit -m "feat: restyle the desktop plugin marketplace"
```

### 任务 5：证明 staging、视觉行为和更新安全

**文件：**
- 修改：`scripts/stage-desktop.ts`
- 修改：`scripts/stage-desktop.spec.ts`
- 修改：`apps/desktop/tests/packaged-smoke.ts`
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 修改：`apps/desktop/README.i18n.yaml`
- 修改：`PROJECT_CONTEXT.md`
- 新建：`.agents/notes/proposed/feature/2026-08-17-harness-native-plugin-market.md`
- 新建：`.agents/notes/proposed/feature/2026-08-17-harness-native-plugin-market.zh.md`
- 新建：`.agents/notes/proposed/feature/2026-08-17-harness-native-plugin-market.i18n.yaml`

- [ ] **步骤 1：添加失败的 stage 断言**

要求 staged `client/client.js` 中有 compact marker、source map 中有相同 marker、version 精确为 `1.10.1`，并且 Host 有 self-protection marker。断言 stage 中有且只有一个 `dshmarket` 包。

- [ ] **步骤 2：运行 stage 测试并确认 RED**

运行：`pnpm exec vitest run scripts/stage-desktop.spec.ts apps/desktop/tests/manifest.spec.ts`

预期：在 staging 尚未执行语义检查时 FAIL。

- [ ] **步骤 3：扩展 staging 与 packaged smoke**

依赖未打补丁，或 source／bundle／map 不一致时，让 staging 失败。在 packaged smoke 中打开 Settings → Plugin Market，验证 compact root marker、Discover／Installed／Updates／Activity 切换、搜索、横向分类、每行一个主操作，以及无 console 错误。验证直接 self-update 请求拒绝，普通 fixture 包操作仍进入现有 runner。

- [ ] **步骤 4：运行构建与仓库门禁**

运行：`pnpm run build && pnpm exec vitest run scripts/dshmarket-*.spec.ts scripts/stage-desktop.spec.ts apps/desktop/tests/manifest.spec.ts && pnpm run typecheck && pnpm run lint && pnpm run doc-sync && git diff --check`

预期：每条命令退出码都是 `0`。

- [ ] **步骤 5：完成真实 Mac 视觉验收**

构建 staged Intel 应用，在约 564 像素内容宽度打开真实市场，并在深色／浅色主题与 200% 缩放下捕获 Discover、Installed、Updates 和 Activity。验证列表行不溢出、描述截断为两行、分类可横向滚动、dialog 与操作保留上游行为，并且浏览器 console 干净。

- [ ] **步骤 6：提交验收接线与文档**

```bash
git add scripts/stage-desktop.ts scripts/stage-desktop.spec.ts apps/desktop/tests/packaged-smoke.ts apps/desktop/README* PROJECT_CONTEXT.md .agents/notes/proposed/feature/2026-08-17-harness-native-plugin-market*
git commit -m "test: verify Harness-native plugin market"
```
