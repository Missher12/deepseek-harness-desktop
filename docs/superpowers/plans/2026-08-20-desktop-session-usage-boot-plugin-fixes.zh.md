# Desktop 会话、用量、启动与插件修复实施计划

[English](2026-08-20-desktop-session-usage-boot-plugin-fixes.md) | 中文

> **供智能体执行者使用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 子 skill，逐项实施本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 修复恢复后的归档会话无法永久删除的问题，增加真正的无项目会话，使 Usage Insights 即时显示且几何稳定，恢复 macOS 冷启动进度条，并让打包应用安装插件时不依赖系统 Node 二进制文件。

**架构：** 保留现有 Session、Workspace 和 Remote 边界。Host 必须保留所有经 API 恢复的 Agent handle；无项目会话仍是通过 `session.create` 创建的普通未归属会话；Usage Insights 使用有界且经过验证的渲染器缓存，并采用 stale-while-refresh；两个启动界面共享等效的进度几何；Desktop 插件运行时创建仅 owner 可访问的临时 `node` shim，并在 Node 模式下委托给打包的 Electron 运行时。

**技术栈：** TypeScript、React 18、Cordis 服务、Electron、pnpm、Vitest、CSS Modules、自包含 HTML/CSS。

---

### 任务 1：删除恢复后的归档会话

**文件：**
- 修改：`packages/api/remotes/src/agent-lookup.ts`
- 修改：`packages/api/remotes/tests/agent-lookup.spec.ts`
- 修改：`packages/host/apiproxy/src/api-proxy.ts`
- 修改：`packages/host/apiproxy/tests/api-proxy-workspace.spec.ts`

- [ ] 添加失败的 API Remote 测试，证明 cold resume 会把准确的 `AgentHandle` 暴露给所属 Host 回调。
- [ ] 运行 `pnpm exec vitest run packages/api/remotes/tests/agent-lookup.spec.ts`，确认所有权断言因为 handle 当前被丢弃而失败。
- [ ] 向 `ApiRemoteAgentOptions` 添加范围最小的 `retainHandle` 选项，在 `ctx.agents.resume()` 后恰好调用一次，并返回对应 Agent。
- [ ] 添加 Host 回归测试，恢复、归档并永久删除同一个普通会话。
- [ ] 运行两个聚焦测试套件，确认恢复后的会话被 dispose、detach、持久删除，并从 Workspace 状态清除。

### 任务 2：创建并选择无项目会话

**文件：**
- 修改：`packages/client/runtime/src/client/contract/workspaces.ts`
- 修改：`packages/client/runtime/src/client/workspaces/service.ts`
- 修改：`packages/client/runtime/tests/workspaces-service.client.spec.ts`
- 修改：`packages/client/ui-conversation/src/client/contract/slots.ts`
- 修改：`packages/client/ui-conversation/src/client/apply.ts`
- 修改：`packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`
- 修改：`packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx`
- 修改：`packages/client/ui-conversation/src/client/locales.ts`
- 修改：`packages/client/ui-conversation/tests/apply-inject.client.spec.tsx`
- 修改：`packages/client/ui-conversation/tests/skeleton.client.spec.tsx`
- 修改：`packages/client/ui-workspace/src/client/WorkspacePicker.tsx`
- 修改：`packages/client/ui-workspace/src/client/contract/slots.ts`
- 修改：`packages/client/ui-workspace/src/client/locales.ts`
- 修改：`packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx`

- [ ] 为 `connectNoProject()` 添加失败的运行时测试：复用一个未归档、未归属且空白的会话，否则调用不含 `workspaceId` 或 `cwd` 的 `sessions.create()`。
- [ ] 为 picker/root 添加失败测试，覆盖一等的“无项目”菜单项、选中状态、可用输入框和草稿交接。
- [ ] 运行聚焦的运行时与 UI 测试，确认失败明确指出缺失的方法／入口。
- [ ] 实现 `connectNoProject()`，用 `onPickNoProject` 扩展 picker owner 约定，并把每个当前未归属会话标为“无项目”。
- [ ] 保持项目切换与项目创建行为不变；运行聚焦测试直至通过。

### 任务 3：让 Usage Insights 即时显示且布局稳定

**文件：**
- 修改：`packages/client/ui-settings-usage/src/client/snapshot-cache.ts`
- 修改：`packages/client/ui-settings-usage/src/client/UsageInsightsSection.tsx`
- 修改：`packages/client/ui-settings-usage/src/client/UsageInsightsSection.module.css`
- 修改：`packages/client/ui-settings-usage/tests/snapshot-cache.client.spec.ts`
- 修改：`packages/client/ui-settings-usage/tests/components.client.spec.tsx`

- [ ] 添加失败的缓存测试，覆盖持久 localStorage 恢复、schema／版本拒绝、格式错误数据拒绝和 reset 清理。
- [ ] 添加失败的组件几何测试，证明首次加载 skeleton 具有真实的五项 KPI、标签行、371 单元热力图、月份条和双栏详情结构。
- [ ] 运行两个聚焦测试套件，确认失败来自仅进程缓存和 70 单元占位结构。
- [ ] 实现版本化、隐私最小化且异常安全的 localStorage 缓存，同时保留进程内快速路径。
- [ ] 使用与就绪仪表盘相同的容器和尺寸重建 skeleton，然后运行两个测试套件直至通过。

### 任务 4：恢复连续的冷启动加载条

**文件：**
- 修改：`apps/desktop/renderer/loading-macos.html`
- 修改：`apps/desktop/tests/renderer-pages.spec.ts`
- 修改：`packages/client/web/src/DesktopBootSurface.tsx`
- 修改：`packages/client/web/src/boot-page.module.css`
- 修改：`packages/client/web/tests/boot-page.client.spec.ts`

- [ ] 修改现有原生页面测试并添加 Web 界面测试，要求两个启动阶段都具有可访问的 indeterminate 进度条。
- [ ] 运行两个聚焦测试套件，确认它们因为缺少进度条而失败。
- [ ] 在两个界面的状态行下方添加同样纤细的 DeepSeek 蓝／青色轨道和动画填充，并覆盖 reduced-motion 行为。
- [ ] 运行两个聚焦测试套件直至通过，并在桌面几何下检查两个界面。

### 任务 5：为 pnpm lifecycle 脚本提供打包 Node

**文件：**
- 修改：`packages/host/desktop-plugin-runtime/src/index.ts`
- 修改：`packages/host/desktop-plugin-runtime/tests/runtime.spec.ts`

- [ ] 添加失败的服务测试，要求一个仅 owner 可执行的私有 `node` shim 目录位于 `PATH` 最前，打包可执行文件保存在封闭环境变量中，并在 dispose 时清理。
- [ ] 运行 `pnpm exec vitest run packages/host/desktop-plugin-runtime/tests/runtime.spec.ts`，确认环境断言失败。
- [ ] 按需创建每服务私有 shim，在 `ELECTRON_RUN_AS_NODE=1` 下委托给 `facts.executable`，把它添加到继承 PATH 的最前，并在服务 teardown 时移除。
- [ ] 添加真实 subprocess smoke fixture，让 pnpm lifecycle 调用裸 `node`；从 PATH 移除系统 Node 后运行，并确认通过 shim 成功。
- [ ] 运行聚焦测试套件直至通过。

### 任务 6：集成、记录、打包并在内部安装

**文件：**
- 修改：`PROJECT_CONTEXT.md`
- 仅在发布脚本要求时修改：由仓库现有发布工作流选中的 Desktop 版本／changelog 文件。

- [ ] 一起运行任务 1–5 的全部聚焦测试套件。
- [ ] 运行 `pnpm run typecheck:contracts-ready`、`pnpm run lint:contracts-ready` 和受影响包的构建。
- [ ] 运行本地 macOS Desktop 打包 smoke，覆盖冷启动、无项目发送、恢复会话的归档／删除、Usage 再次进入／重启，以及安装最初失败的插件目标。
- [ ] 使用架构、当前进度、验证证据和已知边界更新 `PROJECT_CONTEXT.md`。
- [ ] 仅在此前所有门禁通过后构建并安装内部 macOS 应用；不要 push 或发布任何内容。
