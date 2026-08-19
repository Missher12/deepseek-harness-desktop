# 参考图式插件市场实现计划

[English](2026-08-20-reference-plugin-market.md) | 中文

> **供智能体执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 用已经批准的参考图层级替换 Desktop 插件市场拥挤的标签与卡片，同时保留真实搜索、真实分类、本地个人插件和全部现有生命周期操作。

**架构：** 设置壳只在分区 id 为 `market` 时加宽。固定版本 `dshmarket@1.10.1` 源码中的纯 helper 派生 Featured/分类预览并识别 `file:`/`link:` 个人插件；`MarketSection` 渲染新壳，并把维护操作路由到现有视图。依赖 patch、生成后的客户端 bundle、仓库测试和打包 smoke 始终同步。

**技术栈：** TypeScript、React 18、CSS Modules、Cordis 设置 slots、pnpm dependency patches、Vitest、Testing Library、Playwright/Electron 打包 smoke。

---

### 任务 1：让插件市场使用自适应设置尺寸

**文件：**
- 修改：`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`
- 修改：`packages/client/ui-settings-general/src/client/SettingsRoot.module.css`
- 测试：`packages/client/ui-settings-general/tests/settings-root.client.spec.tsx`

- [ ] **步骤 1：编写失败的壳测试**

加入 `market` 行并选择它，断言对话框得到 `data-settings-section="market"`，而其他分区暴露各自 id。断言 CSS 包含精确尺寸契约 `min(1040px, calc(100vw - 48px))`。

- [ ] **步骤 2：运行聚焦测试并确认 RED**

运行：`pnpm exec vitest run packages/client/ui-settings-general/tests/settings-root.client.spec.tsx`

预期：失败，因为对话框没有活动分区 hook，而且宽度固定。

- [ ] **步骤 3：实现最小壳 hook**

在设置对话框设置 `data-settings-section={active}`，并新增：

```css
.panel[data-settings-section="market"] {
  width: min(1040px, calc(100vw - 48px));
}
```

其他分区继续使用现有 800 像素宽度。

- [ ] **步骤 4：运行聚焦测试并确认 GREEN**

运行：`pnpm exec vitest run packages/client/ui-settings-general/tests/settings-root.client.spec.tsx`

预期：通过。

- [ ] **步骤 5：提交设置壳变更**

```bash
git add packages/client/ui-settings-general/src/client/SettingsRoot.tsx packages/client/ui-settings-general/src/client/SettingsRoot.module.css packages/client/ui-settings-general/tests/settings-root.client.spec.tsx
git commit -m "feat(settings): widen the plugin market surface"
```

### 任务 2：定义真实目录分组与个人插件识别

**文件：**
- 通过 pnpm patch 工作区修改：`node_modules/dshmarket/src/client/market-data.ts`
- 通过 pnpm patch 工作区修改：`node_modules/dshmarket/src/client/MarketSection.tsx`
- 测试：`scripts/dshmarket-client-layout.spec.ts`

- [ ] **步骤 1：编写失败的纯 helper 测试**

导入已 patch 的 `market-data.ts` 并断言以下契约：

```ts ignore-check
catalogSections(registry, visible, 6)
// Featured first; stable registry category order; no duplicate Featured entry;
// each preview <= 6; remainder is exact.

personalPluginNames({ local: 'link:/tmp/local', copied: 'file:/tmp/copied', public: '^1.2.3' })
// => ['local', 'copied']
```

同时保留跨名称、作者和本地化说明的现有搜索测试。

- [ ] **步骤 2：运行布局测试并确认 RED**

运行：`pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts`

预期：失败，因为新 helper 和语义 hook 尚不存在。

- [ ] **步骤 3：实现纯 helper**

新增并导出 `CatalogSection`、`catalogSections` 与 `personalPluginNames`。Featured 按星标数降序排列，使用目录顺序作为稳定 tie-break，排除 deprecated 插件，并从普通分类预览中去掉 Featured 条目。个人识别只接受以 `file:` 或 `link:` 开头的 spec。

- [ ] **步骤 4：运行 helper 测试并确认 GREEN**

运行：`pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts`

预期：helper 断言通过；呈现断言可以在任务 3 完成前继续 RED。

### 任务 3：构建已批准的市场层级

**文件：**
- 通过 pnpm patch 工作区修改：`node_modules/dshmarket/src/client/MarketSection.tsx`
- 通过 pnpm patch 工作区修改：`node_modules/dshmarket/src/client/Market.module.css`
- 通过 pnpm patch 工作区修改：`node_modules/dshmarket/src/client/locales.ts`
- 重新生成：`node_modules/dshmarket/client/client.js`
- 重新生成：`node_modules/dshmarket/client/client.js.map`
- 修改：`patches/dshmarket@1.10.1.patch`
- 修改：`pnpm-lock.yaml`
- 测试：`scripts/dshmarket-client-layout.spec.ts`
- 测试：`scripts/dshmarket-client-artifact.spec.ts`

- [ ] **步骤 1：用参考布局预期替换旧语义预期**

要求存在 `data-dshmarket-layout="reference"`、全局搜索、已安装图标栏、管理触发器、公开/个人标签、Featured 与分类分区、分区剩余入口、双列网格、个人空状态和单列容器兜底。继续要求真实安装操作、三点菜单、自保护与维护 callback。

- [ ] **步骤 2：运行源码与产物测试并确认 RED**

运行：`pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts`

预期：旧 B2 布局无法满足新断言，因此失败。

- [ ] **步骤 3：实现参考图式壳**

渲染标题/说明、全宽搜索、带齿轮的已安装图标栏、公开/个人模式行和分区总览。复用现有插件头像、详情弹窗、安装确认、进度、三点操作、筛选菜单、已安装管理、更新、活动、主题、备份与恢复函数。管理触发器选择这些旧视图，但不恢复旧的主标签栏。

- [ ] **步骤 4：实现响应式参考样式**

使用无边框 40 像素图标行和 `grid-template-columns: repeat(2, minmax(0, 1fr))`。容器小于 680 像素时切换单列，保持行操作对齐、禁止水平溢出，并为首次读取目录渲染稳定骨架。

- [ ] **步骤 5：构建包客户端并重新生成 pnpm patch**

运行包内 `build:client`，再运行 `pnpm patch-commit <absolute-edit-directory> --patches-dir patches`。重新安装 lockfile，确保新 patch hash 在各处解析一致。不得手工编辑压缩后的客户端产物。

- [ ] **步骤 6：运行 patch 与 staging 门禁**

运行：`pnpm exec vitest run scripts/dshmarket-baseline.spec.ts scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts scripts/dshmarket-self-protection.spec.ts scripts/stage-desktop.spec.ts`

预期：源码、浏览器 bundle、source map、精确 npm integrity、唯一 staged market 与自保护全部通过。

- [ ] **步骤 7：提交市场变更**

```bash
git add patches/dshmarket@1.10.1.patch pnpm-lock.yaml scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts
git commit -m "feat(market): adopt the reference plugin catalog"
```

### 任务 4：验证真实浏览器几何与行为

**文件：**
- 修改：`apps/desktop/tests/packaged-smoke.ts`
- 修改：`apps/desktop/tests/manifest.spec.ts`
- 仅在 helper 契约变化时修改：`apps/desktop/tests/packaged-smoke-helpers.spec.ts`

- [ ] **步骤 1：更新打包 smoke 预期**

断言真实市场存在参考布局 hook、可用搜索、已安装图标、公开与个人模式、Featured 第一、本地化分类分区、总览无重复、精确剩余数量、桌面双列和缩窄后的单列。保留非破坏性的自保护与普通 fixture 卸载检查。

- [ ] **步骤 2：运行源码级 smoke 测试并确认 GREEN**

运行：`pnpm exec vitest run apps/desktop/tests/manifest.spec.ts apps/desktop/tests/packaged-smoke-helpers.spec.ts scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts`

预期：通过。

- [ ] **步骤 3：提交 smoke 覆盖**

```bash
git add apps/desktop/tests/packaged-smoke.ts apps/desktop/tests/manifest.spec.ts apps/desktop/tests/packaged-smoke-helpers.spec.ts
git commit -m "test(desktop): cover the reference plugin market"
```

### 任务 5：记录、验证、打包与安装

**文件：**
- 修改：`PROJECT_CONTEXT.md`
- 构建：`apps/desktop/release/mac/DeepSeek Harness.app`
- 截图：`apps/desktop/release/desktop-smoke-market-darwin.png`

- [ ] **步骤 1：在项目上下文记录完成行为**

记录参考图层级、真实搜索、真实分类分区、`file:`/`link:` 个人规则、保留的维护功能和内部 macOS-only 边界。

- [ ] **步骤 2：运行验证门禁**

运行聚焦市场/设置壳测试、`pnpm run verify-translation-pairing`、`pnpm run typecheck` 与 `pnpm run lint`。

预期：所有命令退出码为 0。

- [ ] **步骤 3：构建并运行隔离打包 smoke**

运行：`pnpm run desktop:pack`

运行：`pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts`

预期：生成未签名 x86_64 `0.1.8` app，真实 Electron smoke 通过，市场截图展示参考图式布局且无浏览器控制台错误。

- [ ] **步骤 4：备份并安装**

退出运行中的应用，把当前 `/Applications/DeepSeek Harness.app` 移入 `~/Library/Application Support/DeepSeek Harness Backups` 下带时间戳的目录，把已验证候选复制到 `/Applications`，比较可执行文件与 `app.asar` 字节，然后从安装路径启动。

- [ ] **步骤 5：验证安装状态**

确认 x86_64 架构、版本 `0.1.8`、已安装主进程、owned loopback Host 进程、参考市场产物 marker 与保留备份。分支只保留本地，不上传 GitHub。
