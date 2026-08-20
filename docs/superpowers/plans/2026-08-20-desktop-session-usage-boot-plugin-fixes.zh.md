# Desktop 会话、使用统计、启动与插件修复实施计划

[English](2026-08-20-desktop-session-usage-boot-plugin-fixes.md) | 中文

> **面向 Agent 工作进程：** 必须使用子 Skill：建议使用 superpowers:subagent-driven-development，也可以使用 superpowers:executing-plans，按任务逐项实施本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 修复永久删除已恢复归档会话的问题，增加真正的无项目会话，让使用统计即时显示且几何布局稳定，恢复 macOS 冷启动进度条，并让打包后的插件安装不依赖系统 Node 二进制文件。

**架构：** 保留现有 Session、Workspace 和 Remote 边界。Host 必须保留通过 API 恢复的每个 Agent 句柄；无项目会话仍是通过 `session.create` 创建的普通未归属会话；使用统计使用有界、经过验证的渲染器缓存，并采用 stale-while-refresh；两个启动界面使用等效的进度布局；Desktop 包运行时创建仅所有者可访问的临时 `node` shim，在 Node 模式下委托给打包的 Electron 运行时。

**技术栈：** TypeScript、React 18、Cordis 服务、Electron、pnpm、Vitest、CSS Modules、自包含 HTML/CSS。

---

### 任务 1：删除已恢复的归档会话

**文件：**
- 修改：`packages/api/remotes/src/agent-lookup.ts`
- 修改：`packages/api/remotes/tests/agent-lookup.spec.ts`
- 修改：`packages/host/apiproxy/src/api-proxy.ts`
- 修改：`packages/host/apiproxy/tests/api-proxy-workspace.spec.ts`

- [ ] 添加一个预期失败的 API Remote 测试，证明冷恢复会把精确的 `AgentHandle` 暴露给所属 Host 的回调。
- [ ] 运行 `pnpm exec vitest run packages/api/remotes/tests/agent-lookup.spec.ts`，确认所有权断言失败，因为当前会丢弃该句柄。
- [ ] 为 `ApiRemoteAgentOptions` 增加范围受限的 `retainHandle` 选项，在 `ctx.agents.resume()` 之后精确调用一次，并返回其 Agent。
- [ ] 添加一个 Host 回归测试，对同一个普通会话依次执行恢复、归档和永久删除。
- [ ] 运行两个聚焦测试套件，确认已恢复会话被释放、分离、持久删除，并从 Workspace 状态中清除。

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

- [ ] 为 `connectNoProject()` 添加预期失败的运行时测试：复用一个未归档、未归属的空白会话，否则调用不含 `workspaceId` 或 `cwd` 的 `sessions.create()`。
- [ ] 添加预期失败的选择器与根组件测试，验证一级“无项目”菜单项、选中状态、启用的输入框和草稿交接。
- [ ] 运行聚焦的运行时与 UI 测试，确认失败信息指出缺失的方法或条目。
- [ ] 实现 `connectNoProject()`，以 `onPickNoProject` 扩展选择器所有者契约，并将所有当前未归属会话标记为“无项目”。
- [ ] 保持项目切换与项目创建不变；运行聚焦测试套件并确认全部通过。

### 任务 3：让使用统计即时显示且布局稳定

**文件：**
- 修改：`packages/client/ui-settings-usage/src/client/snapshot-cache.ts`
- 修改：`packages/client/ui-settings-usage/src/client/UsageInsightsSection.tsx`
- 修改：`packages/client/ui-settings-usage/src/client/UsageInsightsSection.module.css`
- 修改：`packages/client/ui-settings-usage/tests/snapshot-cache.client.spec.ts`
- 修改：`packages/client/ui-settings-usage/tests/components.client.spec.tsx`

- [ ] 为持久化 localStorage 恢复、架构或版本拒绝、格式错误数据拒绝和重置清理添加预期失败的缓存测试。
- [ ] 添加预期失败的组件布局测试，证明首次加载骨架包含真实的 5 项 KPI、标签行、371 单元热力图、月份条和双列详情结构。
- [ ] 运行两个聚焦测试套件，确认失败来自仅进程缓存和 70 单元占位符。
- [ ] 实现带版本、隐私最小化且异常安全的 localStorage 缓存，同时保留进程内存快速路径。
- [ ] 使用与就绪面板相同的容器和尺寸重建骨架，然后运行两个测试套件并确认全部通过。

### 任务 4：恢复连续的冷启动进度条

**文件：**
- 修改：`apps/desktop/renderer/loading-macos.html`
- 修改：`apps/desktop/tests/renderer-pages.spec.ts`
- 修改：`packages/client/web/src/DesktopBootSurface.tsx`
- 修改：`packages/client/web/src/DesktopBootSurface.module.css`
- 修改：`packages/client/web/tests/DesktopBootSurface.client.spec.tsx`

- [ ] 修改现有原生页面测试并添加 Web 界面测试，要求两个启动层都有可访问的非确定进度条。
- [ ] 运行两个聚焦测试套件，确认失败原因是进度条缺失。
- [ ] 在状态行下方向两个界面添加相同的 DeepSeek 蓝色或青色细轨道与动画填充，并支持减少动态效果。
- [ ] 运行两个测试套件并确认全部通过，同时检查桌面几何布局下的两个界面。

### 任务 5：为 pnpm 生命周期脚本提供打包的 Node

**文件：**
- 修改：`packages/host/desktop-plugin-runtime/src/index.ts`
- 修改：`packages/host/desktop-plugin-runtime/tests/runtime.spec.ts`

- [ ] 添加预期失败的服务测试，要求 `PATH` 首位是私有的可执行 `node` shim 目录、打包可执行文件放在封闭的环境变量中，并在释放时清理。
- [ ] 运行 `pnpm exec vitest run packages/host/desktop-plugin-runtime/tests/runtime.spec.ts`，确认环境断言失败。
- [ ] 按需创建每个服务独立的私有 shim，在 `ELECTRON_RUN_AS_NODE=1` 下委托给 `facts.executable`，将其添加到继承的 PATH 首位，并在服务销毁期间删除。
- [ ] 添加真实子进程冒烟测试夹具，让 pnpm 生命周期调用裸 `node`；从 PATH 中移除系统 Node 后运行，并确认通过 shim 成功执行。
- [ ] 运行聚焦测试套件并确认全部通过。

### 任务 6：集成、记录、打包并在内部安装

**文件：**
- 修改：`PROJECT_CONTEXT.md`
- 仅在发布脚本要求时修改：由仓库现有发布工作流选定的 Desktop 版本或变更日志文件。

- [ ] 同时运行任务 1 至 5 的全部聚焦测试套件。
- [ ] 运行 `pnpm run typecheck:contracts-ready`、`pnpm run lint:contracts-ready` 和受影响的软件包构建。
- [ ] 运行本地 macOS Desktop 打包冒烟测试，包括冷启动、无项目发送、恢复会话的归档或删除、使用统计重新访问或重启，以及安装最初失败的插件目标。
- [ ] 使用架构、当前进度、验证证据和已知边界更新 `PROJECT_CONTEXT.md`。
- [ ] 仅在此前所有门禁都通过后构建并安装内部 macOS 应用；不得推送或发布任何内容。
